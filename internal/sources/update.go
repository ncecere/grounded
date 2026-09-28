// Updating a source, including classification changes and their impact on
// dependent knowledge bases and agents (ADR-0006 rules 6 and 7).

package sources

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/web"
)

// UpdateInput holds optional changes. Lowering the classification needs a
// team admin (or, for shared sources, a platform admin) and a reason
// (ADR-0006 rule 7). Web replaces a web source's configuration.
type UpdateInput struct {
	Name, Description, Classification, Status, Reason *string
	Web                                               json.RawMessage
	// Boilerplate replaces the source's boilerplate overrides (nil fields
	// inherit the defaults); nil leaves them unchanged.
	Boilerplate *boilerplate.Settings
	// OCREnabled switches OCR for the source (docs/ocr.md §5).
	OCREnabled *bool
}

// Impact is a knowledge base that raising a shared source's classification
// would break (its team is approved below the new level).
type Impact = dbgen.SharedSourceImpactRow

// AgentImpact is a published agent that data at a higher classification would
// break: its chat model or its audience isn't allowed for that level
// (ADR-0006 rules 4 and 5).
type AgentImpact = dbgen.AgentRankImpactRow

// ImpactError rejects a change that raises a classification (a source's, or
// a KB's by attaching a source) when it would break ADR-0006 for dependent
// objects (rule 6): knowledge bases of teams approved below the new level
// (shared sources), or published agents whose chat model or audience isn't
// allowed for it. It unwraps to a 409 classification_impact apperr.Error.
type ImpactError struct {
	Classification string
	Affected       []Impact
	Agents         []AgentImpact
}

func (e *ImpactError) Error() string { return "classification_impact" }

func (e *ImpactError) Unwrap() error {
	agents := AgentBlockers(e.Agents)
	switch {
	case len(e.Affected) > 0 && agents != "":
		return apperr.Conflict("classification_impact",
			"Knowledge bases of teams not approved for that classification use this source, and published agents block the change: "+agents+". Resolve them first.")
	case agents != "":
		return apperr.Conflict("classification_impact", "Published agents block the change: "+agents+".")
	}
	return apperr.Conflict("classification_impact",
		"Knowledge bases of teams not approved for that classification use this source. They must detach it first.")
}

// AgentBlockers says why published agents block a raise, naming only the
// reasons that apply (docs/ui-review F-19): "" when none do.
func AgentBlockers(agents []AgentImpact) string {
	var model, audience bool
	for _, a := range agents {
		model = model || a.ModelBlocks
		audience = audience || a.AudienceBlocks
	}
	switch {
	case model && audience:
		return "some use a chat model that isn't approved for it (choose an approved model and publish again), " +
			"and some have an audience that isn't allowed for it (publish them to a narrower audience)"
	case model:
		return "their chat model isn't approved for that classification (choose an approved model and publish again)"
	case audience:
		return "their audience isn't allowed for that classification (publish them to a narrower audience)"
	}
	return ""
}

// AgentReasonText explains one agent's reasons, in order: model, audience.
func AgentReasonText(a AgentImpact) []string {
	out := []string{}
	if a.ModelBlocks {
		out = append(out, "Its chat model, "+a.ModelName+", isn't approved for this classification.")
	}
	if a.AudienceBlocks {
		aud := map[string]string{"team": "the team", "all_authenticated": "signed-in users", "public": "public"}[a.Audience]
		out = append(out, "Its audience ("+aud+") isn't allowed for data at this classification.")
	}
	return out
}

// AgentImpactOf lists published agents that data at classification would
// break, reaching them through sourceID or kbID (pass one; the other uuid.Nil).
func AgentImpactOf(ctx context.Context, q *dbgen.Queries, classification string, sourceID, kbID uuid.UUID) ([]AgentImpact, error) {
	return q.AgentRankImpact(ctx, dbgen.AgentRankImpactParams{
		Classification: classification,
		SourceID:       uuid.NullUUID{UUID: sourceID, Valid: sourceID != uuid.Nil},
		KBID:           uuid.NullUUID{UUID: kbID, Valid: kbID != uuid.Nil},
	})
}

// ClassificationImpact previews raising a shared source to classification:
// every team knowledge base that would violate ADR-0006 rule 2, and every
// published agent that would violate rules 4 or 5. Lowering (or no change)
// affects nothing.
func (s *Service) ClassificationImpact(ctx context.Context, a authz.Actor, id uuid.UUID, classification string) ([]Impact, []AgentImpact, error) {
	sc, err := s.access(ctx, a, Platform, true)
	if err != nil {
		return nil, nil, err
	}
	cur, err := s.source(ctx, s.q, sc, id, false)
	if err != nil {
		return nil, nil, err
	}
	kbs, err := s.impact(ctx, s.q, cur, classification)
	if err != nil || len(kbs) == 0 && !s.raises(ctx, cur, classification) {
		return kbs, []AgentImpact{}, err
	}
	agents, err := AgentImpactOf(ctx, s.q, classification, cur.ID, uuid.Nil)
	return kbs, agents, err
}

