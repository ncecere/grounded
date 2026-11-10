// Package web runs `web` data sources (ADR-0008, DESIGN.md §5.3): source
// configuration, the crawl allowlist and team domain requests, crawl runs
// with a durable frontier (River jobs web.crawl and web.schedule), and the
// synchronous map preview. Fetching, SSRF protection, robots.txt, pacing and
// scope rules live in internal/crawl.
package web

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/webhooks"
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
	// Webhooks hears of finished and failed syncs (nil: nobody).
	Webhooks *webhooks.Service
	// Maintenance pauses crawling while maintenance mode is on (nil: never;
	// maintenance.go).
	Maintenance *platform.MaintenanceGate
	// Budget parks runs of teams whose monthly budget is used up (nil:
	// none; docs/costs.md §4).
	Budget BudgetGate
	Log    *slog.Logger
	q      *dbgen.Queries
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
	// An address the crawler never fetches (private, loopback, link-local, cloud metadata) is refused as that: a domain request for it could
	// never be approved, so the message must not invite one.
	if s.Fetcher.BlocksPattern(host) {
		return apperr.Invalid("blocked_address", host+" can't be crawled: the crawler never fetches private, loopback, link-local or cloud metadata addresses, and a domain request can't change that.")
	}
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
