// Package profilemig moves a knowledge base to another embedding profile
// without downtime (docs/phase5-deploy.md §5 P2, ADR-0007, DESIGN.md §10
// "Changing embedding profiles").
//
// A migration gives each source of the KB an embedding set for the target
// profile (source_embedding_sets): the embedding_set.sync job embeds the
// source's ready documents into it from their stored parsed text, throttled
// by the target connection's request limit and the shared batcher. While
// it runs the KB keeps searching its old profile. When every source is
// complete, the KB's profile flips in one transaction; the old vectors are
// kept for a grace period, during which the KB can switch back. A cleanup
// job deletes every set nothing needs any more: a shared source keeps both
// sets until every KB using it has moved.
//
// Platform admins start, cancel and switch back migrations: the embedding
// load is platform-wide and shared sources span teams. Auditors read them;
// team members see their KB's migration on the KB page.
package profilemig

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Statuses.
const (
	StatusRunning      = "running"
	StatusSwitched     = "switched"
	StatusCompleted    = "completed"
	StatusCancelled    = "cancelled"
	StatusSwitchedBack = "switched_back"
)

// Source states in a migration's progress.
const (
	StateInProgress = "in_progress"
	StateComplete   = "complete"
	StateAttention  = "attention"
)

// Options are the install's settings.
type Options struct {
	GraceDays   int // default grace period (PROFILE_MIGRATION_GRACE_DAYS)
	BatchSize   int // inputs per embedding request (EMBED_BATCH_SIZE), for estimates
	BatchTokens int // tokens per embedding request (EMBED_BATCH_TOKENS; 0 = none)
}

// Service runs profile migrations.
type Service struct {
	Pool    *pgxpool.Pool
	Catalog *catalog.Service
	Teams   *teams.Service
	// Notify tells admins and teams about switches and failures (nil: nobody).
	Notify *notify.Service
	// Jobs enqueues embedding and cleanup jobs (may be insert-only; nil: the
	// sweep enqueues them).
	Jobs *river.Client[pgx.Tx]
	Opts Options
	Log  *slog.Logger
	q    *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, c *catalog.Service, t *teams.Service, n *notify.Service, jobs *river.Client[pgx.Tx], opts Options, log *slog.Logger) *Service {
	if opts.BatchSize <= 0 {
		opts.BatchSize = 64
	}
	return &Service{Pool: pool, Catalog: c, Teams: t, Notify: n, Jobs: jobs, Opts: opts, Log: log, q: dbgen.New(pool)}
}

var (
	errNotFound  = apperr.NotFound("migration_not_found", "Profile migration not found")
	errAdminOnly = apperr.Forbidden("Only platform admins can migrate knowledge bases between embedding profiles")
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see profile migrations")
)

// Estimate is what a migration involves (stored with it, counts only).
type Estimate struct {
	Documents         int64    `json:"documents"`
	Passages          int64    `json:"passages"`
	Tokens            int64    `json:"tokens"`
	EmbeddingCalls    int64    `json:"embeddingCalls"`
	RequestsPerMinute *int32   `json:"requestsPerMinute"`
	Minutes           *float64 `json:"minutes"`
	Rechunk           bool     `json:"rechunk"`
}

// Progress totals a running migration's sources.
type Progress struct {
	Sources, SourcesComplete, Documents, Done, Failed, Waiting int64
}

// SourceProgress is one source of a running migration.
type SourceProgress struct {
	ID                               uuid.UUID
	Name                             string
	Shared                           bool
	State                            string
	Documents, Done, Failed, Waiting int64
	Error                            string
}

// Migration is a migration with its names, progress and (for one
// migration) per-source detail.
type Migration struct {
	dbgen.ListProfileMigrationViewsRow
	Estimate Estimate
	Progress Progress
	Sources  []SourceProgress
	Failures []dbgen.ListSetFailuresRow
}

// CanSwitchBack reports whether the KB may switch back now.
func (m Migration) CanSwitchBack() bool {
	pm := m.ProfileMigration
	return pm.Status == StatusSwitched && pm.OldVectorsUntil != nil && pm.OldVectorsUntil.After(timeNow())
}

// ListKBs lists every KB for the admin page (metadata only).
func (s *Service) ListKBs(ctx context.Context, a authz.Actor) ([]dbgen.AdminKBListRow, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	return s.q.AdminKBList(ctx)
}

