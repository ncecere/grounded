package httpapi

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Webhooks (v0.6.0, F3; docs/specs/v0.6.0/DESIGN.md §5): signed, retried events for other systems. A team's admins and owners manage the
// team's webhooks; platform admins manage the platform's and the approved destinations. The same handlers serve both: the team routes
// carry {team}, the platform's do not.

func (a *api) webhookRoutes() []route {
	var out []route
	for _, p := range []struct {
		prefix string
		wrap   func(http.HandlerFunc) http.Handler
	}{{"/v1/teams/{team}/webhooks", a.session}, {"/v1/admin/webhooks", a.admin}} {
		out = append(out,
			route{"GET", p.prefix, p.wrap(a.listWebhooks)},
			route{"POST", p.prefix, p.wrap(a.createWebhook)},
			route{"GET", p.prefix + "/{webhookId}", p.wrap(a.getWebhook)},
			route{"PATCH", p.prefix + "/{webhookId}", p.wrap(a.updateWebhook)},
			route{"DELETE", p.prefix + "/{webhookId}", p.wrap(a.deleteWebhook)},
			route{"POST", p.prefix + "/{webhookId}/rotate-secret", p.wrap(a.rotateWebhookSecret)},
			route{"POST", p.prefix + "/{webhookId}/test", p.wrap(a.testWebhook)},
			route{"GET", p.prefix + "/{webhookId}/deliveries", p.wrap(a.listWebhookDeliveries)},
			route{"POST", p.prefix + "/{webhookId}/deliveries/{deliveryId}/redeliver", p.wrap(a.redeliverWebhook)},
		)
	}
	return append(out,
		route{"GET", "/v1/webhook-events", a.session(a.listWebhookEvents)},
		route{"GET", "/v1/webhook-destinations", a.session(a.listWebhookDestinations)},
		route{"POST", "/v1/admin/webhook-destinations", a.admin(a.createWebhookDestination)},
		route{"DELETE", "/v1/admin/webhook-destinations/{destinationId}", a.admin(a.deleteWebhookDestination)},
		route{"GET", "/v1/admin/settings/webhooks", a.admin(a.adminGetWebhookSettings)},
		route{"PUT", "/v1/admin/settings/webhooks", a.admin(a.adminPutWebhookSettings)},
	)
}

// webhooksOn reports the platform switch (the app's capability for the Webhooks pages).
func (a *api) webhooksOn(ctx context.Context) bool {
	if a.Webhooks == nil {
		return false
	}
	on, err := a.Webhooks.Enabled(ctx)
	return err == nil && on
}

func toAPIWebhook(w webhooks.Webhook) apitypes.Webhook {
	out := apitypes.Webhook{
		Id: w.ID, Url: w.URL, Description: w.Description, Events: w.Events, SecretHint: w.SecretHint, Enabled: w.Enabled,
		PausedReason: apitypes.WebhookPausedReason(w.PausedReason), ConsecutiveFailures: w.ConsecutiveFailures, Revision: w.Revision,
		CreatedAt: w.CreatedAt, UpdatedAt: w.UpdatedAt,
	}
	if w.TeamID != uuid.Nil {
		id := w.TeamID
		out.TeamId = &id
	}
	return out
}

func toAPIWebhookDelivery(d webhooks.Delivery) apitypes.WebhookDelivery {
	return apitypes.WebhookDelivery{
		Id: d.ID, WebhookId: d.WebhookID, EventId: d.EventID, EventType: d.EventType, Status: apitypes.WebhookDeliveryStatus(d.Status), Attempts: d.Attempts,
		LastStatus: d.LastStatus, LastError: d.LastError, LastAttemptAt: d.LastAttemptAt, DeliveredAt: d.DeliveredAt, CreatedAt: d.CreatedAt,
	}
}

func toAPIWebhookDestination(d webhooks.Destination) apitypes.WebhookDestination {
	return apitypes.WebhookDestination{Id: d.ID, Pattern: d.Pattern, Note: d.Note, CreatedAt: d.CreatedAt}
}

func webhookInput(in apitypes.WebhookInput) webhooks.Input {
	return webhooks.Input{URL: in.Url, Description: deref(in.Description, ""), Events: in.Events, Enabled: in.Enabled}
}

