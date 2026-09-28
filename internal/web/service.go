// Package web runs `web` data sources (ADR-0008, DESIGN.md §5.3): source
// configuration, the crawl allowlist and team domain requests, crawl runs
// with a durable frontier (River jobs web.crawl and web.schedule), and the
// synchronous map preview. Fetching, SSRF protection, robots.txt, pacing and
// scope rules live in internal/crawl.
package web

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Service holds the dependencies for web sources.
type Service struct {
	Pool     *pgxpool.Pool
	Teams    *teams.Service
	Jobs     *river.Client[pgx.Tx] // may be insert-only
	Blob     blob.Store
	Fetcher  *crawl.Fetcher
	Allow    *Allowlist
	MaxPages int // CRAWL_MAX_PAGES
	MaxBody  int64
	// Limits enforces team limits on crawls (nil: none).
	Limits *limits.Service
	// Notify tells people about decided domain requests and failed syncs
	// (nil: nobody).
	Notify *notify.Service
	// Maintenance pauses crawling while maintenance mode is on (nil: never;
	// maintenance.go).
	Maintenance *platform.MaintenanceGate
	Log         *slog.Logger
	q           *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, jobs *river.Client[pgx.Tx], b blob.Store, f *crawl.Fetcher, maxPages int, maxBody int64, log *slog.Logger) *Service {
	q := dbgen.New(pool)
	return &Service{Pool: pool, Teams: t, Jobs: jobs, Blob: b, Fetcher: f, Allow: NewAllowlist(q), MaxPages: maxPages, MaxBody: maxBody, Log: log, q: q}
}

func requireAdmin(a authz.Actor) error {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return apperr.Forbidden("Only platform admins can do this")
	}
	return nil
}

func requirePlatformRead(a authz.Actor) error {
	if a.Key != nil || !a.CanReadPlatform() {
		return apperr.Forbidden("Platform administration requires the platform admin or auditor role")
	}
	return nil
}

// teamAccess resolves a team the actor belongs to with at least minRole.
func (s *Service) teamAccess(ctx context.Context, a authz.Actor, teamRef, minRole string, write bool) (teams.Access, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return acc, err
	}
	if acc.Role == "" {
		return acc, apperr.NotFound("team_not_found", "Team not found")
	}
	if !authz.RoleAtLeast(acc.Role, minRole) {
		return acc, apperr.Forbidden("Only team editors, admins and owners can do this")
	}
	if write && acc.Team.Status != teams.StatusActive {
		return acc, apperr.Conflict("team_archived", "This team is archived and read-only")
	}
	return acc, nil
}

// hostNotAllowed is the error for a host outside the allowlist.
func hostNotAllowed(host string) error {
	return apperr.Invalid("host_not_allowed",
		host+" is not on the crawl allowlist. A team editor can request it under Domain requests; a platform admin reviews the request.")
}

// hostNotAllowedFor is hostNotAllowed with details: the host and, when the
// team already has a pending request covering it, that request, so the UI
// shows it instead of offering a duplicate (docs/ui-review P-15).
func (s *Service) hostNotAllowedFor(ctx context.Context, team uuid.NullUUID, host string) error {
	details := map[string]any{"host": host}
	e := &apperr.Error{Status: 400, Code: "host_not_allowed",
		Message: host + " is not on the crawl allowlist. A team editor can request it under Domain requests; a platform admin reviews the request.",
		Details: details}
	if !team.Valid {
		return e
	}
	rows, err := s.q.ListTeamDomainRequests(ctx, team.UUID)
	if err != nil {
		return e
	}
	for _, r := range rows {
		if r.Status == "pending" && Covers(r.Pattern, host) {
			details["pendingRequest"] = map[string]any{"id": r.ID, "pattern": r.Pattern, "createdAt": r.CreatedAt, "requesterName": r.RequesterName}
			e.Message = host + " is not on the crawl allowlist yet. Your team's request for " + r.Pattern + " is waiting for a platform admin."
			break
		}
	}
	return e
}

