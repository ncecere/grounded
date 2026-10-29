// Package teamrequests is the in-app request for a team (v0.6.0, E3; docs/specs/v0.6.0/DESIGN.md "Team requests"): anyone signed in asks, platform
// admins review, and approving creates the team with the requester (or the person they named) as its owner.
//
// A platform switch (off by default) turns the whole feature on and off. Off, nobody can ask (the API refuses too) and team creation stays
// with platform admins; requests already open stay in the review queue until someone decides them.
package teamrequests

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/displaytext"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Statuses of a request.
const (
	StatusPending   = "pending"
	StatusApproved  = "approved"
	StatusDeclined  = "declined"
	StatusWithdrawn = "withdrawn"
)

// Why a person cannot ask right now (Mine.Blocked).
const (
	BlockedOff   = "off"
	BlockedGroup = "group"
	BlockedLimit = "limit"
)

// Service handles team requests.
type Service struct {
	Pool   *pgxpool.Pool
	Teams  *teams.Service
	Agents *agents.Service
	// Notify tells platform admins of a new request and the person who asked of the decision (nil: nobody).
	Notify *notify.Service
	// Webhooks hears of new requests (nil: nobody).
	Webhooks *webhooks.Service
	q        *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, a *agents.Service, n *notify.Service) *Service {
	return &Service{Pool: pool, Teams: t, Agents: a, Notify: n, q: dbgen.New(pool)}
}

var (
	errNotFound      = apperr.NotFound("request_not_found", "Request not found")
	errAdminOnly     = apperr.Forbidden("Only platform admins can decide team requests")
	errSignedInOnly  = apperr.Forbidden("Team requests are for people signing in")
	errOff           = apperr.New(403, "team_requests_off", "Team requests are not turned on: ask a platform admin for a team")
	errNotInGroup    = apperr.New(403, "not_allowed_to_request", "Your account is not allowed to request a team: ask a platform admin")
	errTooManyOpen   = apperr.Conflict("too_many_open_requests", "You already have the most open team requests allowed: wait for one to be decided, or withdraw one")
	errAlreadyClosed = apperr.Conflict("request_already_decided", "This request was already decided or withdrawn")
)

// ---- settings -----------------------------------------------------------------------

// Settings are the platform's team request settings.
type Settings struct {
	Enabled bool
	// MaxOpen is how many pending requests one person may have.
	MaxOpen int
	// AllowedGroup is the SSO group a person must be in to ask ("": anyone signed in).
	AllowedGroup string
	Revision     int64
	UpdatedAt    time.Time
}

func settingsOf(row dbgen.TeamRequestSetting) Settings {
	return Settings{Enabled: row.Enabled, MaxOpen: int(row.MaxOpen), AllowedGroup: row.AllowedGroup, Revision: row.Revision, UpdatedAt: row.UpdatedAt}
}

// Enabled reports the platform switch.
func (s *Service) Enabled(ctx context.Context) (bool, error) {
	row, err := s.q.GetTeamRequestSettings(ctx)
	return row.Enabled, err
}

// Settings returns the settings (platform admins and auditors).
func (s *Service) Settings(ctx context.Context, a authz.Actor) (Settings, error) {
	if a.Delegated() || !a.CanReadPlatform() {
		return Settings{}, apperr.Forbidden("Only platform admins and auditors can see this setting")
	}
	row, err := s.q.GetTeamRequestSettings(ctx)
	return settingsOf(row), err
}

// SettingsInput changes the settings.
type SettingsInput struct {
	Enabled      bool
	MaxOpen      int
	AllowedGroup string
}

