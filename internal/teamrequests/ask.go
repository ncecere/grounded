package teamrequests

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/displaytext"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/strutil"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Request is a team request as the person who made it sees it.
type Request struct {
	ID             uuid.UUID
	Name           string
	Purpose        string
	OwnerEmail     string
	Classification string
	// ApprovedClassification is the level the reviewer approved ("": not approved). The reviewer may change what was asked for. The queries
	// resolve it (queries/team_requests.sql): the column, or for a request whose column is empty (approved before migration 00055 or by a
	// previous release's pod) what the approval recorded in the audit log, else the team's level, else the level asked for.
	ApprovedClassification string
	Status                 string
	DecisionReason         string
	DecidedAt              *time.Time
	// TeamSlug and TeamName are the team an approval created ("": none, or deleted since).
	TeamSlug  string
	TeamName  string
	Revision  int64
	CreatedAt time.Time
}

// Mine is what the request page needs: whether the person can ask now, and why not, and their requests.
type Mine struct {
	Enabled   bool
	CanAsk    bool
	Blocked   string
	MaxOpen   int
	OpenCount int
	Items     []Request
}

// Mine lists the person's requests and whether they may ask now. It answers while the feature is off (the page then says so and shows
// the requests already open), but nobody can ask.
func (s *Service) Mine(ctx context.Context, a authz.Actor) (Mine, error) {
	if a.Delegated() || a.UserID == uuid.Nil {
		return Mine{}, errSignedInOnly
	}
	st, err := s.q.GetTeamRequestSettings(ctx)
	if err != nil {
		return Mine{}, err
	}
	rows, err := s.q.ListMyTeamRequests(ctx, a.UserID)
	if err != nil {
		return Mine{}, err
	}
	out := Mine{Enabled: st.Enabled, MaxOpen: int(st.MaxOpen), Items: make([]Request, len(rows))}
	for i, r := range rows {
		out.Items[i] = Request{ID: r.ID, Name: r.Name, Purpose: r.Purpose, OwnerEmail: r.OwnerEmail, Classification: r.Classification,
			ApprovedClassification: r.ApprovedLevel, Status: r.Status,
			DecisionReason: r.DecisionReason, DecidedAt: r.DecidedAt, TeamSlug: strutil.Deref(r.TeamSlug), TeamName: strutil.Deref(r.TeamName), Revision: r.Revision, CreatedAt: r.CreatedAt}
		if r.Status == StatusPending {
			out.OpenCount++
		}
	}
	switch err := s.mayAsk(ctx, s.q, a, st, out.OpenCount); {
	case err == nil:
		out.CanAsk = true
	case errors.Is(err, errOff):
		out.Blocked = BlockedOff
	case errors.Is(err, errNotInGroup):
		out.Blocked = BlockedGroup
	case errors.Is(err, errTooManyOpen):
		out.Blocked = BlockedLimit
	default:
		return Mine{}, err
	}
	return out, nil
}

// mayAsk is the three gates on asking, in the order a person should hear of them: the switch, who may ask, how many are open.
func (s *Service) mayAsk(ctx context.Context, q *dbgen.Queries, a authz.Actor, st dbgen.TeamRequestSetting, open int) error {
	if !st.Enabled {
		return errOff
	}
	if st.AllowedGroup != "" {
		groups, err := q.UserSSOGroups(ctx, a.UserID)
		if err != nil && !errors.Is(store.NotFound(err), store.ErrNotFound) {
			return err
		}
		if !slices.Contains(groups, st.AllowedGroup) {
			return errNotInGroup
		}
	}
	if open >= int(st.MaxOpen) {
		return errTooManyOpen
	}
	return nil
}

// RequestInput is what a person asks for.
type RequestInput struct {
	Name, Purpose, OwnerEmail, Classification string
}

// Ask records a request and tells the platform admins.
func (s *Service) Ask(ctx context.Context, a authz.Actor, in RequestInput) (Request, error) {
	if a.Delegated() || a.UserID == uuid.Nil {
		return Request{}, errSignedInOnly
	}
	if err := displaytext.Validate(in.Name, "invalid_name", "Name"); err != nil {
		return Request{}, err
	}
	name, purpose := strings.TrimSpace(in.Name), strings.TrimSpace(in.Purpose)
	if n := len([]rune(name)); n < 1 || n > 80 {
		return Request{}, apperr.Invalid("invalid_name", "Name must be 1-80 characters")
	}
	if n := len([]rune(purpose)); n < 1 || n > 1000 {
		return Request{}, apperr.Invalid("invalid_purpose", "Say what the team is for, in up to 1000 characters")
	}
	owner := ""
	if strings.TrimSpace(in.OwnerEmail) != "" {
		e, err := teams.NormalizeEmail(in.OwnerEmail)
		if err != nil {
			return Request{}, err
		}
		owner = e
	}
	var out dbgen.TeamRequest
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		// The settings row is locked for the whole request, so two requests by one person cannot both pass the limit.
		st, err := q.LockTeamRequestSettings(ctx)
		if err != nil {
			return err
		}
		open, err := q.CountOpenTeamRequests(ctx, a.UserID)
		if err != nil {
			return err
		}
		if err := s.mayAsk(ctx, q, a, st, int(open)); err != nil {
			return err
		}
		if _, err := q.GetClassification(ctx, in.Classification); errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.Invalid("unknown_classification", "Unknown classification level")
		} else if err != nil {
			return err
		}
		if out, err = q.InsertTeamRequest(ctx, dbgen.InsertTeamRequestParams{
			RequesterID: a.UserID, Name: name, Purpose: purpose, OwnerEmail: owner, Classification: in.Classification,
		}); err != nil {
			return err
		}
		e := a.Audit("team_request.create", "team_request", out.ID.String())
		e.After = map[string]any{"name": name, "classification": in.Classification, "ownerEmail": owner}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		admins, err := q.ActivePlatformAdminIDs(ctx)
		if err != nil {
			return err
		}
		// The webhook gets the request's ID, its name and classification: never its purpose or who asked.
		if err := s.Webhooks.Emit(ctx, tx, webhooks.Event{Type: webhooks.EventTeamRequestCreated, Data: map[string]any{
			"requestId": out.ID, "name": name, "classification": in.Classification}}); err != nil {
			return err
		}
		who, _ := q.GetTeamRequestRequesterName(ctx, a.UserID)
		return s.Notify.Emit(ctx, tx, notify.TeamRequestNewEvent(admins, out.ID, name, who, purpose).By(a.UserID))
	})
	if err != nil {
		return Request{}, err
	}
	return Request{ID: out.ID, Name: out.Name, Purpose: out.Purpose, OwnerEmail: out.OwnerEmail, Classification: out.Classification, Status: out.Status,
		Revision: out.Revision, CreatedAt: out.CreatedAt}, nil
}

// Withdraw ends the person's own pending request.
func (s *Service) Withdraw(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if a.Delegated() || a.UserID == uuid.Nil {
		return errSignedInOnly
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		r, err := q.WithdrawTeamRequest(ctx, dbgen.WithdrawTeamRequestParams{ID: id, RequesterID: a.UserID})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			// Someone else's, or already decided: the same answer, so a request's existence is not revealed.
			return errNotFound
		} else if err != nil {
			return err
		}
		e := a.Audit("team_request.withdraw", "team_request", r.ID.String())
		e.After = map[string]any{"name": r.Name}
		return audit.Record(ctx, q, e)
	})
}