// ValidateConfig parses a web configuration and checks every host against
// the allowlist for team (invalid team = platform-shared source). It returns
// the normalised configuration.
func (s *Service) ValidateConfig(ctx context.Context, team uuid.NullUUID, raw json.RawMessage) (Config, error) {
	c, err := ParseConfig(raw, s.MaxPages)
	if err != nil {
		return c, err
	}
	for _, h := range c.Hosts() {
		ok, err := s.Allow.Allowed(ctx, team, h)
		if err != nil {
			return c, err
		}
		if !ok {
			return c, s.hostNotAllowedFor(ctx, team, h)
		}
	}
	return c, nil
}

// ---- allowlist ------------------------------------------------------------------

func allowSnapshot(e dbgen.CrawlAllowlist) map[string]any {
	return map[string]any{"pattern": e.Pattern, "note": e.Note}
}

// ListAllowlist returns the platform allowlist (platform admins and auditors).
func (s *Service) ListAllowlist(ctx context.Context, a authz.Actor) ([]dbgen.CrawlAllowlist, error) {
	if err := requirePlatformRead(a); err != nil {
		return nil, err
	}
	return s.q.ListAllowlist(ctx)
}

// AddAllowlist adds a host pattern ("*" allows every public host).
func (s *Service) AddAllowlist(ctx context.Context, a authz.Actor, pattern, note string) (dbgen.CrawlAllowlist, error) {
	if err := requireAdmin(a); err != nil {
		return dbgen.CrawlAllowlist{}, err
	}
	p, err := NormalizePattern(pattern, true)
	if err != nil {
		return dbgen.CrawlAllowlist{}, err
	}
	note = strings.TrimSpace(note)
	if len(note) > 500 {
		return dbgen.CrawlAllowlist{}, apperr.Invalid("invalid_note", "The note must be at most 500 characters")
	}
	var out dbgen.CrawlAllowlist
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		out, err = q.InsertAllowlist(ctx, dbgen.InsertAllowlistParams{Pattern: p, Note: note, CreatedBy: nullUser(a)})
		if apperr.IsUniqueViolation(err, "") {
			return apperr.Conflict("pattern_exists", "That pattern is already on the allowlist")
		} else if err != nil {
			return err
		}
		e := a.Audit("crawl.allowlist_add", "crawl_allowlist", out.ID.String())
		e.After = allowSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.Allow.Invalidate(uuid.NullUUID{})
	}
	return out, err
}

// RemoveAllowlist deletes a pattern. Running crawls stop fetching its hosts
// within AllowlistTTL.
func (s *Service) RemoveAllowlist(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if err := requireAdmin(a); err != nil {
		return err
	}
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		old, err := q.DeleteAllowlist(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.NotFound("pattern_not_found", "Allowlist entry not found")
		} else if err != nil {
			return err
		}
		e := a.Audit("crawl.allowlist_remove", "crawl_allowlist", id.String())
		e.Before = allowSnapshot(old)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.Allow.Invalidate(uuid.NullUUID{})
	}
	return err
}

// ---- domain requests ------------------------------------------------------------

// DomainRequest is a team's request to crawl hosts outside the allowlist,
// with the names of the people who requested and reviewed it ("" when
// unknown or deleted).
type DomainRequest struct {
	dbgen.CrawlDomainRequest
	TeamSlug, TeamName            string
	RequesterName, RequesterEmail string
	ReviewerName, ReviewerEmail   string
}

func requestView(r dbgen.GetDomainRequestViewRow) DomainRequest {
	return DomainRequest{
		CrawlDomainRequest: dbgen.CrawlDomainRequest{
			ID: r.ID, TeamID: r.TeamID, Pattern: r.Pattern, Reason: r.Reason, Status: r.Status,
			RequestedBy: r.RequestedBy, ReviewedBy: r.ReviewedBy, ReviewNote: r.ReviewNote,
			ReviewedAt: r.ReviewedAt, CreatedAt: r.CreatedAt,
		},
		TeamSlug: r.TeamSlug, TeamName: r.TeamName,
		RequesterName: r.RequesterName, RequesterEmail: r.RequesterEmail,
		ReviewerName: r.ReviewerName, ReviewerEmail: r.ReviewerEmail,
	}
}