// SetSettings changes the switch and the limits (platform admins; audited).
func (s *Service) SetSettings(ctx context.Context, a authz.Actor, in SettingsInput, expectedRevision int64) (Settings, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return Settings{}, apperr.Forbidden("Only platform admins can change team requests")
	}
	if in.MaxOpen < 1 || in.MaxOpen > 20 {
		return Settings{}, apperr.Invalid("invalid_max_open", "Open requests per person must be between 1 and 20")
	}
	group := ""
	if g := ssogroups.NormalizeGroups([]string{in.AllowedGroup}); len(g) == 1 {
		group = g[0]
	} else if strings.TrimSpace(in.AllowedGroup) != "" {
		return Settings{}, apperr.Invalid("invalid_group", "Enter one SSO group name, or leave it empty to let anyone signed in ask")
	}
	var out Settings
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockTeamRequestSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.Enabled == in.Enabled && int(cur.MaxOpen) == in.MaxOpen && cur.AllowedGroup == group {
			out = settingsOf(cur)
			return nil
		}
		row, err := q.SetTeamRequestSettings(ctx, dbgen.SetTeamRequestSettingsParams{
			Enabled: in.Enabled, MaxOpen: int32(in.MaxOpen), AllowedGroup: group, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		})
		if err != nil {
			return err
		}
		out = settingsOf(row)
		e := a.Audit("platform.team_requests", "team_request_settings", "settings")
		e.Before = map[string]any{"enabled": cur.Enabled, "maxOpen": cur.MaxOpen, "allowedGroup": cur.AllowedGroup}
		e.After = map[string]any{"enabled": row.Enabled, "maxOpen": row.MaxOpen, "allowedGroup": row.AllowedGroup}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// ---- a person's own requests ---------------------------------------------------------

// Request is a team request as the person who made it sees it.
type Request struct {
	ID             uuid.UUID
	Name           string
	Purpose        string
	OwnerEmail     string
	Classification string
	Status         string
	DecisionReason string
	DecidedAt      *time.Time
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

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
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
		out.Items[i] = Request{ID: r.ID, Name: r.Name, Purpose: r.Purpose, OwnerEmail: r.OwnerEmail, Classification: r.Classification, Status: r.Status,
			DecisionReason: r.DecisionReason, DecidedAt: r.DecidedAt, TeamSlug: deref(r.TeamSlug), TeamName: deref(r.TeamName), Revision: r.Revision, CreatedAt: r.CreatedAt}
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

// ---- review -----------------------------------------------------------------------

// AdminRequest is a request as reviewers see it.
type AdminRequest struct {
	Request
	RequesterID    uuid.UUID
	RequesterEmail string
	RequesterName  string
	DeciderEmail   string
}

func adminOf(r dbgen.GetTeamRequestRow) AdminRequest {
	return AdminRequest{
		Request: Request{ID: r.ID, Name: r.Name, Purpose: r.Purpose, OwnerEmail: r.OwnerEmail, Classification: r.Classification, Status: r.Status,
			DecisionReason: r.DecisionReason, DecidedAt: r.DecidedAt, TeamSlug: deref(r.TeamSlug), TeamName: deref(r.TeamName), Revision: r.Revision, CreatedAt: r.CreatedAt},
		RequesterID: r.RequesterID, RequesterEmail: r.RequesterEmail, RequesterName: r.RequesterName, DeciderEmail: r.DeciderEmail,
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
// classification, and a template to start the team's first agent from. Empty values keep what the person asked for.
type ApproveInput struct {
	Slug              string
	Name              string
	MaxClassification string
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
		owner, otherOwner := cur.OwnerEmail, ""
		if owner == "" {
			if owner, err = q.GetTeamRequestRequesterEmail(ctx, cur.RequesterID); err != nil {
				return err
			}
		} else if asker, err := q.GetTeamRequestRequesterEmail(ctx, cur.RequesterID); err != nil {
			return err
		} else if !strings.EqualFold(asker, owner) {
			otherOwner = owner // the asker named someone else: they are told, and are not on the team
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
		}); err != nil {
			return err
		}
		// In the new team's audit log too, so the team can see how it came to be.
		e := a.Audit("team_request.approve", "team_request", id.String())
		e.TeamID = team.Team.ID
		e.After = map[string]any{"name": name, "slug": team.Team.Slug, "classification": class, "starterTemplateId": in.StarterTemplateID}
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