// team is the {team} of a team route ("" on a platform route).
func team(r *http.Request) string { return r.PathValue("team") }

func (a *api) listWebhooks(w http.ResponseWriter, r *http.Request) {
	list, err := a.Webhooks.List(r.Context(), a.actor(r), team(r))
	writeList(w, r, list, err, toAPIWebhook)
}

func (a *api) createWebhook(w http.ResponseWriter, r *http.Request) {
	var in apitypes.WebhookInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	c, err := a.Webhooks.Create(r.Context(), a.actor(r), team(r), webhookInput(in))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, apitypes.WebhookCreated{Webhook: toAPIWebhook(c.Webhook), Secret: c.Secret})
}

func (a *api) getWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "webhookId")
	if !ok {
		return
	}
	h, err := a.Webhooks.Get(r.Context(), a.actor(r), team(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, h.Revision, toAPIWebhook(h))
}

func (a *api) updateWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "webhookId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.WebhookInput](w, r)
	if !ok {
		return
	}
	h, err := a.Webhooks.Update(r.Context(), a.actor(r), team(r), id, webhookInput(in), rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, h.Revision, toAPIWebhook(h))
}

func (a *api) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "webhookId")
	if !ok {
		return
	}
	writeOK(w, r, a.Webhooks.Delete(r.Context(), a.actor(r), team(r), id))
}

func (a *api) rotateWebhookSecret(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "webhookId")
	if !ok {
		return
	}
	c, err := a.Webhooks.RotateSecret(r.Context(), a.actor(r), team(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.WebhookCreated{Webhook: toAPIWebhook(c.Webhook), Secret: c.Secret})
}

func (a *api) testWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "webhookId")
	if !ok {
		return
	}
	d, err := a.Webhooks.Test(r.Context(), a.actor(r), team(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusAccepted, toAPIWebhookDelivery(d))
}

func (a *api) listWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "webhookId")
	if !ok {
		return
	}
	list, err := a.Webhooks.Deliveries(r.Context(), a.actor(r), team(r), id)
	writeList(w, r, list, err, toAPIWebhookDelivery)
}

func (a *api) redeliverWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "webhookId")
	if !ok {
		return
	}
	did, ok := pathUUID(w, r, "deliveryId")
	if !ok {
		return
	}
	d, err := a.Webhooks.Redeliver(r.Context(), a.actor(r), team(r), id, did)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusAccepted, toAPIWebhookDelivery(d))
}

func (a *api) listWebhookEvents(w http.ResponseWriter, r *http.Request) {
	out := make([]apitypes.WebhookEventType, 0, len(webhooks.Catalog))
	for _, e := range webhooks.Catalog {
		if !e.Test {
			out = append(out, apitypes.WebhookEventType{Type: e.Type, Scope: apitypes.WebhookEventTypeScope(e.Scope), Description: e.Description})
		}
	}
	writeList(w, r, out, nil, func(e apitypes.WebhookEventType) apitypes.WebhookEventType { return e })
}

func (a *api) listWebhookDestinations(w http.ResponseWriter, r *http.Request) {
	list, err := a.Webhooks.Destinations(r.Context(), a.actor(r))
	writeList(w, r, list, err, toAPIWebhookDestination)
}

func (a *api) createWebhookDestination(w http.ResponseWriter, r *http.Request) {
	var in apitypes.WebhookDestinationCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	d, err := a.Webhooks.AddDestination(r.Context(), a.actor(r), in.Pattern, deref(in.Note, ""))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPIWebhookDestination(d))
}

func (a *api) deleteWebhookDestination(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "destinationId")
	if !ok {
		return
	}
	writeOK(w, r, a.Webhooks.RemoveDestination(r.Context(), a.actor(r), id))
}

func toAPIWebhookSettings(s webhooks.Settings) apitypes.WebhookSettings {
	return apitypes.WebhookSettings{Enabled: s.Enabled, Revision: s.Revision, UpdatedAt: s.UpdatedAt}
}

func (a *api) adminGetWebhookSettings(w http.ResponseWriter, r *http.Request) {
	st, err := a.Webhooks.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIWebhookSettings(st))
}

func (a *api) adminPutWebhookSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.WebhookSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.Webhooks.SetEnabled(r.Context(), a.actor(r), in.Enabled, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIWebhookSettings(st))
}
