// A session's life: start (active at once, or pending a second admin),
// approve, deny, end (or withdraw), and the sweep that expires sessions and
// lapses requests. Each step is audited and notifies in its transaction.

package breakglass

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// StartInput is a request for a session on a team (slug or ID).
type StartInput struct {
	Team     string
	Reason   string
	Scopes   []string
	Duration time.Duration // 0: the default (1 hour, capped at the maximum)
}

// Start opens a session for the actor (a platform admin with a browser
// session). Without the approval setting it is active at once and the
// team's owners are notified; with it, it waits for another platform admin
// until the approval timeout. An admin has at most one open session per
// team.
func (s *Service) Start(ctx context.Context, a authz.Actor, in StartInput) (Session, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Session{}, apperr.Forbidden("Only platform admins can start a break-glass session")
	}
	acc, err := s.Teams.Get(ctx, a, in.Team)
	if err != nil {
		return Session{}, err
	}
	var id uuid.UUID
	var reached string
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		set, err := s.settings(ctx, q)
		if err != nil {
			return err
		}
		req, err := authz.NormalizeBreakGlassRequest(a, authz.BreakGlassRequest{
			TeamID: acc.Team.ID, Reason: in.Reason, Scopes: in.Scopes, Duration: in.Duration,
		}, set.BreakGlassPolicy)
		if err != nil {
			return err
		}
		now := s.now()
		p := dbgen.InsertBreakGlassSessionParams{
			TeamID: acc.Team.ID, RequestedBy: a.UserID, Reason: req.Reason, Scopes: req.Scopes,
			DurationMinutes: minutes(req.Duration), Status: authz.BreakGlassActive, RequestedAt: now,
		}
		if set.ApprovalRequired {
			deadline := now.Add(set.ApprovalTimeout)
			p.Status, p.ApprovalDeadline = authz.BreakGlassPending, &deadline
		} else {
			end := now.Add(req.Duration)
			p.StartedAt, p.ExpiresAt = &now, &end
		}
		row, err := q.InsertBreakGlassSession(ctx, p)
		if err != nil {
			return err
		}
		id, reached = row.ID, row.Status
		e := sessionAudit(a, "breakglass.start", row)
		e.After = sessionSnapshot(row)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return s.notifyStart(ctx, q, tx, a, row, "")
	})
	if apperr.IsUniqueViolation(err, "break_glass_sessions_open_key") {
		return Session{}, apperr.Conflict("break_glass_open", "You already have an open break-glass session for this team: end it first")
	}
	if err != nil {
		return Session{}, err
	}
	observeTransitions(reached)
	return s.get(ctx, id)
}

// observeTransitions counts committed session transitions by the status
// reached (grounded_breakglass_sessions_total).
func observeTransitions(statuses ...string) {
	for _, st := range statuses {
		observability.BreakGlassSessions.WithLabelValues(st).Inc()
	}
}

// notifyStart tells the owners that an active session started, or asks the
// other platform admins to approve a pending one.
func (s *Service) notifyStart(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, row dbgen.BreakGlassSession, approvedBy string) error {
	team, info, err := s.describe(ctx, q, row)
	if err != nil {
		return err
	}
	if row.Status == authz.BreakGlassActive {
		return s.Notify.Emit(ctx, tx, notify.BreakGlassStartedEvent(team, info, approvedBy).By(a.UserID))
	}
	admins, err := q.ActivePlatformAdminIDs(ctx)
	if err != nil {
		return err
	}
	admins = slices.DeleteFunc(admins, func(id uuid.UUID) bool { return id == row.RequestedBy })
	if len(admins) == 0 {
		return nil
	}
	return s.Notify.Emit(ctx, tx, notify.BreakGlassRequestedEvent(team, info, admins, *row.ApprovalDeadline).By(a.UserID))
}

// Approve starts a pending session: another platform admin, before the
// request lapses. The session's time starts now.
func (s *Service) Approve(ctx context.Context, a authz.Actor, id uuid.UUID) (Session, error) {
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := lock(ctx, q, id)
		if err != nil {
			return err
		}
		now := s.now()
		if err := authz.CheckBreakGlassDecision(a, rule(cur), now); err != nil {
			return err
		}
		end := now.Add(time.Duration(cur.DurationMinutes) * time.Minute)
		row, err := q.ApproveBreakGlassSession(ctx, dbgen.ApproveBreakGlassSessionParams{
			ID: id, DecidedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}, Now: &now, ExpiresAt: &end,
		})
		if err != nil {
			return err
		}
		e := sessionAudit(a, "breakglass.approve", row)
		e.Before, e.After = sessionSnapshot(cur), sessionSnapshot(row)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		approver, err := s.userName(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		if err := s.notifyStart(ctx, q, tx, a, row, approver); err != nil {
			return err
		}
		return s.notifyDecided(ctx, q, tx, a, row, "approved", approver, "")
	})
	if err != nil {
		return Session{}, err
	}
	observeTransitions(authz.BreakGlassActive)
	return s.get(ctx, id)
}