// raises reports whether classification ranks above the source's current one.
func (s *Service) raises(ctx context.Context, cur dbgen.DataSource, classification string) bool {
	newRank, err1 := rankOf(ctx, s.q, classification)
	oldRank, err2 := rankOf(ctx, s.q, cur.Classification)
	return err1 == nil && err2 == nil && newRank > oldRank
}

func (s *Service) impact(ctx context.Context, q *dbgen.Queries, cur dbgen.DataSource, classification string) ([]Impact, error) {
	newRank, err := rankOf(ctx, q, classification)
	if err != nil {
		return nil, err
	}
	oldRank, err := rankOf(ctx, q, cur.Classification)
	if err != nil {
		return nil, err
	}
	if newRank <= oldRank {
		return []Impact{}, nil
	}
	return q.SharedSourceImpact(ctx, dbgen.SharedSourceImpactParams{SourceID: cur.ID, Rank: newRank})
}

// Update changes a source's name, description, status, classification or
// web configuration.
func (s *Service) Update(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID, in UpdateInput, expectedRevision int64) (Summary, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return Summary{}, err
	}
	newConfig, err := s.validateUpdate(ctx, sc, in)
	if err != nil {
		return Summary{}, err
	}
	var out dbgen.DataSource
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := s.source(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		p, err := textAndStatus(cur, in)
		if err != nil {
			return err
		}
		scheduleChanged, err := applyWebConfig(ctx, q, cur, newConfig, &p)
		if err != nil {
			return err
		}
		meta := map[string]any{}
		if in.Classification != nil && *in.Classification != cur.Classification {
			if err := s.checkReclassification(ctx, q, sc, cur, in, meta); err != nil {
				return err
			}
			p.Classification = *in.Classification
		}
		out, err = q.UpdateSource(ctx, p)
		if sc.nameTaken(err) {
			return sc.nameTakenErr()
		} else if err != nil {
			return err
		}
		if err := s.afterUpdate(ctx, q, tx, cur, out, scheduleChanged, newConfig); err != nil {
			return err
		}
		if err := s.setSwitches(ctx, q, tx, a, sc, cur, &out, in); err != nil {
			return err
		}
		return s.recordUpdate(ctx, q, tx, a, sc, cur, out, meta)
	})
	if err != nil {
		return Summary{}, err
	}
	if out.Status == "paused" && out.Type == TypeWeb {
		s.Web.Promote(ctx, sc.teamID()) // a cancelled run freed its crawl slot
	}
	src, err := s.q.GetSource(ctx, out.ID)
	if err != nil {
		return Summary{}, err
	}
	return s.summary(ctx, src)
}

