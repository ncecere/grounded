package httpapi_test

// Classification of webhooks (v0.6.0, F3). A team's admins and owners manage the team's webhooks (a platform admin who is not on the team
// is refused like anyone else: ADR-0011); platform admins manage the platform's, and platform staff read them; never API keys. Any person
// signed in reads the event types and the approved destinations (a team admin needs them to choose an address); platform admins approve
// destinations and turn the feature on.
//
// The platform switch is off in the matrix, so a change is refused for the state of the feature (409 webhooks_off) after it passed
// authorization, and an operation on one webhook answers 404 for an id that does not exist. Both count as allowed for the callers who may
// make the call. TestWebhook* cover what the operations do.

const noWebhook = "00000000-0000-4000-8000-000000000000"

func init() {
	body := map[string]any{"url": "https://hooks.example.edu/grounded", "events": []string{"agent.published"}, "enabled": true}
	off, gone := []string{"409 webhooks_off"}, []string{"404 webhook_not_found", "409 webhooks_off"}
	for _, s := range []struct {
		who  string
		path func(c *mctx, rest string) string
		read callers // who reads a scope's webhooks
		own  callers // who changes them
	}{
		{"Team", func(c *mctx, rest string) string { return c.team("/webhooks" + rest) }, admins, admins},
		{"Platform", func(_ *mctx, rest string) string { return "/v1/admin/webhooks" + rest }, platform, padmin},
	} {
		scope := scopeTeam
		if s.who == "Platform" {
			scope = scopeGlobal
		}
		one := "/" + noWebhook
		for id, p := range map[string]policy{
			"list" + s.who + "Webhooks": {own: s.read, build: func(c *mctx) request { return get(s.path(c, "")) }},
			"create" + s.who + "Webhook": {own: s.own, also: off, build: func(c *mctx) request {
				return post(s.path(c, ""), body)
			}},
			"get" + s.who + "Webhook": {own: s.read, also: gone[:1], build: func(c *mctx) request { return get(s.path(c, one)) }},
			"update" + s.who + "Webhook": {own: s.own, also: gone, build: func(c *mctx) request {
				return patch(s.path(c, one), body).h(ifMatch(1))
			}},
			"delete" + s.who + "Webhook": {own: s.own, also: gone[:1], build: func(c *mctx) request { return del(s.path(c, one)) }},
			"rotate" + s.who + "WebhookSecret": {own: s.own, also: gone[:1], build: func(c *mctx) request {
				return post(s.path(c, one+"/rotate-secret"), nil)
			}},
			"test" + s.who + "Webhook": {own: s.own, also: gone, build: func(c *mctx) request { return post(s.path(c, one+"/test"), nil) }},
			"list" + s.who + "WebhookDeliveries": {own: s.read, also: gone[:1], build: func(c *mctx) request {
				return get(s.path(c, one+"/deliveries"))
			}},
			"redeliver" + s.who + "Webhook": {own: s.own, also: gone, build: func(c *mctx) request {
				return post(s.path(c, one+"/deliveries/"+noWebhook+"/redeliver"), nil)
			}},
		} {
			p.scope = scope
			register(id, p)
		}
	}
	for id, p := range map[string]policy{
		"listWebhookEvents":       {own: signedIn, build: func(*mctx) request { return get("/v1/webhook-events") }},
		"listWebhookDestinations": {own: signedIn, build: func(*mctx) request { return get("/v1/webhook-destinations") }},
		"createWebhookDestination": {own: padmin, also: []string{"409 destination_exists"}, build: func(*mctx) request {
			return post("/v1/admin/webhook-destinations", map[string]any{"pattern": "matrix.example.edu"})
		}},
		"deleteWebhookDestination": {own: padmin, also: []string{"404 destination_not_found"}, build: func(*mctx) request {
			return del("/v1/admin/webhook-destinations/" + noWebhook)
		}},
		"adminGetWebhookSettings": adminRead("/v1/admin/settings/webhooks"),
		"adminPutWebhookSettings": {own: padmin, build: func(c *mctx) request {
			p := "/v1/admin/settings/webhooks"
			return put(p, map[string]any{"enabled": false}).h(c.rev(p))
		}},
	} {
		p.scope = scopeGlobal
		register(id, p)
	}
}
