package webhooks

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
	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ---- the switch ---------------------------------------------------------------------

// Settings are the platform's webhook settings.
type Settings struct {
	Enabled   bool
	Revision  int64
	UpdatedAt time.Time
}

func settingsOf(r dbgen.WebhookSetting) Settings {
	return Settings{Enabled: r.Enabled, Revision: r.Revision, UpdatedAt: r.UpdatedAt}
}

// Enabled reports whether webhooks are turned on.
func (s *Service) Enabled(ctx context.Context) (bool, error) {
	r, err := s.q.GetWebhookSettings(ctx)
	return r.Enabled, err
}

// Settings returns the settings (platform admins and auditors).
func (s *Service) Settings(ctx context.Context, a authz.Actor) (Settings, error) {
	if a.Delegated() || !a.CanReadPlatform() {
		return Settings{}, apperr.Forbidden("Only platform admins and auditors can see this setting")
	}
	r, err := s.q.GetWebhookSettings(ctx)
	return settingsOf(r), err
}

// SetEnabled turns webhooks on or off (platform admins; audited).
func (s *Service) SetEnabled(ctx context.Context, a authz.Actor, enabled bool, expectedRevision int64) (Settings, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return Settings{}, apperr.Forbidden("Only platform admins can change webhooks")
	}
	var out Settings
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockWebhookSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.Enabled == enabled {
			out = settingsOf(cur)
			return nil
		}
		row, err := q.SetWebhookSettings(ctx, dbgen.SetWebhookSettingsParams{Enabled: enabled, UpdatedBy: nullTeam(a.UserID)})
		if err != nil {
			return err
		}
		out = settingsOf(row)
		e := a.Audit("platform.webhooks", "webhook_settings", "settings")
		e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": row.Enabled}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// ---- approved destinations ----------------------------------------------------------

// Destination is a host pattern webhooks may be sent to.
type Destination struct {
	ID        uuid.UUID
	Pattern   string
	Note      string
	CreatedAt time.Time
}

func destinationOf(r dbgen.WebhookDestination) Destination {
	return Destination{ID: r.ID, Pattern: r.Pattern, Note: r.Note, CreatedAt: r.CreatedAt}
}

// Destinations lists the approved patterns: anyone signed in (a team admin needs them to choose an address), never a key. The note ("who asked
// for it, or why") is free text for platform staff and is left out for everyone else.
func (s *Service) Destinations(ctx context.Context, a authz.Actor) ([]Destination, error) {
	if a.Delegated() {
		return nil, apperr.Forbidden("Destinations are for people signing in")
	}
	rows, err := s.q.ListWebhookDestinations(ctx)
	out := make([]Destination, len(rows))
	for i, r := range rows {
		out[i] = destinationOf(r)
		if !a.CanReadPlatform() {
			out[i].Note = ""
		}
	}
	return out, err
}

var (
	errPattern = apperr.Invalid("invalid_pattern", `Enter a host such as "hooks.example.edu" or a wildcard such as "*.example.edu"`)
	errBlocked = apperr.Invalid("blocked_address", "Webhooks are never sent to private, loopback, link-local or cloud metadata addresses, so this entry would do nothing")
	errTaken   = apperr.Conflict("destination_exists", "That destination is already approved")
)

// AddDestination approves a host pattern (platform admins; audited).
func (s *Service) AddDestination(ctx context.Context, a authz.Actor, pattern, note string) (Destination, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return Destination{}, apperr.Forbidden("Only platform admins approve destinations")
	}
	norm, err := crawl.NormalizeHostPattern(strings.TrimSpace(pattern), false)
	if err != nil || isIPLiteral(strings.TrimPrefix(norm, "*.")) {
		return Destination{}, errPattern
	}
	if (&crawl.Fetcher{}).BlocksPattern(norm) {
		return Destination{}, errBlocked
	}
	note = strings.TrimSpace(note)
	if len([]rune(note)) > 200 || strings.ContainsAny(note, "\r\n") {
		return Destination{}, apperr.Invalid("invalid_note", "The note must be one line of at most 200 characters")
	}
	var out Destination
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		row, err := q.InsertWebhookDestination(ctx, dbgen.InsertWebhookDestinationParams{Pattern: norm, Note: note, CreatedBy: nullTeam(a.UserID)})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errTaken
		} else if err != nil {
			return err
		}
		out = destinationOf(row)
		e := a.Audit("webhook_destination.create", "webhook_destination", row.ID.String())
		e.After = map[string]any{"pattern": row.Pattern, "note": row.Note}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// RemoveDestination withdraws an approval: webhooks to that host stop at once (platform admins; audited).
func (s *Service) RemoveDestination(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return apperr.Forbidden("Only platform admins approve destinations")
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		row, err := q.DeleteWebhookDestination(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.NotFound("destination_not_found", "Destination not found")
		} else if err != nil {
			return err
		}
		e := a.Audit("webhook_destination.delete", "webhook_destination", row.ID.String())
		e.Before = map[string]any{"pattern": row.Pattern, "note": row.Note}
		return audit.Record(ctx, q, e)
	})
}

// hostApproved reports whether an approved pattern covers host (lower-case IDNA ASCII).
func hostApproved(ctx context.Context, q *dbgen.Queries, host string) (bool, error) {
	rows, err := q.ListWebhookDestinations(ctx)
	if err != nil {
		return false, err
	}
	for _, r := range rows {
		if matchPattern(r.Pattern, host) {
			return true, nil
		}
	}
	return false, nil
}

// matchPattern: "*.example.edu" matches example.edu and every subdomain; "example.edu" that host only.
func matchPattern(pattern, host string) bool {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	switch {
	case host == "":
		return false
	case strings.HasPrefix(pattern, "*."):
		base := pattern[2:]
		return host == base || strings.HasSuffix(host, "."+base)
	default:
		return host == pattern
	}
}
