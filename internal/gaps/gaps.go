// Package gaps is the unanswered-questions and gap report (docs/v0.4.0.md
// §2, docs/gaps.md, ADR-0010 as amended for v0.4.0).
//
// The chat pipeline keeps the question of every failed answer in a stored
// conversation, apart from the transcript (internal/agents, gaps.go). This
// package groups them into topics (an hourly River job: runner.go), labels a
// topic with the agent's chat model once at least MinAskers different
// people asked (label.go), and serves the report:
//
//   - a team's editors, admins and owners see topics (label, counts,
//     signals, trend), never a question's text or who asked, except the
//     questions their askers shared with a thumbs-down; they can dismiss a
//     topic, mark it fixed, go and add a source, and add a shared question
//     to an evaluation set (every action audited as gap_topic.*);
//   - platform admins and auditors see failure counts per team and signal
//     only (admin.go);
//   - members, API keys and everyone else get 404.
//
// A dismissed or fixed topic reopens when a newer failure joins it; an open
// topic resolves itself when its questions start being answered well.
// Questions go with their conversations (retention, legal holds and user
// deletes apply as to transcripts), and counts leave out conversations their
// users deleted, so a topic hides at once when it falls below MinAskers.
package gaps

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// MinAskers is the minimum crowd: a topic shows only once this many
// different askers are in it, so its label can't point at one person.
const MinAskers = 3

// Service serves the gap report.
type Service struct {
	Pool  *pgxpool.Pool
	Teams *teams.Service
	// Evals adds shared questions to evaluation sets (nil: refused).
	Evals *evals.Service
	Log   *slog.Logger
	q     *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, ev *evals.Service, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{Pool: pool, Teams: t, Evals: ev, Log: log, q: dbgen.New(pool)}
}

var (
	// errNotFound hides the report from members, keys and platform staff.
	errNotFound  = apperr.NotFound("not_found", "Not found")
	errNoTopic   = apperr.NotFound("gap_topic_not_found", "Topic not found")
	errNoShared  = apperr.NotFound("gap_question_not_found", "Shared question not found")
	errArchived  = apperr.Conflict("team_archived", "This team is archived and read-only")
	errBadState  = apperr.Invalid("invalid_state", "state must be open, closed or all")
	errLongNote  = apperr.Invalid("invalid_reason", "The reason can be at most 500 characters.")
	errNoEvals   = apperr.NotFound("not_found", "Evaluations aren't available")
	errClosedNow = apperr.Conflict("gap_topic_closed", "This topic is already closed")
)

// access resolves the team for an editor, admin or owner of it, in the app;
// everyone else gets 404. Writes need an active team.
func (s *Service) access(ctx context.Context, a authz.Actor, teamRef string, write bool) (teams.Access, error) {
	if a.Key != nil || a.UserID == uuid.Nil {
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

// audited records a topic action for the team in q's transaction. Entries
// never carry the label or a question: team audit logs are readable by
// platform staff, who see counts only.
func audited(ctx context.Context, q *dbgen.Queries, a authz.Actor, action string, teamID, topicID uuid.UUID, meta map[string]any) error {
	e := a.Audit(action, "gap_topic", topicID.String())
	e.TeamID = teamID
	if e.Metadata == nil {
		e.Metadata = map[string]any{}
	}
	for k, v := range meta {
		e.Metadata[k] = v
	}
	return audit.Record(ctx, q, e)
}