// Deny refuses a pending session with a reason (another platform admin).
func (s *Service) Deny(ctx context.Context, a authz.Actor, id uuid.UUID, note string) (Session, error) {
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := lock(ctx, q, id)
		if err != nil {
			return err
		}
		now := s.now()
		if err := authz.CheckBreakGlassDecision(a, rule(cur), now); err != nil {
			return err
		}
		if note, err = authz.CheckBreakGlassDenyNote(note); err != nil {
			return err
		}
		row, err := q.CloseBreakGlassSession(ctx, dbgen.CloseBreakGlassSessionParams{
			ID: id, Status: authz.BreakGlassDenied, Now: &now,
			DecidedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}, DecisionNote: &note,
		})
		if err != nil {
			return err
		}
		e := sessionAudit(a, "breakglass.deny", row)
		e.Before, e.After = sessionSnapshot(cur), sessionSnapshot(row)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		by, err := s.userName(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		return s.notifyDecided(ctx, q, tx, a, row, "denied", by, note)
	})
	if err != nil {
		return Session{}, err
	}
	observeTransitions(authz.BreakGlassDenied)
	return s.get(ctx, id)
}

// End ends an active session now (the admin who reads, or another platform
// admin revoking it), or withdraws the actor's own pending request. The
// owners get the summary of what was read.
func (s *Service) End(ctx context.Context, a authz.Actor, id uuid.UUID) (Session, error) {
	var reached string
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := lock(ctx, q, id)
		if err != nil {
			return err
		}
		now := s.now()
		// Ending a session whose time just ran out records the expiry.
		if a.IsPlatformAdmin() && a.Key == nil && cur.Status == authz.BreakGlassActive && rule(cur).EffectiveStatus(now) == authz.BreakGlassExpired {
			reached = closedStatus(cur)
			return s.close(ctx, q, tx, cur, now)
		}
		status, err := authz.BreakGlassEndStatus(a, rule(cur), now)
		if err != nil {
			return err
		}
		row, err := q.CloseBreakGlassSession(ctx, dbgen.CloseBreakGlassSessionParams{
			ID: id, Status: status, Now: &now, EndedBy: uuid.NullUUID{UUID: a.UserID, Valid: true},
		})
		if err != nil {
			return err
		}
		reached = status
		action, revoked := "breakglass.end", a.UserID != row.RequestedBy
		if status == authz.BreakGlassCancelled {
			action = "breakglass.cancel"
		}
		e := sessionAudit(a, action, row)
		e.Before, e.After = sessionSnapshot(cur), sessionSnapshot(row)
		e.Metadata["revoked"] = revoked
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		if status == authz.BreakGlassCancelled {
			return nil
		}
		how := "ended"
		if revoked {
			how = "was revoked"
		}
		return s.notifyEnded(ctx, q, tx, a.UserID, row, how)
	})
	if err != nil {
		return Session{}, err
	}
	observeTransitions(reached)
	return s.get(ctx, id)
}

