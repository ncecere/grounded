// A source's repeated-boilerplate settings and what they remove (ADR-0021).
// Suppression itself runs in internal/ingest.

package sources

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// BoilerplateSummary is a source's boilerplate settings and their effect.
type BoilerplateSummary struct {
	Settings    boilerplate.Settings  // the source's overrides (nil fields inherit)
	Effective   boilerplate.Effective // in force
	Blocks      int64                 // blocks classified as repeated
	Pages       int64                 // documents they were removed from
	Documents   int32                 // documents counted at the last refresh
	Threshold   int32                 // documents a block needed then
	RefreshedAt *time.Time            // the request the last refresh handled
	Pending     bool                  // a refresh is due, or documents wait to be re-checked
}

// BoilerplateBlock is one repeated block: the start of its text and how
// many documents contain it.
type BoilerplateBlock struct {
	Text      string
	Documents int32
}

// validateBoilerplate checks overrides, or nil (no change).
func validateBoilerplate(s *boilerplate.Settings) error {
	if s == nil {
		return nil
	}
	if err := s.Validate(); err != nil {
		return apperr.Invalid("invalid_boilerplate", "Boilerplate settings: minDocs must be 2-100000 and ratio 0.05-1")
	}
	return nil
}

// boilerplateSummaries loads the summaries of sources; sources without a
// row use the defaults for their type.
func (s *Service) boilerplateSummaries(ctx context.Context, srcs []dbgen.DataSource, ids []uuid.UUID) (map[uuid.UUID]BoilerplateSummary, error) {
	rows, err := s.q.BoilerplateSummaries(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]dbgen.BoilerplateSummariesRow, len(rows))
	for _, r := range rows {
		byID[r.SourceID] = r
	}
	out := make(map[uuid.UUID]BoilerplateSummary, len(srcs))
	for _, src := range srcs {
		r := byID[src.ID]
		set := ingest.SettingsOf(r.Enabled.Bool, r.Enabled.Valid, r.MinDocs, r.Ratio)
		out[src.ID] = BoilerplateSummary{
			Settings: set, Effective: s.Boilerplate.Resolve(src.Type, set),
			Blocks: r.Blocks, Pages: r.Pages, Documents: r.Documents, Threshold: r.Threshold, RefreshedAt: r.RefreshedAt,
			Pending: r.Stale || r.RequestedAt != nil && (r.RefreshedAt == nil || r.RequestedAt.After(*r.RefreshedAt)),
		}
	}
	return out, nil
}

// setBoilerplate replaces a source's overrides, audits the change and
// schedules the refresh that applies it (re-chunking affected documents).
// nil or unchanged settings do nothing.
func (s *Service) setBoilerplate(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, sc scope, src dbgen.DataSource, in *boilerplate.Settings) error {
	if in == nil {
		return nil
	}
	next := *in
	cur, _, err := ingest.SourceBoilerplate(ctx, q, src.ID)
	if err != nil {
		return err
	}
	if sameSettings(cur, next) {
		return nil
	}
	p := dbgen.SetBoilerplateSettingsParams{SourceID: src.ID, Ratio: next.Ratio}
	if next.Enabled != nil {
		p.Enabled = pgtype.Bool{Bool: *next.Enabled, Valid: true}
	}
	if next.MinDocs != nil {
		n := int32(*next.MinDocs)
		p.MinDocs = &n
	}
	if err := q.SetBoilerplateSettings(ctx, p); err != nil {
		return err
	}
	if err := ingest.RequestRefresh(ctx, s.Jobs, tx, src.ID); err != nil {
		return err
	}
	e := a.Audit("source.boilerplate_update", "data_source", src.ID.String())
	e.TeamID = sc.auditTeam()
	e.Before, e.After = s.boilerplateSnapshot(src, cur), s.boilerplateSnapshot(src, next)
	return audit.Record(ctx, q, e)
}

func (s *Service) boilerplateSnapshot(src dbgen.DataSource, set boilerplate.Settings) map[string]any {
	eff := s.Boilerplate.Resolve(src.Type, set)
	return map[string]any{
		"overrides": set,
		"effective": map[string]any{"enabled": eff.Enabled, "minDocs": eff.MinDocs, "ratio": eff.Ratio},
	}
}

func sameSettings(a, b boilerplate.Settings) bool {
	eq := func(x, y *float64) bool { return (x == nil) == (y == nil) && (x == nil || *x == *y) }
	eqi := func(x, y *int) bool { return (x == nil) == (y == nil) && (x == nil || *x == *y) }
	eqb := func(x, y *bool) bool { return (x == nil) == (y == nil) && (x == nil || *x == *y) }
	return eqb(a.Enabled, b.Enabled) && eqi(a.MinDocs, b.MinDocs) && eq(a.Ratio, b.Ratio)
}

// requestBoilerplate schedules a refresh after a change to a source's
// documents (an upload batch, a deletion) when suppression is on for it.
func (s *Service) requestBoilerplate(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, src dbgen.DataSource) error {
	set, _, err := ingest.SourceBoilerplate(ctx, q, src.ID)
	if err != nil {
		return err
	}
	if !s.Boilerplate.Resolve(src.Type, set).Enabled {
		return nil
	}
	return ingest.RequestRefresh(ctx, s.Jobs, tx, src.ID)
}

// maxTopBlocks is the most repeated blocks listed.
const maxTopBlocks = 50

// TopBoilerplate lists a source's most repeated blocks, most documents
// first. The text is the first 80 characters (owners see what is removed).
func (s *Service) TopBoilerplate(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID, limit int32) ([]BoilerplateBlock, error) {
	sc, err := s.readAccess(ctx, a, o, sourceRead(breakglass.ReadBoilerplate, id))
	if err != nil {
		return nil, err
	}
	if _, err := s.source(ctx, s.q, sc, id, false); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > maxTopBlocks {
		limit = maxTopBlocks
	}
	rows, err := s.q.TopBoilerplateBlocks(ctx, dbgen.TopBoilerplateBlocksParams{SourceID: id, MaxRows: limit})
	if err != nil {
		return nil, err
	}
	out := make([]BoilerplateBlock, len(rows))
	for i, r := range rows {
		text := []rune(r.Sample)
		if len(text) > 80 {
			text = text[:80]
		}
		out[i] = BoilerplateBlock{Text: string(text), Documents: r.DocCount}
	}
	return out, nil
}
