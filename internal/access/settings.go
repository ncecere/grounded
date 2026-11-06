package access

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The Document permissions switch (Admin → Settings → Features): off by default, because a pod of the previous release
// ignores restrictions; a platform admin turns it on once every pod runs this release. While it is off no restriction can
// be set, and it cannot be turned off while any document is restricted, so an install never falls back to showing
// restricted text.

// Settings is the switch with the number of restricted documents.
type Settings struct {
	dbgen.DocumentAccessSetting
	RestrictedDocuments int64
}

// Service reads and changes the switch.
type Service struct{ Pool *pgxpool.Pool }

var errStillRestricted = apperr.Conflict("documents_restricted",
	"Documents are still restricted. Remove every restriction (each source's Access) before turning document permissions off.")

// ErrOff refuses a new restriction while the switch is off.
var ErrOff = apperr.Conflict("document_permissions_off",
	"Document permissions are off. A platform admin turns them on in Admin → Settings → Features, once every server runs this release.")

// Get returns the switch (platform admins and auditors).
func (s *Service) Get(ctx context.Context, a authz.Actor) (Settings, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return Settings{}, apperr.Forbidden("Only platform admins and auditors can see document permissions")
	}
	q := dbgen.New(s.Pool)
	st, err := q.GetDocumentAccessSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	n, err := q.CountRestrictedDocuments(ctx)
	return Settings{DocumentAccessSetting: st, RestrictedDocuments: n}, err
}

// Enabled reports whether restrictions may be set.
func (s *Service) Enabled(ctx context.Context, q *dbgen.Queries) (bool, error) {
	st, err := q.GetDocumentAccessSettings(ctx)
	return st.Enabled, err
}

// SetEnabled turns the switch on or off (platform admins; If-Match; audited as platform.document_permissions).
func (s *Service) SetEnabled(ctx context.Context, a authz.Actor, enabled bool, revision int64) (Settings, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Settings{}, apperr.Forbidden("Only platform admins can change document permissions")
	}
	var out Settings
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockDocumentAccessSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != revision {
			return apperr.Stale()
		}
		n, err := q.CountRestrictedDocuments(ctx)
		if err != nil {
			return err
		}
		if !enabled && n > 0 {
			return errStillRestricted
		}
		if cur.Enabled == enabled {
			out = Settings{DocumentAccessSetting: cur, RestrictedDocuments: n}
			return nil
		}
		st, err := q.SetDocumentAccessSettings(ctx, dbgen.SetDocumentAccessSettingsParams{Enabled: enabled, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}})
		if err != nil {
			return err
		}
		out = Settings{DocumentAccessSetting: st, RestrictedDocuments: n}
		e := a.Audit("platform.document_permissions", "document_access_settings", "settings")
		e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": st.Enabled}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// MaxPrincipals is the most people and groups a restriction set by hand names.
const MaxPrincipals = 50

// ParsePrincipals validates a restriction set by hand: group:<name>, email:<address> or user:<id>, normalised and
// without repeats; at least one (a restriction to nobody is not set by hand).
func ParsePrincipals(in []string) ([]string, error) {
	if len(in) == 0 {
		return nil, apperr.Invalid("invalid_access", "Choose at least one group or person, or make the source unrestricted")
	}
	if len(in) > MaxPrincipals {
		return nil, apperr.Invalid("invalid_access", fmt.Sprintf("At most %d groups and people", MaxPrincipals))
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, raw := range in {
		kind, value, ok := strings.Cut(strings.TrimSpace(raw), ":")
		value = strings.ToLower(strings.TrimSpace(value))
		valid := ok && value != "" && len(value) <= 256
		switch kind {
		case KindGroup:
		case KindEmail:
			valid = valid && strings.Count(value, "@") == 1 && !strings.HasPrefix(value, "@") && !strings.HasSuffix(value, "@")
		case KindUser:
			_, err := uuid.Parse(value)
			valid = valid && err == nil
		default:
			valid = false
		}
		if !valid {
			return nil, apperr.Invalid("invalid_access", fmt.Sprintf("%q is not a group (group:name), an email address (email:address) or a person (user:id)", raw))
		}
		p := Principal(kind, value)
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out, nil
}
