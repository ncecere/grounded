package webhooks

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Created is a new webhook with its secret, which is shown this once.
type Created struct {
	Webhook Webhook
	Secret  string
}

// List returns the scope's webhooks (a team's admins and owners; platform admins and auditors for the platform's).
func (s *Service) List(ctx context.Context, a authz.Actor, teamRef string) ([]Webhook, error) {
	sc, err := s.manage(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListWebhooks(ctx, nullTeam(sc.id()))
	out := make([]Webhook, len(rows))
	for i, r := range rows {
		out[i] = webhookOf(r)
	}
	return out, err
}

// Get returns one webhook of the scope.
func (s *Service) Get(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Webhook, error) {
	sc, err := s.manage(ctx, a, teamRef, false)
	if err != nil {
		return Webhook{}, err
	}
	w, err := s.load(ctx, s.q, sc, id, false)
	return webhookOf(w), err
}

// snapshot is what an audit entry records of a webhook: never its secret.
func snapshot(w dbgen.Webhook) map[string]any {
	return map[string]any{"url": w.URL, "description": w.Description, "events": w.Events, "enabled": w.Enabled, "pausedReason": w.PausedReason}
}

// entry is an audit entry for a webhook of scope sc: a team's go in the team's log, the platform's in the platform's.
func entry(a authz.Actor, sc scope, action string, id uuid.UUID) audit.Entry {
	e := a.Audit(action, "webhook", id.String())
	e.TeamID = sc.id()
	return e
}

// Create makes a webhook and returns its secret, shown once (team admins and owners, or platform admins; audited).
func (s *Service) Create(ctx context.Context, a authz.Actor, teamRef string, in Input) (Created, error) {
	sc, err := s.manage(ctx, a, teamRef, true)
	if err != nil {
		return Created{}, err
	}
	if on, err := s.Enabled(ctx); err != nil {
		return Created{}, err
	} else if !on {
		return Created{}, errOff
	}
	secret, err := newSecret()
	if err != nil {
		return Created{}, err
	}
	var out Created
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if in, err = s.normalize(ctx, q, sc, in); err != nil {
			return err
		}
		// The scope's count is read under a lock, so two requests cannot both pass the limit.
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "webhooks:"+sc.id().String()); err != nil {
			return err
		}
		if n, err := q.CountWebhooks(ctx, nullTeam(sc.id())); err != nil {
			return err
		} else if n >= maxWebhooksPerScope {
			return errTooMany
		}
		id := uuid.New()
		cipher, hint, err := s.seal(id, secret)
		if err != nil {
			return err
		}
		row, err := q.InsertWebhook(ctx, dbgen.InsertWebhookParams{ID: id, TeamID: nullTeam(sc.id()), URL: in.URL, Description: in.Description,
			Events: in.Events, SecretCipher: cipher, SecretHint: hint, CreatedBy: nullTeam(a.UserID)})
		if err != nil {
			return err
		}
		if !in.Enabled { // made turned off
			if row, err = q.UpdateWebhook(ctx, dbgen.UpdateWebhookParams{ID: id, URL: row.URL, Description: row.Description, Events: row.Events, Enabled: false}); err != nil {
				return err
			}
		}
		out = Created{Webhook: webhookOf(row), Secret: secret}
		e := entry(a, sc, "webhook.create", id)
		e.After = snapshot(row)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// Update changes a webhook (If-Match). Turning it on again clears what paused it.
func (s *Service) Update(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, in Input, expectedRevision int64) (Webhook, error) {
	sc, err := s.manage(ctx, a, teamRef, true)
	if err != nil {
		return Webhook{}, err
	}
	if on, err := s.Enabled(ctx); err != nil {
		return Webhook{}, err
	} else if !on {
		return Webhook{}, errOff
	}
	var out Webhook
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.load(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if in, err = s.normalize(ctx, q, sc, in); err != nil {
			return err
		}
		row, err := q.UpdateWebhook(ctx, dbgen.UpdateWebhookParams{ID: id, URL: in.URL, Description: in.Description, Events: in.Events, Enabled: in.Enabled})
		if err != nil {
			return err
		}
		out = webhookOf(row)
		e := entry(a, sc, "webhook.update", id)
		e.Before, e.After = snapshot(cur), snapshot(row)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// Delete removes a webhook and its deliveries.
func (s *Service) Delete(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	sc, err := s.manage(ctx, a, teamRef, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.load(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if _, err := q.DeleteWebhook(ctx, id); err != nil {
			return err
		}
		e := entry(a, sc, "webhook.delete", id)
		e.Before = snapshot(cur)
		return audit.Record(ctx, q, e)
	})
}

// RotateSecret replaces a webhook's secret at once and returns the new one, shown once.
func (s *Service) RotateSecret(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Created, error) {
	sc, err := s.manage(ctx, a, teamRef, true)
	if err != nil {
		return Created{}, err
	}
	secret, err := newSecret()
	if err != nil {
		return Created{}, err
	}
	var out Created
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if _, err := s.load(ctx, q, sc, id, true); err != nil {
			return err
		}
		cipher, hint, err := s.seal(id, secret)
		if err != nil {
			return err
		}
		row, err := q.SetWebhookSecret(ctx, dbgen.SetWebhookSecretParams{ID: id, SecretCipher: cipher, SecretHint: hint})
		if err != nil {
			return err
		}
		out = Created{Webhook: webhookOf(row), Secret: secret}
		e := entry(a, sc, "webhook.rotate_secret", id)
		e.Metadata = map[string]any{"hint": hint}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// ---- deliveries ---------------------------------------------------------------------

// Delivery is one send of one event to one webhook.
type Delivery struct {
	ID            uuid.UUID
	WebhookID     uuid.UUID
	EventID       uuid.UUID
	EventType     string
	Status        string
	Attempts      int
	LastStatus    *int
	LastError     string
	LastAttemptAt *time.Time
	DeliveredAt   *time.Time
	CreatedAt     time.Time
}

func deliveryOf(r dbgen.WebhookDelivery) Delivery {
	d := Delivery{ID: r.ID, WebhookID: r.WebhookID, EventID: r.EventID, EventType: r.EventType, Status: r.Status, Attempts: int(r.Attempts),
		LastError: r.LastError, CreatedAt: r.CreatedAt}
	if r.LastStatus != nil {
		v := int(*r.LastStatus)
		d.LastStatus = &v
	}
	d.LastAttemptAt, d.DeliveredAt = r.LastAttemptAt, r.DeliveredAt
	return d
}

// Deliveries lists a webhook's recent deliveries, newest first.
func (s *Service) Deliveries(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) ([]Delivery, error) {
	sc, err := s.manage(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	if _, err := s.load(ctx, s.q, sc, id, false); err != nil {
		return nil, err
	}
	rows, err := s.q.ListWebhookDeliveries(ctx, dbgen.ListWebhookDeliveriesParams{WebhookID: id, Limit: 50})
	out := make([]Delivery, len(rows))
	for i, r := range rows {
		out[i] = deliveryOf(r)
	}
	return out, err
}
