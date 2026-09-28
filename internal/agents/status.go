// Agent status: the team's enable/disable switch and the platform kill
// switch (docs/phase3-agents.md).

package agents

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// SetStatus enables or disables an agent for its team (team admins). Teams
// cannot clear a platform kill switch.
func (s *Service) SetStatus(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, status, reason string) (View, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleAdmin)
	if err != nil {
		return View{}, err
	}
	if status != StatusActive && status != StatusDisabledByTeam {
		return View{}, apperr.Invalid("invalid_status", "Status must be active or disabled_by_team")
	}
	var out dbgen.Agent
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.loadAgent(ctx, q, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		if cur.Status == StatusDisabledByPlatform {
			return apperr.New(403, "agent_disabled_by_platform", "A platform admin disabled this agent. Only a platform admin can enable it.")
		}
		out, err = s.setStatus(ctx, q, a, cur, status, reason, acc.Team.ID)
		return err
	})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, out, acc.Team, true)
}

func (s *Service) setStatus(ctx context.Context, q *dbgen.Queries, a authz.Actor, cur dbgen.Agent, status, reason string, auditTeam uuid.UUID) (dbgen.Agent, error) {
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) > 500 {
		return cur, apperr.Invalid("invalid_reason", "The reason must be at most 500 characters")
	}
	p := dbgen.SetAgentStatusParams{ID: cur.ID, Status: status}
	if status != StatusActive {
		now := time.Now()
		p.DisabledReason, p.DisabledAt = reason, &now
		p.DisabledBy = uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
	}
	out, err := q.SetAgentStatus(ctx, p)
	if err != nil {
		return out, err
	}
	if cur.Status != status {
		e := a.Audit("agent.status", "agent", cur.ID.String())
		e.TeamID = auditTeam
		e.Before, e.After = map[string]any{"status": cur.Status}, map[string]any{"status": status, "reason": reason}
		if err := audit.Record(ctx, q, e); err != nil {
			return out, err
		}
	}
	return out, nil
}

// AdminAgent is an agent's metadata for platform staff (never content or
// configuration details beyond the model and classification).
type AdminAgent = dbgen.AdminListAgentsRow

// AdminList lists agents across teams (platform admins and auditors).
func (s *Service) AdminList(ctx context.Context, a authz.Actor, team, status *string) ([]AdminAgent, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return nil, apperr.Forbidden("Only platform admins and auditors can see this")
	}
	return s.q.AdminListAgents(ctx, dbgen.AdminListAgentsParams{Team: team, Status: status})
}

// AdminSetStatus is the platform kill switch: disabled_by_platform (reason
// required) or active.
func (s *Service) AdminSetStatus(ctx context.Context, a authz.Actor, id uuid.UUID, status, reason string) (AdminAgent, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return AdminAgent{}, apperr.Forbidden("Only platform admins can do this")
	}
	if status != StatusActive && status != StatusDisabledByPlatform {
		return AdminAgent{}, apperr.Invalid("invalid_status", "Status must be active or disabled_by_platform")
	}
	if status == StatusDisabledByPlatform && len(strings.TrimSpace(reason)) < 5 {
		return AdminAgent{}, apperr.Invalid("reason_required", "Explain why the agent is being disabled")
	}
	var teamID uuid.UUID
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := q.LockAgent(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoAgent
		} else if err != nil {
			return err
		}
		teamID = cur.TeamID
		if _, err = s.setStatus(ctx, q, a, cur, status, reason, cur.TeamID); err != nil {
			return err
		}
		if status != StatusDisabledByPlatform || cur.Status == status {
			return nil
		}
		return s.notifyDisabled(ctx, q, tx, a, cur, reason)
	})
	if err != nil {
		return AdminAgent{}, err
	}
	return s.adminAgent(ctx, teamID, id)
}

// notifyDisabled tells the team's admins and owners that the platform kill
// switch disabled their agent (mandatory; docs/phase4-publishing.md §8).
func (s *Service) notifyDisabled(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, ag dbgen.Agent, reason string) error {
	if s.Notify == nil {
		return nil
	}
	t, err := q.GetTeamByID(ctx, ag.TeamID)
	if err != nil {
		return err
	}
	ev := notify.AgentDisabledEvent(notify.TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, ag.ID, ag.Name, strings.TrimSpace(reason))
	return s.Notify.Emit(ctx, tx, ev.By(a.UserID))
}

func ptr[T any](v T) *T { return &v }
