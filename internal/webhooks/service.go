package webhooks

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Service is the webhooks feature: the switch and the approved destinations (settings.go), the webhooks and their deliveries (this file), the
// events that reach them (emit.go) and the job that sends them (deliver.go).
type Service struct {
	Pool   *pgxpool.Pool
	Jobs   *river.Client[pgx.Tx]
	Box    *secrets.Box
	Client *Client
	Log    *slog.Logger
	// Team resolves a team the actor may see, with the actor's role in it ("" when not a member): teams.Service.Get.
	Team func(ctx context.Context, a authz.Actor, ref string) (dbgen.Team, string, error)
	// OnPaused tells the people who manage a webhook that it stopped sending (the app wires notifications; nil: nobody).
	OnPaused func(ctx context.Context, tx pgx.Tx, w Webhook, reason string) error
	Now      func() time.Time

	q *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, jobs *river.Client[pgx.Tx], box *secrets.Box, client *Client, log *slog.Logger) *Service {
	return &Service{Pool: pool, Jobs: jobs, Box: box, Client: client, Log: log, Now: time.Now, q: dbgen.New(pool)}
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// SecretAAD is the associated data a webhook's secret is sealed with (and re-sealed with when keys rotate).
func SecretAAD(id uuid.UUID) []byte { return []byte("webhook:" + id.String()) }

var (
	errWebhookNotFound = apperr.NotFound("webhook_not_found", "Webhook not found")
	errOff             = apperr.Conflict("webhooks_off", "Webhooks are turned off. A platform admin can turn them on under Admin → Settings → Features")
	errTooMany         = apperr.Conflict("too_many_webhooks", "There are as many webhooks here as allowed: delete one first")
)

// Webhook is a webhook as the people who manage it see it: never its secret.
type Webhook struct {
	ID                  uuid.UUID
	TeamID              uuid.UUID // uuid.Nil: a platform webhook
	URL                 string
	Description         string
	Events              []string
	SecretHint          string
	Enabled             bool
	PausedReason        string
	ConsecutiveFailures int
	Revision            int64
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func webhookOf(r dbgen.Webhook) Webhook {
	return Webhook{ID: r.ID, TeamID: r.TeamID.UUID, URL: r.URL, Description: r.Description, Events: r.Events, SecretHint: r.SecretHint, Enabled: r.Enabled,
		PausedReason: r.PausedReason, ConsecutiveFailures: int(r.ConsecutiveFailures), Revision: r.Revision, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

func nullTeam(id uuid.UUID) uuid.NullUUID { return uuid.NullUUID{UUID: id, Valid: id != uuid.Nil} }

// scope is whose webhooks a call is about.
type scope struct {
	team dbgen.Team // zero for the platform
}

func (sc scope) platform() bool { return sc.team.ID == uuid.Nil }

func (sc scope) id() uuid.UUID { return sc.team.ID }

func (sc scope) kind() Scope {
	if sc.platform() {
		return ScopePlatform
	}
	return ScopeTeam
}

// manage resolves whose webhooks teamRef names ("" is the platform's) and whether the actor may see (write false) or change (write true)
// them: a team's admins and owners, or platform admins for the platform's (auditors read). A platform admin who is not on the team gets the
// same 404 as for any team content (ADR-0011). Keys and OAuth grants never manage webhooks.
func (s *Service) manage(ctx context.Context, a authz.Actor, teamRef string, write bool) (scope, error) {
	if a.Delegated() {
		return scope{}, apperr.Forbidden("Webhooks are managed by people signing in")
	}
	if teamRef == "" {
		if (write && !a.IsPlatformAdmin()) || (!write && !a.CanReadPlatform()) {
			return scope{}, apperr.Forbidden("Only platform admins manage platform webhooks")
		}
		return scope{}, nil
	}
	team, role, err := s.Team(ctx, a, teamRef)
	if err != nil {
		return scope{}, err
	}
	if role == "" {
		return scope{}, apperr.NotFound("team_not_found", "Team not found")
	}
	if !authz.RoleAtLeast(role, authz.RoleAdmin) {
		return scope{}, apperr.Forbidden("Only team admins and owners manage webhooks")
	}
	return scope{team: team}, nil
}

// load finds a webhook of the scope (404 when it is another scope's).
func (s *Service) load(ctx context.Context, q *dbgen.Queries, sc scope, id uuid.UUID, lock bool) (dbgen.Webhook, error) {
	get := q.GetWebhook
	if lock {
		get = q.LockWebhook
	}
	w, err := get(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && w.TeamID.UUID != sc.id()) {
		return w, errWebhookNotFound
	}
	return w, err
}

// ---- input --------------------------------------------------------------------------

// Input is what a person sets on a webhook.
type Input struct {
	URL         string
	Description string
	Events      []string
	Enabled     bool
}

// normalize checks an input for scope sc and returns it cleaned: the address is https on the default port, a host name an approved
// destination covers; the events are known, of this scope and at least one.
func (s *Service) normalize(ctx context.Context, q *dbgen.Queries, sc scope, in Input) (Input, error) {
	var err error
	if in.URL, err = s.checkURL(ctx, q, in.URL); err != nil {
		return in, err
	}
	in.Description = strings.TrimSpace(in.Description)
	if len([]rune(in.Description)) > maxDescriptionLength || strings.ContainsAny(in.Description, "\r\n") {
		return in, apperr.Invalid("invalid_description", "The description must be one line of at most 200 characters")
	}
	if len(in.Events) == 0 {
		return in, apperr.Invalid("no_events", "Choose at least one event")
	}
	seen := map[string]bool{}
	var events []string
	for _, e := range in.Events {
		t, ok := Lookup(e)
		if !ok || t.Test || t.Scope != sc.kind() {
			return in, apperr.Invalid("invalid_event", "“"+e+"” is not an event of this kind of webhook")
		}
		if !seen[e] {
			seen[e] = true
			events = append(events, e)
		}
	}
	slices.Sort(events)
	in.Events = events
	return in, nil
}

var errURL = apperr.Invalid("invalid_url", "Enter an https address with a host name, such as https://hooks.example.edu/grounded")

// checkURL validates a destination address and returns it normalised.
func (s *Service) checkURL(ctx context.Context, q *dbgen.Queries, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxURLLength {
		return "", errURL
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return "", errURL
	}
	if p := u.Port(); p != "" && p != "443" {
		return "", apperr.Invalid("invalid_port", "Webhooks are sent to port 443 only")
	}
	host := strings.ToLower(u.Hostname())
	if isIPLiteral(host) {
		return "", apperr.Invalid("invalid_host", "Use a host name, not an IP address")
	}
	norm, err := crawl.NormalizeHostPattern(host, false)
	if err != nil || strings.HasPrefix(norm, "*") {
		return "", errURL
	}
	if (&crawl.Fetcher{}).BlocksPattern(norm) {
		return "", apperr.Invalid("invalid_host", "Use a host name, not an IP address")
	}
	ok, err := hostApproved(ctx, q, norm)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", apperr.Invalid("destination_not_approved", "That host is not an approved destination. A platform admin approves destinations under Admin → Webhooks")
	}
	u.Host = norm
	return u.String(), nil
}

// ---- secrets ------------------------------------------------------------------------

// newSecret is a new signing secret: "whsec_" and 32 random bytes.
func newSecret() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "whsec_" + base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func (s *Service) seal(id uuid.UUID, secret string) ([]byte, string, error) {
	c, err := s.Box.Seal([]byte(secret), SecretAAD(id))
	return c, secret[len(secret)-4:], err
}

// isIPLiteral reports whether host is an IP address (a webhook names a host, so an address is refused).
func isIPLiteral(host string) bool {
	_, err := netip.ParseAddr(host)
	return err == nil
}