func (s *Service) requestByID(ctx context.Context, id uuid.UUID) (DomainRequest, error) {
	r, err := s.q.GetDomainRequestView(ctx, id)
	if err != nil {
		return DomainRequest{}, err
	}
	return requestView(r), nil
}

// Review decisions.
const (
	DecisionApprove = "approve"
	DecisionDeny    = "deny"
	DecisionRevoke  = "revoke"
)

func requestSnapshot(r dbgen.CrawlDomainRequest) map[string]any {
	return map[string]any{"pattern": r.Pattern, "status": r.Status, "reason": r.Reason, "reviewNote": r.ReviewNote}
}

// ListTeamRequests returns a team's domain requests, newest first (members).
func (s *Service) ListTeamRequests(ctx context.Context, a authz.Actor, teamRef string) ([]DomainRequest, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleMember, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTeamDomainRequests(ctx, acc.Team.ID)
	if err != nil {
		return nil, err
	}
	out := make([]DomainRequest, len(rows))
	for i, r := range rows {
		out[i] = requestView(dbgen.GetDomainRequestViewRow(r))
	}
	return out, nil
}

// CreateRequest asks platform admins to allow a host pattern for a team
// (editors and above).
func (s *Service) CreateRequest(ctx context.Context, a authz.Actor, teamRef, pattern, reason string) (DomainRequest, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor, true)
	if err != nil {
		return DomainRequest{}, err
	}
	p, err := NormalizePattern(pattern, false)
	if err != nil {
		return DomainRequest{}, err
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 10 || len(reason) > 2000 {
		return DomainRequest{}, apperr.Invalid("reason_required", "Explain what the team needs to crawl and why (10-2000 characters)")
	}
	current, err := s.Allow.Patterns(ctx, uuid.NullUUID{UUID: acc.Team.ID, Valid: true})
	if err != nil {
		return DomainRequest{}, err
	}
	for _, c := range current {
		if Covers(c, p) {
			return DomainRequest{}, apperr.Conflict("already_allowed", "This team can already crawl "+p+" (allowed by "+c+")")
		}
	}
	var out dbgen.CrawlDomainRequest
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		out, err = q.InsertDomainRequest(ctx, dbgen.InsertDomainRequestParams{
			TeamID: acc.Team.ID, Pattern: p, Reason: reason, RequestedBy: nullUser(a),
		})
		if apperr.IsUniqueViolation(err, "crawl_domain_requests_open_key") {
			return apperr.Conflict("request_exists", "This team already has an open or approved request for "+p)
		} else if err != nil {
			return err
		}
		e := a.Audit("crawl.domain_request", "crawl_domain_request", out.ID.String())
		e.TeamID, e.After = acc.Team.ID, requestSnapshot(out)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return s.notifyNewRequest(ctx, q, tx, a, acc.Team, out)
	})
	if err != nil {
		return DomainRequest{}, err
	}
	return s.requestByID(ctx, out.ID)
}

// ListRequests returns domain requests across teams, pending first
// (platform admins and auditors). status "" lists every status.
func (s *Service) ListRequests(ctx context.Context, a authz.Actor, status string) ([]DomainRequest, error) {
	if err := requirePlatformRead(a); err != nil {
		return nil, err
	}
	var st *string
	if status != "" {
		switch status {
		case "pending", "approved", "denied", "revoked":
		default:
			return nil, apperr.Invalid("invalid_status", "status must be pending, approved, denied or revoked")
		}
		st = &status
	}
	rows, err := s.q.ListDomainRequests(ctx, st)
	if err != nil {
		return nil, err
	}
	out := make([]DomainRequest, len(rows))
	for i, r := range rows {
		out[i] = requestView(dbgen.GetDomainRequestViewRow(r))
	}
	return out, nil
}

