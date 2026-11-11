package platform

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/sourcetypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// SourceType is a registered source type with the platform's switch for it.
type SourceType struct {
	sourcetypes.Type
	// Enabled: new sources of the type can be made, and a connector type syncs. Turning a type off keeps its sources
	// and their documents, which stay searchable.
	Enabled bool
	// Sources counts the install's sources of the type (platform admins and auditors; 0 for everyone else).
	Sources int64
}

var errNoSourceType = apperr.NotFound("source_type_not_found", "Source type not found")

// SourceTypes lists the registered source types (every signed-in person: a team needs them to add a source). The
// built-in types are on unless turned off; every other type is off until a platform admin turns it on.
func (s *Service) SourceTypes(ctx context.Context, a authz.Actor) ([]SourceType, error) {
	rows, err := s.q.ListSourceTypeSettings(ctx)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, r := range rows {
		set[r.Type] = r.Enabled
	}
	counts := map[string]int64{}
	if a.CanReadPlatform() {
		cs, err := s.q.CountSourcesByType(ctx)
		if err != nil {
			return nil, err
		}
		for _, c := range cs {
			counts[c.Type] = c.Sources
		}
	}
	all := sourcetypes.All()
	out := make([]SourceType, len(all))
	for i, t := range all {
		enabled, ok := set[t.Key]
		if !ok {
			enabled = t.BuiltIn
		}
		out[i] = SourceType{Type: t, Enabled: enabled, Sources: counts[t.Key]}
	}
	return out, nil
}

// SourceTypeEnabled reports whether a source type is registered and on.
func SourceTypeEnabled(ctx context.Context, q *dbgen.Queries, key string) (bool, error) {
	t, ok := sourcetypes.Get(key)
	if !ok {
		return false, nil
	}
	st, err := q.GetSourceTypeSetting(ctx, key)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return t.BuiltIn, nil
	}
	return st.Enabled, err
}

// SetSourceTypeEnabled turns a source type on or off (platform admins; audited as platform.source_type).
func (s *Service) SetSourceTypeEnabled(ctx context.Context, a authz.Actor, key string, enabled bool) (SourceType, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return SourceType{}, errAdminOnly
	}
	t, ok := sourcetypes.Get(key)
	if !ok {
		return SourceType{}, errNoSourceType
	}
	out := SourceType{Type: t, Enabled: enabled}
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockSourceTypeSetting(ctx, key); err != nil {
			return err
		}
		before, err := SourceTypeEnabled(ctx, q, key)
		if err != nil || before == enabled {
			return err // nothing to change: no write and no audit entry
		}
		if _, err := q.SetSourceTypeSetting(ctx, dbgen.SetSourceTypeSettingParams{
			Type: key, Enabled: enabled, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true},
		}); err != nil {
			return err
		}
		e := a.Audit("platform.source_type", "source_type", key)
		e.Before, e.After = map[string]any{"enabled": before}, map[string]any{"enabled": enabled}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return SourceType{}, err
	}
	cs, err := s.q.CountSourcesByType(ctx)
	for _, c := range cs {
		if c.Type == key {
			out.Sources = c.Sources
		}
	}
	return out, err
}