// Sweep expires active sessions past their end and lapses pending requests
// past their deadline (system actions, audited as breakglass.expire and
// breakglass.request_expire). Access already stops at the end time; the
// sweep records it and sends the owners' summary. It runs every minute in
// the worker, and is safe to run in several processes at once.
func (s *Service) Sweep(ctx context.Context) (int, error) {
	var reached []string
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		now := s.now()
		due, err := q.DueBreakGlassSessions(ctx, &now)
		if err != nil {
			return err
		}
		reached = make([]string, 0, len(due))
		for _, row := range due {
			if err := s.close(ctx, q, tx, row, now); err != nil {
				return err
			}
			reached = append(reached, closedStatus(row))
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	observeTransitions(reached...)
	return len(reached), nil
}

// closedStatus is the status close gives a session: expired when it was
// active, request_expired when it was pending.
func closedStatus(cur dbgen.BreakGlassSession) string {
	if cur.Status == authz.BreakGlassPending {
		return authz.BreakGlassRequestExpired
	}
	return authz.BreakGlassExpired
}

// close records the expiry of an active session or the lapse of a pending
// one (row is locked).
func (s *Service) close(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, cur dbgen.BreakGlassSession, now time.Time) error {
	status, action := closedStatus(cur), "breakglass.expire"
	if status == authz.BreakGlassRequestExpired {
		action = "breakglass.request_expire"
	}
	row, err := q.CloseBreakGlassSession(ctx, dbgen.CloseBreakGlassSessionParams{ID: cur.ID, Status: status, Now: &now})
	if err != nil {
		return err
	}
	e := audit.Entry{ActorKind: audit.ActorSystem, TeamID: row.TeamID, Action: action, TargetType: "break_glass_session",
		TargetID: row.ID.String(), Before: sessionSnapshot(cur), After: sessionSnapshot(row),
		Metadata: map[string]any{"teamId": row.TeamID.String(), "requestedBy": row.RequestedBy.String()}}
	if err := audit.Record(ctx, q, e); err != nil {
		return err
	}
	if status == authz.BreakGlassExpired {
		return s.notifyEnded(ctx, q, tx, uuid.Nil, row, "expired")
	}
	return s.notifyDecided(ctx, q, tx, authz.Actor{}, row, "lapsed", "", "")
}

func (s *Service) notifyDecided(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, row dbgen.BreakGlassSession, decision, by, note string) error {
	team, info, err := s.describe(ctx, q, row)
	if err != nil {
		return err
	}
	return s.Notify.Emit(ctx, tx, notify.BreakGlassDecidedEvent(team, info, row.RequestedBy, decision, by, note).By(a.UserID))
}

func (s *Service) notifyEnded(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, actor uuid.UUID, row dbgen.BreakGlassSession, how string) error {
	team, info, err := s.describe(ctx, q, row)
	if err != nil {
		return err
	}
	counts, err := q.BreakGlassReadCounts(ctx, row.ID.String())
	if err != nil {
		return err
	}
	return s.Notify.Emit(ctx, tx, notify.BreakGlassEndedEvent(team, info, how, SummaryLines(counts)).By(actor))
}

// describe names a session's team and admin for its notifications.
func (s *Service) describe(ctx context.Context, q *dbgen.Queries, row dbgen.BreakGlassSession) (notify.TeamRef, notify.BreakGlassInfo, error) {
	t, err := q.GetTeamByID(ctx, row.TeamID)
	if err != nil {
		return notify.TeamRef{}, notify.BreakGlassInfo{}, err
	}
	admin, err := s.userName(ctx, q, row.RequestedBy)
	if err != nil {
		return notify.TeamRef{}, notify.BreakGlassInfo{}, err
	}
	info := notify.BreakGlassInfo{SessionID: row.ID, Admin: admin, Reason: row.Reason, Scopes: ScopeWords(row.Scopes)}
	if row.ExpiresAt != nil {
		info.ExpiresAt = *row.ExpiresAt
	}
	return notify.TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, info, nil
}

func (s *Service) userName(ctx context.Context, q *dbgen.Queries, id uuid.UUID) (string, error) {
	u, err := q.GetUser(ctx, id)
	if err != nil {
		return "", err
	}
	return Person{ID: u.ID, DisplayName: u.DisplayName, Email: u.Email}.Name(), nil
}

// ScopeWords renders scopes for people: "conversations", "documents",
// "conversations and documents".
func ScopeWords(scopes []string) string {
	return strings.Join(scopes, " and ")
}

// sessionAudit is an entry about a session, in its team's log too (the
// team's owners and admins see break-glass on their team).
func sessionAudit(a authz.Actor, action string, row dbgen.BreakGlassSession) audit.Entry {
	e := a.Audit(action, "break_glass_session", row.ID.String())
	e.TeamID = row.TeamID
	if e.Metadata == nil {
		e.Metadata = map[string]any{}
	}
	e.Metadata["teamId"], e.Metadata["requestedBy"] = row.TeamID.String(), row.RequestedBy.String()
	return e
}

func sessionSnapshot(r dbgen.BreakGlassSession) map[string]any {
	m := map[string]any{
		"status": r.Status, "scopes": r.Scopes, "durationMinutes": r.DurationMinutes, "reason": r.Reason,
	}
	for k, t := range map[string]*time.Time{"approvalDeadline": r.ApprovalDeadline, "startedAt": r.StartedAt, "expiresAt": r.ExpiresAt, "endedAt": r.EndedAt} {
		if t != nil {
			m[k] = t.UTC().Format(time.RFC3339)
		}
	}
	if r.DecisionNote != "" {
		m["decisionNote"] = r.DecisionNote
	}
	return m
}