// List lists migrations, newest first, optionally of one KB.
func (s *Service) List(ctx context.Context, a authz.Actor, kbID *uuid.UUID) ([]Migration, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	p := dbgen.ListProfileMigrationViewsParams{MaxRows: 200}
	if kbID != nil {
		p.KBID = uuid.NullUUID{UUID: *kbID, Valid: true}
	}
	rows, err := s.q.ListProfileMigrationViews(ctx, p)
	if err != nil {
		return nil, err
	}
	out := make([]Migration, len(rows))
	for i, r := range rows {
		if out[i], err = s.view(ctx, r, false); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Get returns one migration with per-source progress and failed documents.
func (s *Service) Get(ctx context.Context, a authz.Actor, id uuid.UUID) (Migration, error) {
	if !a.CanReadPlatform() {
		return Migration{}, errReadOnly
	}
	return s.load(ctx, id, true)
}

func (s *Service) load(ctx context.Context, id uuid.UUID, detail bool) (Migration, error) {
	rows, err := s.q.ListProfileMigrationViews(ctx, dbgen.ListProfileMigrationViewsParams{ID: uuid.NullUUID{UUID: id, Valid: true}, MaxRows: 1})
	if err != nil {
		return Migration{}, err
	}
	if len(rows) == 0 {
		return Migration{}, errNotFound
	}
	return s.view(ctx, rows[0], detail)
}

// ForKB returns a KB's running or switched migration for its team's
// members (nil: none).
func (s *Service) ForKB(ctx context.Context, a authz.Actor, teamRef string, kbID uuid.UUID) (*Migration, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return nil, err
	}
	kb, err := s.q.GetKB(ctx, kbID)
	if acc.Role == "" || errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && kb.TeamID != acc.Team.ID) ||
		(err == nil && a.Key != nil && !a.Key.AllowsKB(kb.ID)) {
		return nil, apperr.NotFound("kb_not_found", "Knowledge base not found")
	} else if err != nil {
		return nil, err
	}
	rows, err := s.q.ListProfileMigrationViews(ctx, dbgen.ListProfileMigrationViewsParams{
		KBID: uuid.NullUUID{UUID: kbID, Valid: true}, ActiveOnly: true, MaxRows: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	m, err := s.view(ctx, rows[0], true)
	m.Failures = nil // document titles of shared sources stay with platform staff
	return &m, err
}

// view adds the estimate and, for a running migration, its progress.
func (s *Service) view(ctx context.Context, r dbgen.ListProfileMigrationViewsRow, detail bool) (Migration, error) {
	m := Migration{ListProfileMigrationViewsRow: r}
	_ = json.Unmarshal(r.ProfileMigration.Estimate, &m.Estimate)
	pm := r.ProfileMigration
	if pm.Status != StatusRunning {
		return m, nil
	}
	sources, err := s.q.KBSourceFigures(ctx, dbgen.KBSourceFiguresParams{KBID: pm.KBID, ProfileID: pm.ToProfileID})
	if err != nil {
		return m, err
	}
	ids := make([]uuid.UUID, 0, len(sources))
	for _, src := range sources {
		sp, err := s.sourceProgress(ctx, src, pm.ToProfileID)
		if err != nil {
			return m, err
		}
		m.Progress.add(sp)
		if detail {
			m.Sources = append(m.Sources, sp)
		}
		ids = append(ids, src.ID)
	}
	if detail {
		m.Failures, err = s.q.ListSetFailures(ctx, dbgen.ListSetFailuresParams{SourceIds: ids, ProfileID: pm.ToProfileID, MaxRows: 50})
	}
	return m, err
}

func (p *Progress) add(sp SourceProgress) {
	p.Sources++
	if sp.State == StateComplete {
		p.SourcesComplete++
	}
	p.Documents += sp.Documents
	p.Done += sp.Done
	p.Failed += sp.Failed
	p.Waiting += sp.Waiting
}

// sourceProgress is one source's progress towards a profile.
func (s *Service) sourceProgress(ctx context.Context, src dbgen.KBSourceFiguresRow, profileID uuid.UUID) (SourceProgress, error) {
	pr, err := s.q.EmbeddingSetProgress(ctx, dbgen.EmbeddingSetProgressParams{SourceID: src.ID, ProfileID: profileID})
	if err != nil {
		return SourceProgress{}, err
	}
	sp := SourceProgress{ID: src.ID, Name: src.Name, Shared: src.Shared, Documents: pr.Documents, Done: pr.Done,
		Failed: pr.Failed, Waiting: pr.Waiting, Error: src.SetError}
	switch {
	case pr.Done >= pr.Documents:
		sp.State = StateComplete
	case pr.Failed > 0:
		sp.State = StateAttention
	default:
		sp.State = StateInProgress
	}
	return sp, nil
}

// complete reports whether every source of the KB has vectors for the
// profile for all its ready documents.
func complete(ctx context.Context, q *dbgen.Queries, kbID, profileID uuid.UUID) (bool, int64, error) {
	sources, err := q.KBSources(ctx, kbID)
	if err != nil {
		return false, 0, err
	}
	var missing int64
	for _, src := range sources {
		pr, err := q.EmbeddingSetProgress(ctx, dbgen.EmbeddingSetProgressParams{SourceID: src.ID, ProfileID: profileID})
		if err != nil {
			return false, 0, err
		}
		missing += max(pr.Documents-pr.Done, 0)
	}
	return missing == 0, missing, nil
}
