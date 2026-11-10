package teamrequests

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// AdminRequest is a request as reviewers see it.
type AdminRequest struct {
	Request
	RequesterID    uuid.UUID
	RequesterEmail string
	RequesterName  string
	DeciderEmail   string
	// OwnerSuspended: a pending request whose would-be owner (the person named, else the requester) is suspended. Approving it needs another owner.
	OwnerSuspended bool
}

func adminOf(r dbgen.GetTeamRequestRow) AdminRequest {
	return AdminRequest{
		Request: Request{ID: r.ID, Name: r.Name, Purpose: r.Purpose, OwnerEmail: r.OwnerEmail, Classification: r.Classification,
			ApprovedClassification: r.ApprovedLevel, Status: r.Status,
			DecisionReason: r.DecisionReason, DecidedAt: r.DecidedAt, TeamSlug: deref(r.TeamSlug), TeamName: deref(r.TeamName), Revision: r.Revision, CreatedAt: r.CreatedAt},
		RequesterID: r.RequesterID, RequesterEmail: r.RequesterEmail, RequesterName: r.RequesterName, DeciderEmail: r.DeciderEmail, OwnerSuspended: r.OwnerSuspended.Bool,
	}
}

// List returns the review queue, pending first (platform admins and auditors); status "" is every status.
func (s *Service) List(ctx context.Context, a authz.Actor, status string) ([]AdminRequest, error) {
	if a.Delegated() || !a.CanReadPlatform() {
		return nil, apperr.Forbidden("Only platform admins and auditors can see team requests")
	}
	var filter *string
	if status != "" {
		if !slices.Contains([]string{StatusPending, StatusApproved, StatusDeclined, StatusWithdrawn}, status) {
			return nil, apperr.Invalid("invalid_status", "Status must be pending, approved, declined or withdrawn")
		}
		filter = &status
	}
	rows, err := s.q.ListTeamRequestsAdmin(ctx, filter)
	if err != nil {
		return nil, err
	}
	out := make([]AdminRequest, len(rows))
	for i, r := range rows {
		out[i] = adminOf(dbgen.GetTeamRequestRow(r))
	}
	return out, nil
}

// PendingCount is how many requests wait for a decision (the sidebar's count).
func (s *Service) PendingCount(ctx context.Context, a authz.Actor) (int64, error) {
	if a.Delegated() || !a.CanReadPlatform() {
		return 0, apperr.Forbidden("Only platform admins and auditors can see team requests")
	}
	return s.q.CountPendingTeamRequests(ctx)
}

// Get returns one request (platform admins and auditors).
func (s *Service) Get(ctx context.Context, a authz.Actor, id uuid.UUID) (AdminRequest, error) {
	if a.Delegated() || !a.CanReadPlatform() {
		return AdminRequest{}, apperr.Forbidden("Only platform admins and auditors can see team requests")
	}
	r, err := s.q.GetTeamRequest(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return AdminRequest{}, errNotFound
	} else if err != nil {
		return AdminRequest{}, err
	}
	return adminOf(r), nil
}

// ApproveInput is what the reviewer decides: the team's address (required: the request has none), and optionally another name, another
// classification, another owner and a template to start the team's first agent from. Empty values keep what the person asked for.
type ApproveInput struct {
	Slug              string
	Name              string
	MaxClassification string
	// OwnerEmail owns the team instead of the person named in the request or the requester. It is required when that person is suspended.
	OwnerEmail        string
	StarterTemplateID string
}

