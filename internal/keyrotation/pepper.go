package keyrotation

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Key kinds in a pepper report.
const (
	KindAPIKey         = "api_key"
	KindPublishableKey = "publishable_key"
)

// PepperKey is a usable key whose digest is not on the current pepper.
type PepperKey struct {
	Kind       string // KindAPIKey or KindPublishableKey
	ID         uuid.UUID
	Name       string
	TeamSlug   string
	TeamName   string
	AgentName  string // publishable keys
	LastUsedAt *time.Time
	CreatedAt  time.Time
	// State is PepperPrevious (re-hashed on next use; stops working when
	// API_KEY_PEPPER_PREVIOUS is removed) or PepperRetired (made with a
	// pepper no longer configured: it cannot work and should be revoked).
	State secrets.PepperState
}

// PepperReport lists usable API keys and publishable keys that are not on
// the current pepper (none without a pepper).
func PepperReport(ctx context.Context, q *dbgen.Queries, p secrets.Peppers) ([]PepperKey, error) {
	if len(p.Current) == 0 {
		return []PepperKey{}, nil
	}
	rows, err := q.KeysNotOnPepper(ctx, p.CurrentID())
	if err != nil {
		return nil, err
	}
	out := []PepperKey{}
	for _, r := range rows {
		st := p.State(r.PepperID)
		if st == secrets.PepperCurrent {
			continue
		}
		out = append(out, PepperKey{
			Kind: r.Kind, ID: r.ID, Name: r.Name, TeamSlug: r.TeamSlug, TeamName: r.TeamName, AgentName: r.AgentName,
			LastUsedAt: r.LastUsedAt, CreatedAt: r.CreatedAt, State: st,
		})
	}
	return out, nil
}

// labelLegacy records the previous pepper's id on digests from before
// pepper ids, while a previous pepper is configured. Until then such a
// digest counts as "previous" only while API_KEY_PEPPER_PREVIOUS is set;
// the label keeps a key that is never used during the grace period listed
// (as retired) after the previous pepper is removed.
func labelLegacy(ctx context.Context, pool *pgxpool.Pool, p secrets.Peppers) (apiKeys, publishable int64, err error) {
	if len(p.Previous) == 0 {
		return 0, 0, nil
	}
	id := secrets.PepperID(p.Previous)
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if apiKeys, err = q.LabelLegacyAPIKeys(ctx, id); err != nil {
			return err
		}
		publishable, err = q.LabelLegacyPublishableKeys(ctx, id)
		return err
	})
	return apiKeys, publishable, err
}
