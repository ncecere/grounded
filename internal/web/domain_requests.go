package web

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

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
	if s.Fetcher.BlocksPattern(p) {
		return DomainRequest{}, errBlockedAddress
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
			TeamID: acc.Team.ID, Pattern: p, Reason: reason, RequestedBy: a.NullUser(),
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
		out, err = q.ReviewDomainRequest(ctx, dbgen.ReviewDomainRequestParams{ID: id, Status: next, ReviewedBy: a.NullUser(), ReviewNote: note})
		if err != nil {
			return err
		}
		e := a.Audit("crawl.domain_review", "crawl_domain_request", id.String())
		e.TeamID, e.Before, e.After = cur.TeamID, requestSnapshot(cur), requestSnapshot(out)
		e.Metadata = audit.MergeMeta(e.Metadata, map[string]any{"decision": decision})
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
// auditors), for the admin badge and Needs attention. A request the
// platform allowlist already covers isn't waiting for anyone: approving it
// changes nothing (AD2-19), so it isn't counted.
func (s *Service) PendingRequests(ctx context.Context, a authz.Actor) (int64, error) {
	if err := requirePlatformRead(a); err != nil {
		return 0, err
	}
	pending := "pending"
	reqs, err := s.q.ListDomainRequests(ctx, &pending)
	if err != nil {
		return 0, err
	}
	allow, err := s.q.ListAllowlist(ctx)
	if err != nil {
		return 0, err
	}
	var n int64
	for _, r := range reqs {
		if !coveredBy(allow, r.Pattern) {
			n++
		}
	}
	return n, nil
}

// coveredBy reports whether an allowlist pattern covers every host pattern allows.
func coveredBy(allow []dbgen.CrawlAllowlist, pattern string) bool {
	for _, e := range allow {
		if Covers(e.Pattern, pattern) {
			return true
		}
	}
	return false
}

// notifyDecision tells the person who asked for a domain that it was
// decided (docs/phase4-publishing.md §8).
func (s *Service) notifyDecision(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, r dbgen.CrawlDomainRequest, decision string) error {
	// The admins' "New domain request" items are dealt with now.
	if err := q.MarkNotificationsReadFor(ctx, dbgen.MarkNotificationsReadForParams{
		Type: string(notify.DomainRequestNew), DataKey: "requestId", DataValue: r.ID.String(),
	}); err != nil {
		return err
	}
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