// Approve decides a pending request and creates the team in one step: the requester (or the person they named) becomes its owner. A
// failure (the address is taken, an unknown template) leaves the request pending and no team behind.
func (s *Service) Approve(ctx context.Context, a authz.Actor, id uuid.UUID, in ApproveInput, expectedRevision int64) (AdminRequest, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return AdminRequest{}, errAdminOnly
	}
	var team teams.Summary
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := q.LockTeamRequest(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNotFound
		} else if err != nil {
			return err
		}
		if cur.Status != StatusPending {
			return errAlreadyClosed
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		name := strings.TrimSpace(in.Name)
		if name == "" {
			name = cur.Name
		}
		class := in.MaxClassification
		if class == "" {
			class = cur.Classification
		}
		owner, otherOwner, err := s.teamOwner(ctx, q, cur, in.OwnerEmail)
		if err != nil {
			return err
		}
		if team, _, err = s.Teams.CreateTx(ctx, q, tx, a, teams.CreateInput{
			Slug: in.Slug, Name: name, Description: cur.Purpose, MaxClassification: class, OwnerEmail: owner,
		}); err != nil {
			return err
		}
		if in.StarterTemplateID != "" {
			if _, err := s.Agents.CreateStarterTx(ctx, q, a, team.Team.ID, in.StarterTemplateID); err != nil {
				return err
			}
		}
		if _, err = q.DecideTeamRequest(ctx, dbgen.DecideTeamRequestParams{
			ID: id, Status: StatusApproved, DecisionReason: "", DecidedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}, TeamID: uuid.NullUUID{UUID: team.Team.ID, Valid: true},
			ApprovedClassification: class,
		}); err != nil {
			return err
		}
		// In the new team's audit log too, so the team can see how it came to be.
		e := a.Audit("team_request.approve", "team_request", id.String())
		e.TeamID = team.Team.ID
		e.After = map[string]any{"name": name, "slug": team.Team.Slug, "classification": class, "ownerEmail": owner, "starterTemplateId": in.StarterTemplateID}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return s.Notify.Emit(ctx, tx, notify.TeamRequestDecidedEvent(cur.RequesterID, id, name, "approve", "", team.Team.Slug, otherOwner).By(a.UserID))
	})
	if err != nil {
		return AdminRequest{}, err
	}
	return s.Get(ctx, a, id)
}

// teamOwner is who owns the team an approval creates: the reviewer's choice, else the person the request named, else the requester. The
// second result is that person when it is not the requester (the requester is told someone else owns it). A suspended person is refused:
// the team would have no one who can sign in, and the reviewer is not warned at the end of a dialog; the request's OwnerSuspended says it
// up front and the reviewer names another owner.
func (s *Service) teamOwner(ctx context.Context, q *dbgen.Queries, cur dbgen.TeamRequest, chosen string) (owner, other string, err error) {
	asker, err := q.GetTeamRequestRequesterEmail(ctx, cur.RequesterID)
	if err != nil {
		return "", "", err
	}
	owner = cur.OwnerEmail
	if strings.TrimSpace(chosen) != "" {
		if owner, err = teams.NormalizeEmail(chosen); err != nil {
			return "", "", err
		}
	}
	if owner == "" {
		owner = asker
	}
	if n, err := q.CountSuspendedUsersByEmail(ctx, owner); err != nil {
		return "", "", err
	} else if n > 0 {
		return "", "", errOwnerSuspended
	}
	if !strings.EqualFold(asker, owner) {
		other = owner // someone else owns it: the asker is told, and is not on the team
	}
	return owner, other, nil
}

// Decline decides a pending request without creating a team; the reason is required and reaches the person who asked.
func (s *Service) Decline(ctx context.Context, a authz.Actor, id uuid.UUID, reason string, expectedRevision int64) (AdminRequest, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return AdminRequest{}, errAdminOnly
	}
	reason = strings.TrimSpace(reason)
	if n := len([]rune(reason)); n < 1 || n > 500 {
		return AdminRequest{}, apperr.Invalid("invalid_reason", "Say why in up to 500 characters: the person who asked will read it")
	}
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := q.LockTeamRequest(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNotFound
		} else if err != nil {
			return err
		}
		if cur.Status != StatusPending {
			return errAlreadyClosed
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if _, err := q.DecideTeamRequest(ctx, dbgen.DecideTeamRequestParams{
			ID: id, Status: StatusDeclined, DecisionReason: reason, DecidedBy: uuid.NullUUID{UUID: a.UserID, Valid: true},
		}); err != nil {
			return err
		}
		e := a.Audit("team_request.decline", "team_request", id.String())
		e.After = map[string]any{"name": cur.Name, "reason": reason}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return s.Notify.Emit(ctx, tx, notify.TeamRequestDecidedEvent(cur.RequesterID, id, cur.Name, "decline", reason, "", "").By(a.UserID))
	})
	if err != nil {
		return AdminRequest{}, err
	}
	return s.Get(ctx, a, id)
}
