package costs

import (
	"context"
	"math/big"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Settings are the platform cost settings.
type Settings struct {
	Mode          string
	Currency      string
	TimeZone      string
	WarnPercent   int
	DefaultBudget *big.Rat // nil: none
	Generation    int64
	Revision      int64
	UpdatedAt     time.Time
}

// Location is the settings' time zone.
func (st Settings) Location() *time.Location { return zone(st.TimeZone) }

func settingsFrom(r dbgen.GetCostSettingsRow) Settings {
	return Settings{Mode: r.Mode, Currency: r.Currency, TimeZone: r.TimeZone, WarnPercent: int(r.WarnPercent),
		DefaultBudget: optRat(r.DefaultBudget), Generation: r.Generation, Revision: r.Revision, UpdatedAt: r.UpdatedAt}
}

// current reads the settings without permission checks.
func (s *Service) current(ctx context.Context) (Settings, error) {
	r, err := s.q.GetCostSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	return settingsFrom(r), nil
}

// Settings returns the platform cost settings (platform admins and auditors).
func (s *Service) Settings(ctx context.Context, a authz.Actor) (Settings, error) {
	if !canRead(a) {
		return Settings{}, errReadOnly
	}
	return s.current(ctx)
}

// SettingsInput is a full replacement of the settings.
type SettingsInput struct {
	Mode          string
	Currency      string
	TimeZone      string
	WarnPercent   int
	DefaultBudget *string // nil: none
}

var currencyRE = regexp.MustCompile(`^[A-Z]{3}$`)

// ValidMode reports a platform mode.
func ValidMode(m string) bool { return m == ModeOff || m == ModeTrack || m == ModeEnforce }

func validWarn(p int) error {
	if p < 1 || p > 100 {
		return apperr.Invalid("invalid_threshold", "The warning threshold must be between 1 and 100 percent")
	}
	return nil
}

func (in SettingsInput) validate() (*big.Rat, error) {
	if !ValidMode(in.Mode) {
		return nil, apperr.Invalid("invalid_mode", "The mode must be off, track or enforce")
	}
	if !currencyRE.MatchString(in.Currency) {
		return nil, apperr.Invalid("invalid_currency", "The currency must be a three-letter ISO 4217 code, such as USD")
	}
	if _, err := LoadZone(in.TimeZone); err != nil {
		return nil, err
	}
	if err := validWarn(in.WarnPercent); err != nil {
		return nil, err
	}
	if in.DefaultBudget == nil {
		return nil, nil
	}
	return ParseAmount(*in.DefaultBudget, "default budget")
}

func settingsSnapshot(st Settings) map[string]any {
	return map[string]any{"mode": st.Mode, "currency": st.Currency, "timeZone": st.TimeZone, "warnPercent": st.WarnPercent,
		"defaultBudget": optFormat(st.DefaultBudget)}
}

// UpdateSettings replaces the settings (platform admins; expectedRevision
// guards concurrent edits). Audited as costs.settings_update.
func (s *Service) UpdateSettings(ctx context.Context, a authz.Actor, in SettingsInput, expectedRevision int64) (Settings, error) {
	if !canWrite(a) {
		return Settings{}, errAdminOnly
	}
	budget, err := in.validate()
	if err != nil {
		return Settings{}, err
	}
	var out Settings
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		// Postgres converts hours to local days; it must know the zone too.
		if _, err := tx.Exec(ctx, `SELECT now() AT TIME ZONE $1::text`, in.TimeZone); err != nil {
			return apperr.Invalid("invalid_time_zone", "The database doesn't know the time zone "+in.TimeZone)
		}
		row, err := q.LockCostSettings(ctx)
		if err != nil {
			return err
		}
		cur := settingsFrom(dbgen.GetCostSettingsRow(row))
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if err := q.UpdateCostSettings(ctx, dbgen.UpdateCostSettingsParams{
			Mode: in.Mode, Currency: in.Currency, TimeZone: in.TimeZone, WarnPercent: int32(in.WarnPercent),
			DefaultBudget: optFormat(budget), UpdatedBy: by(a),
		}); err != nil {
			return err
		}
		next, err := q.GetCostSettings(ctx)
		if err != nil {
			return err
		}
		out = settingsFrom(next)
		e := a.Audit("costs.settings_update", "cost_settings", "platform")
		e.Before, e.After = settingsSnapshot(cur), settingsSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.changed(ctx, uuid.NullUUID{})
	}
	return out, err
}
