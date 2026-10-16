package webhooks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Emit records ev inside tx: one delivery per enabled webhook of its scope that subscribes to its type, each with a River job that runs after
// commit (an outbox: a change that rolls back sends nothing). With webhooks turned off, or no webhook listening, it records nothing.
func (s *Service) Emit(ctx context.Context, tx pgx.Tx, ev Event) error {
	if s == nil {
		return nil
	}
	t, ok := Lookup(ev.Type)
	if !ok || t.Test {
		return fmt.Errorf("webhooks: unknown event type %q", ev.Type)
	}
	if (t.Scope == ScopeTeam) != (ev.TeamID != uuid.Nil) {
		return fmt.Errorf("webhooks: %s is a %s event", ev.Type, t.Scope)
	}
	q := dbgen.New(tx)
	if st, err := q.GetWebhookSettings(ctx); err != nil || !st.Enabled {
		return err
	}
	hooks, err := q.MatchingWebhooks(ctx, dbgen.MatchingWebhooksParams{TeamID: nullTeam(ev.TeamID), EventType: ev.Type})
	if err != nil || len(hooks) == 0 {
		return err
	}
	env := Envelope{ID: uuid.New(), Type: ev.Type, CreatedAt: s.now().UTC(), Data: ev.Data}
	if ev.TeamID != uuid.Nil {
		team, err := q.GetTeamByID(ctx, ev.TeamID)
		if err != nil {
			return err
		}
		env.Team = &TeamRef{ID: team.ID, Slug: team.Slug, Name: team.Name}
	}
	payload, err := json.Marshal(env)
	if err != nil {
		return err
	}
	for _, h := range hooks {
		if _, err := s.queue(ctx, tx, q, h.ID, env, payload); err != nil {
			return err
		}
	}
	return nil
}

// queue records a delivery of payload to a webhook and its job.
func (s *Service) queue(ctx context.Context, tx pgx.Tx, q *dbgen.Queries, webhook uuid.UUID, env Envelope, payload []byte) (dbgen.WebhookDelivery, error) {
	d, err := q.InsertWebhookDelivery(ctx, dbgen.InsertWebhookDeliveryParams{WebhookID: webhook, EventID: env.ID, EventType: env.Type, Payload: payload})
	if err != nil {
		return d, err
	}
	if s.Jobs == nil {
		return d, nil // no job runner (a process that only reads): the delivery stays pending
	}
	_, err = s.Jobs.InsertTx(ctx, tx, DeliverArgs{DeliveryID: d.ID}, nil)
	return d, err
}

// Test sends a webhook a test event (webhook.test), whatever it subscribes to: an admin sees at once whether the address and the secret work.
func (s *Service) Test(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Delivery, error) {
	sc, err := s.manage(ctx, a, teamRef, true)
	if err != nil {
		return Delivery{}, err
	}
	if on, err := s.Enabled(ctx); err != nil {
		return Delivery{}, err
	} else if !on {
		return Delivery{}, errOff
	}
	var out Delivery
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		w, err := s.load(ctx, q, sc, id, false)
		if err != nil {
			return err
		}
		env := Envelope{ID: uuid.New(), Type: EventTest, CreatedAt: s.now().UTC(), Data: map[string]any{"message": "A test event from Grounded."}}
		if !sc.platform() {
			env.Team = &TeamRef{ID: sc.team.ID, Slug: sc.team.Slug, Name: sc.team.Name}
		}
		payload, err := json.Marshal(env)
		if err != nil {
			return err
		}
		d, err := s.queue(ctx, tx, q, w.ID, env, payload)
		if err != nil {
			return err
		}
		out = deliveryOf(d)
		e := entry(a, sc, "webhook.test", id)
		e.Metadata = map[string]any{"deliveryId": d.ID.String()}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// Redeliver sends a delivery's event again: the same event ID and body, a new delivery.
func (s *Service) Redeliver(ctx context.Context, a authz.Actor, teamRef string, id, deliveryID uuid.UUID) (Delivery, error) {
	sc, err := s.manage(ctx, a, teamRef, true)
	if err != nil {
		return Delivery{}, err
	}
	if on, err := s.Enabled(ctx); err != nil {
		return Delivery{}, err
	} else if !on {
		return Delivery{}, errOff
	}
	var out Delivery
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		w, err := s.load(ctx, q, sc, id, false)
		if err != nil {
			return err
		}
		old, err := q.GetWebhookDelivery(ctx, deliveryID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && old.WebhookID != w.ID) {
			return apperr.NotFound("delivery_not_found", "Delivery not found")
		} else if err != nil {
			return err
		}
		env := Envelope{ID: old.EventID, Type: old.EventType}
		d, err := s.queue(ctx, tx, q, w.ID, env, old.Payload)
		if err != nil {
			return err
		}
		out = deliveryOf(d)
		e := entry(a, sc, "webhook.redeliver", id)
		e.Metadata = map[string]any{"deliveryId": d.ID.String(), "of": old.ID.String()}
		return audit.Record(ctx, q, e)
	})
	return out, err
}