// validateUpdate checks the boilerplate overrides and a new web
// configuration (nil: unchanged) before the update's transaction.
func (s *Service) validateUpdate(ctx context.Context, sc scope, in UpdateInput) (*web.Config, error) {
	if err := validateBoilerplate(in.Boilerplate); err != nil {
		return nil, err
	}
	if len(in.Web) == 0 || string(in.Web) == "null" {
		return nil, nil
	}
	cfg, err := s.Web.ValidateConfig(ctx, sc.teamID(), in.Web)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// textAndStatus starts the update from the current source and applies the
// name, description and status.
func textAndStatus(cur dbgen.DataSource, in UpdateInput) (dbgen.UpdateSourceParams, error) {
	p := dbgen.UpdateSourceParams{ID: cur.ID, Name: cur.Name, Description: cur.Description, Classification: cur.Classification, Status: cur.Status, Config: cur.Config}
	if in.Name != nil {
		p.Name = strings.TrimSpace(*in.Name)
	}
	if in.Description != nil {
		p.Description = *in.Description
	}
	if err := validateText(p.Name, p.Description); err != nil {
		return p, err
	}
	// Paused: no uploads, no crawls and no processing; search over indexed
	// content keeps working. Resuming lets pending documents continue.
	if in.Status != nil {
		if *in.Status != "active" && *in.Status != "paused" {
			return p, apperr.Invalid("invalid_status", "Status must be active or paused")
		}
		p.Status = *in.Status
	}
	return p, nil
}

// applyWebConfig replaces a web source's configuration (nil: unchanged) and
// retags its pages when the tags changed. It reports whether the schedule
// changed.
func applyWebConfig(ctx context.Context, q *dbgen.Queries, cur dbgen.DataSource, cfg *web.Config, p *dbgen.UpdateSourceParams) (bool, error) {
	if cfg == nil {
		return false, nil
	}
	if cur.Type != TypeWeb {
		return false, apperr.Invalid("not_web_source", "Only web sources have a web configuration")
	}
	old, _ := web.Stored(cur.Config)
	p.Config = cfg.JSON()
	if !slices.Equal(old.Tags, cfg.Tags) {
		// Retag existing pages now; new and changed pages get the tags when
		// they are stored.
		if err := q.SetSourceDocumentTags(ctx, dbgen.SetSourceDocumentTagsParams{SourceID: cur.ID, Tags: cfg.Tags}); err != nil {
			return false, err
		}
	}
	return old.Schedule != cfg.Schedule, nil
}

// checkReclassification checks a classification change (ADR-0006): lowering
// needs a team admin and a reason (recorded in meta); the new level must be
// allowed for the owner and the embedding model; raising must not break
// dependent knowledge bases or agents.
func (s *Service) checkReclassification(ctx context.Context, q *dbgen.Queries, sc scope, cur dbgen.DataSource, in UpdateInput, meta map[string]any) error {
	oldRank, err := rankOf(ctx, q, cur.Classification)
	if err != nil {
		return err
	}
	newRank, err := rankOf(ctx, q, *in.Classification)
	if err != nil {
		return err
	}
	if newRank < oldRank {
		if sc.team != nil && !authz.RoleAtLeast(sc.role, authz.RoleAdmin) {
			return apperr.Forbidden("Only team admins and owners can lower a source's classification")
		}
		if in.Reason == nil || len(strings.TrimSpace(*in.Reason)) < 10 {
			return apperr.Invalid("reason_required", "Explain why the classification is being lowered (at least 10 characters)")
		}
		meta["reason"] = strings.TrimSpace(*in.Reason)
		meta["lowered"] = true // notifyLowered tells the team owners
	}
	if err := s.checkClassification(ctx, q, sc, *in.Classification, cur.Type, cur.EmbeddingProfileID); err != nil {
		return err
	}
	if newRank <= oldRank {
		return nil
	}
	// ADR-0006 rule 6: raising a source must not break rule 2 for any
	// team's knowledge base (shared sources), nor rules 4-5 for any
	// published agent that uses it.
	var affected []Impact
	if sc.team == nil {
		if affected, err = s.impact(ctx, q, cur, *in.Classification); err != nil {
			return err
		}
	}
	agents, err := AgentImpactOf(ctx, q, *in.Classification, cur.ID, uuid.Nil)
	if err != nil {
		return err
	}
	if len(affected) > 0 || len(agents) > 0 {
		return &ImpactError{Classification: *in.Classification, Affected: affected, Agents: agents}
	}
	return nil
}

// afterUpdate follows a status or schedule change: resuming kicks
// processing, pausing a web source cancels its crawl, and a new schedule
// moves the next sync.
func (s *Service) afterUpdate(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, cur, out dbgen.DataSource, scheduleChanged bool, cfg *web.Config) error {
	if cur.Status == "paused" && out.Status == "active" {
		if err := ingest.Kick(ctx, s.Jobs, tx); err != nil {
			return err
		}
	}
	if cur.Status == "active" && out.Status == "paused" && out.Type == TypeWeb {
		if err := s.Web.CancelActive(ctx, tx, out.ID, "The source was paused"); err != nil {
			return err
		}
	}
	if !scheduleChanged {
		return nil
	}
	base := time.Now()
	if cur.LastSyncAt != nil {
		base = *cur.LastSyncAt
	}
	return q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: out.ID, NextSyncAt: web.NextSync(cfg.Schedule, base)})
}

// recordUpdate audits an update and, when the classification was lowered,
// notifies the team owners.
func (s *Service) recordUpdate(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, sc scope, cur, out dbgen.DataSource, meta map[string]any) error {
	action := "source.update"
	if cur.Classification != out.Classification {
		action = "source.classification_change"
	}
	e := a.Audit(action, "data_source", out.ID.String())
	e.TeamID, e.Before, e.After, e.Metadata = sc.auditTeam(), sourceSnapshot(cur), sourceSnapshot(out), mergeMeta(e.Metadata, meta)
	if err := audit.Record(ctx, q, e); err != nil {
		return err
	}
	return s.notifyLowered(ctx, q, tx, a, sc, cur, out, meta)
}

// notifyLowered tells a team's owners that one of its sources was lowered
// (mandatory; docs/phase4-publishing.md §8). Shared sources have no team.
func (s *Service) notifyLowered(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, sc scope, cur, out dbgen.DataSource, meta map[string]any) error {
	if meta["lowered"] != true || sc.team == nil {
		return nil
	}
	from, err := q.GetClassification(ctx, cur.Classification)
	if err != nil {
		return err
	}
	to, err := q.GetClassification(ctx, out.Classification)
	if err != nil {
		return err
	}
	reason, _ := meta["reason"].(string)
	t := notify.TeamRef{ID: sc.team.ID, Slug: sc.team.Slug, Name: sc.team.Name}
	return s.Notify.Emit(ctx, tx, notify.ClassificationLoweredEvent(t, out.ID, out.Name, from.Name, to.Name, reason).By(a.UserID))
}

// setSwitches applies the boilerplate overrides and the OCR switch of an
// update (out reflects the OCR switch for the audit entry).
func (s *Service) setSwitches(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, sc scope, cur dbgen.DataSource, out *dbgen.DataSource, in UpdateInput) error {
	if in.OCREnabled != nil && *in.OCREnabled != cur.OcrEnabled {
		if err := q.SetSourceOCR(ctx, dbgen.SetSourceOCRParams{ID: out.ID, OcrEnabled: *in.OCREnabled}); err != nil {
			return err
		}
		out.OcrEnabled = *in.OCREnabled
	}
	return s.setBoilerplate(ctx, q, tx, a, sc, *out, in.Boilerplate)
}