// Review approves or denies a pending request, or revokes an approved one
// (platform admins). Revoking takes effect on the next fetch.
func (s *Service) Review(ctx context.Context, a authz.Actor, id uuid.UUID, decision, note string) (DomainRequest, error) {
	if err := requireAdmin(a); err != nil {
		return DomainRequest{}, err
	}
	note = strings.TrimSpace(note)
	if len(note) > 1000 {
		return DomainRequest{}, apperr.Invalid("invalid_note", "The note must be at most 1000 characters")
	}
	var out dbgen.CrawlDomainRequest
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := q.LockDomainRequest(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.NotFound("request_not_found", "Domain request not found")
		} else if err != nil {
			return err
		}
		var next string
		switch {
		case decision == DecisionApprove && cur.Status == "pending":
			next = "approved"
		case decision == DecisionDeny && cur.Status == "pending":
			next = "denied"
		case decision == DecisionRevoke && cur.Status == "approved":
			next = "revoked"
		case decision != DecisionApprove && decision != DecisionDeny && decision != DecisionRevoke:
			return apperr.Invalid("invalid_decision", "decision must be approve, deny or revoke")
		default:
			return apperr.Conflict("invalid_transition", "A "+cur.Status+" request cannot be given the decision "+decision)
		}
		out, err = q.ReviewDomainRequest(ctx, dbgen.ReviewDomainRequestParams{ID: id, Status: next, ReviewedBy: nullUser(a), ReviewNote: note})
		if err != nil {
			return err
		}
		e := a.Audit("crawl.domain_review", "crawl_domain_request", id.String())
		e.TeamID, e.Before, e.After = cur.TeamID, requestSnapshot(cur), requestSnapshot(out)
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"decision": decision})
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return s.notifyDecision(ctx, q, tx, a, out, decision)
	})
	if err != nil {
		return DomainRequest{}, err
	}
	s.Allow.Invalidate(uuid.NullUUID{UUID: out.TeamID, Valid: true})
	return s.requestByID(ctx, id)
}

func nullUser(a authz.Actor) uuid.NullUUID {
	return uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
}

func mergeMeta(a, b map[string]any) map[string]any {
	if a == nil {
		return b
	}
	for k, v := range b {
		a[k] = v
	}
	return a
}

// notifyNewRequest tells the platform admins about a new request, in the
// app and by email per their settings (docs/ui-review P-16).
func (s *Service) notifyNewRequest(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, t dbgen.Team, r dbgen.CrawlDomainRequest) error {
	if s.Notify == nil {
		return nil
	}
	admins, err := q.ActivePlatformAdminIDs(ctx)
	if err != nil || len(admins) == 0 {
		return err
	}
	requester := ""
	if u, err := q.GetUser(ctx, a.UserID); err == nil {
		requester = u.DisplayName
		if requester == "" {
			requester = u.Email
		}
	}
	ev := notify.DomainRequestNewEvent(notify.TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, admins, r.ID, r.Pattern, requester, r.Reason)
	return s.Notify.Emit(ctx, tx, ev.By(a.UserID))
}

// PendingRequests counts pending domain requests (platform admins and
// auditors), for the admin badge.
func (s *Service) PendingRequests(ctx context.Context, a authz.Actor) (int64, error) {
	if err := requirePlatformRead(a); err != nil {
		return 0, err
	}
	return s.q.CountPendingDomainRequests(ctx)
}

// notifyDecision tells the person who asked for a domain that it was
// decided (docs/phase4-publishing.md §8).
func (s *Service) notifyDecision(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, r dbgen.CrawlDomainRequest, decision string) error {
	if s.Notify == nil || !r.RequestedBy.Valid {
		return nil
	}
	t, err := q.GetTeamByID(ctx, r.TeamID)
	if err != nil {
		return err
	}
	ev := notify.DomainRequestDecidedEvent(notify.TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, r.RequestedBy.UUID, r.ID, r.Pattern, decision, r.ReviewNote)
	return s.Notify.Emit(ctx, tx, ev.By(a.UserID))
}
