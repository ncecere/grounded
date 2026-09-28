// Package evals implements evaluation sets and regression runs
// (docs/evaluations.md, docs/v0.2.0.md §3.1 A2, DESIGN.md §6.1).
//
// A set belongs to one knowledge base or one agent and holds test
// questions with what a good result is (expected documents, optionally
// phrases the answer must mention). A run checks every question with a
// River job, a few at a time:
//
//   - a retrieval check (the default) runs the retrieval the knowledge base
//     (kbs.RetrieveForEvaluation) or the agent (agents.EvalRetrieve, its
//     search across its knowledge bases) uses, and records whether an
//     expected document came back in the top k, at which rank, and what
//     came back instead; the run's recall@k and MRR follow;
//   - a full-answer check asks the agent each question as the Test panel
//     does (agents.EvalAnswer, no conversation) and scores the answer.
//
// Runs go through the normal query and chat limits (so budgets refuse them
// too) and their usage is tagged {"source": "evaluation"}.
//
// Who: editors, admins and owners of the set's team, in the app only.
// Members, API keys and platform staff get 404, and so does everyone while
// the platform switch (Admin → Limits › Evaluations) is off.
package evals

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// DefaultConcurrency is how many questions a run checks at once.
const DefaultConcurrency = 2

// Service manages evaluation sets and runs.
type Service struct {
	Pool   *pgxpool.Pool
	Teams  *teams.Service
	KBs    *kbs.Service
	Agents *agents.Service
	// Limits enforces the set and question limits (nil: none).
	Limits *limits.Service
	// Notify tells editors when an automatic run drops (nil: nobody).
	Notify *notify.Service
	// Jobs enqueues runs (may be insert-only; nil: runs stay queued).
	Jobs *river.Client[pgx.Tx]
	// Concurrency is how many questions a run checks at once.
	Concurrency int
	Log         *slog.Logger
	q           *dbgen.Queries
	now         func() time.Time
	// retryWait bounds how long a check waits for a per-minute limit
	// (tests shorten it).
	retryWait time.Duration
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, k *kbs.Service, ag *agents.Service, l *limits.Service, n *notify.Service,
	jobs *river.Client[pgx.Tx], log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{Pool: pool, Teams: t, KBs: k, Agents: ag, Limits: l, Notify: n, Jobs: jobs, Concurrency: DefaultConcurrency,
		Log: log, q: dbgen.New(pool), now: time.Now, retryWait: 2 * time.Minute}
}

var (
	// errNotFound hides evaluations from people who may not use them, and
	// from everyone while the feature is off.
	errNotFound    = apperr.NotFound("not_found", "Not found")
	errNoSet       = apperr.NotFound("evaluation_set_not_found", "Evaluation set not found")
	errNoQuestion  = apperr.NotFound("evaluation_question_not_found", "Question not found")
	errNoRun       = apperr.NotFound("evaluation_run_not_found", "Run not found")
	errAdminOnly   = apperr.Forbidden("Only platform admins can turn evaluations on or off")
	errArchived    = apperr.Conflict("team_archived", "This team is archived and read-only")
	errTargetFound = apperr.Invalid("invalid_target", "Choose a knowledge base or an agent of this team")
)

// Enabled reports the platform switch.
func (s *Service) Enabled(ctx context.Context) (bool, error) {
	st, err := s.q.GetEvaluationSettings(ctx)
	return st.Enabled, err
}

// Settings returns the platform switch (platform admins and auditors).
func (s *Service) Settings(ctx context.Context, a authz.Actor) (dbgen.EvaluationSetting, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return dbgen.EvaluationSetting{}, apperr.Forbidden("Only platform admins and auditors can see this setting")
	}
	return s.q.GetEvaluationSettings(ctx)
}

// SetEnabled turns evaluations on or off (platform admins; audited).
func (s *Service) SetEnabled(ctx context.Context, a authz.Actor, enabled bool, expectedRevision int64) (dbgen.EvaluationSetting, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return dbgen.EvaluationSetting{}, errAdminOnly
	}
	var out dbgen.EvaluationSetting
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockEvaluationSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.Enabled == enabled {
			out = cur
			return nil
		}
		if out, err = q.SetEvaluationsEnabled(ctx, dbgen.SetEvaluationsEnabledParams{Enabled: enabled, UpdatedBy: nullUser(a)}); err != nil {
			return err
		}
		e := a.Audit("platform.evaluations", "evaluation_settings", "enabled")
		e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": enabled}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// access resolves the team for an editor, admin or owner of it, in the
// app; everyone else, and everyone while evaluations are off, gets 404.
// Writes need an active team.
func (s *Service) access(ctx context.Context, a authz.Actor, teamRef string, write bool) (teams.Access, error) {
	on, err := s.Enabled(ctx)
	if err != nil {
		return teams.Access{}, err
	}
	if !on || a.Key != nil || a.UserID == uuid.Nil {
		return teams.Access{}, errNotFound
	}
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return acc, err
	}
	if !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
		return acc, errNotFound
	}
	if write && acc.Team.Status != teams.StatusActive {
		return acc, errArchived
	}
	return acc, nil
}

// loadSet loads a set of the team (locked in a transaction when lock).
func loadSet(ctx context.Context, q *dbgen.Queries, teamID, id uuid.UUID, lock bool) (dbgen.EvalSet, error) {
	var set dbgen.EvalSet
	var err error
	if lock {
		set, err = q.LockEvalSet(ctx, dbgen.LockEvalSetParams{ID: id, TeamID: teamID})
	} else {
		set, err = q.GetEvalSet(ctx, dbgen.GetEvalSetParams{ID: id, TeamID: teamID})
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return set, errNoSet
	}
	return set, err
}

func nullUser(a authz.Actor) uuid.NullUUID {
	return uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
}

func nullID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}

// audited records e for the team in q's transaction.
func audited(ctx context.Context, q *dbgen.Queries, e audit.Entry, teamID uuid.UUID) error {
	e.TeamID = teamID
	return audit.Record(ctx, q, e)
}
