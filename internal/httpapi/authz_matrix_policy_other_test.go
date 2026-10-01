package httpapi_test

import (
	"net/url"
	"strings"
)

// Classification of everything that is neither a team route nor platform
// administration: operations endpoints, sign-in, the caller's own account
// and conversations, the agent directory, and the anonymous public API.

// matrixPolicies is every classified operation, by operationId.
var matrixPolicies = map[string]policy{}

func register(id string, p policy) {
	if _, dup := matrixPolicies[id]; dup {
		panic("operation classified twice: " + id)
	}
	matrixPolicies[id] = p
}

func init() {
	for id, p := range globalPolicies {
		p.scope = scopeGlobal
		register(id, p)
	}
	for id, p := range userPolicies {
		p.scope = scopeUser
		register(id, p)
	}
	for id, p := range publicPolicies {
		p.scope = scopePublic
		register(id, p)
	}
}

func always(path string) policy {
	return policy{own: everyone, build: func(*mctx) request { return get(path) }}
}

func sessionGet(path string) policy {
	return policy{own: signedIn, build: func(*mctx) request { return get(path) }}
}

var globalPolicies = map[string]policy{
	"getHealthz":      always("/healthz"),
	"getReadyz":       always("/readyz"),
	"getMetrics":      always("/metrics"),
	"getWidgetScript": always("/widget.js"),
	"getAuthConfig":   always("/v1/auth/config"),
	// Sign-in plumbing: redirects and one-time codes, not authorization.
	"startLogin":    {own: everyone, anyStatus: true, build: func(*mctx) request { return get("/auth/login") }},
	"completeLogin": {own: everyone, anyStatus: true, build: func(*mctx) request { return get("/auth/callback?state=x&code=y") }},
	"devLogin": {own: everyone, anyStatus: true, build: func(*mctx) request {
		return post("/auth/dev", map[string]any{"account": "nobody"})
	}},
	"logout": {own: signedIn, build: func(*mctx) request { r := post("/auth/logout", nil); r.newSession = true; return r }},

	// The caller's own account.
	"getMe":                   sessionGet("/v1/me"),
	"listNotifications":       sessionGet("/v1/notifications"),
	"getNotificationSettings": sessionGet("/v1/me/notification-settings"),
	"markAllNotificationsRead": {own: signedIn, build: func(*mctx) request {
		return post("/v1/notifications/read-all", map[string]any{})
	}},
	"updateNotificationSettings": {own: signedIn, build: func(*mctx) request {
		return put("/v1/me/notification-settings", map[string]any{"items": []any{}})
	}},
	"listMyTeams":                 sessionGet("/v1/teams"),
	"listMyBreakGlassSessions":    sessionGet("/v1/me/break-glass"),
	"listClassifications":         sessionGet("/v1/classifications"),
	"listUsableEmbeddingProfiles": sessionGet("/v1/embedding-profiles"),
	"listUsableChatModels":        sessionGet("/v1/chat-models"),
	"listUsableMCPTools":          sessionGet("/v1/mcp-tools"),
	"listSharedSources":           sessionGet("/v1/shared-sources"),
	"getSystemOneStatus":          sessionGet("/v1/systemone/status"),
	"getRerankStatus":             sessionGet("/v1/rerank/status"),
	"checkWidgetOrigins": {own: signedIn, build: func(*mctx) request {
		return post("/v1/widget-origins/check", map[string]any{"origins": []string{widgetOrigin}})
	}},
	"getMaintenance": {own: signedIn.and(allKeys), build: func(*mctx) request { return get("/v1/maintenance") }},

	// Directory, conversations and models: team B's public agent is listed
	// to everyone signed in; team A's team-only agent to no one here. Keys
	// without the query scope get empty lists.
	"listAgentDirectory": {own: signedIn.and(allKeys), build: func(*mctx) request { return get("/v1/agents") }},
	"listConversations":  {own: signedIn.and(allKeys), build: func(*mctx) request { return get("/v1/conversations") }},
	"openaiListModels":   {own: signedIn.and(allKeys), build: func(*mctx) request { return get("/v1/models") }},

	// Object search ("xyzzy" matches every team A object, its owner's
	// conversation title included): session only, so keys get 401. Team B's
	// people find none of team A's objects (the leak check); platform
	// readers find team A itself (metadata) but never its conversation,
	// whose title carries the content marker.
	"searchObjects": {own: signedIn, build: func(*mctx) request { return get("/v1/search?q=" + strings.ToLower(nameMarker)) }},
}

// A conversation is its user's alone; a personal key reaches it with the
// query scope (conversations_keys_integration_test.go).
var userPolicies = map[string]policy{
	"getConversation": {own: signedIn.and(of(cKeyQuery)), build: func(c *mctx) request { return get("/v1/conversations/" + c.own().conv) }},
	"renameConversation": {own: signedIn.and(of(cKeyQuery)), build: func(c *mctx) request {
		return patch("/v1/conversations/"+c.own().conv, map[string]any{"title": "Renamed by the matrix"})
	}},
	"deleteConversation": {own: signedIn.and(of(cKeyQuery)), build: func(c *mctx) request {
		conv := c.own().conv
		if who := c.who; c.allowed {
			if who == cKeyIngest || who == cKeyManage {
				who = cOwner // the key's user; the key itself can't chat
			}
			conv, _ = c.e.newConversation(c.t, who)
		}
		return del("/v1/conversations/" + conv)
	}},
	"exportConversation": {own: signedIn.and(of(cKeyQuery)), build: func(c *mctx) request {
		return get("/v1/conversations/" + c.own().conv + "/export")
	}},
	"setMessageFeedback": {own: signedIn.and(of(cKeyQuery)), build: func(c *mctx) request {
		return post("/v1/messages/"+c.own().message+"/feedback", map[string]any{"rating": "up"})
	}},
	"updateNotification": {own: signedIn, build: func(c *mctx) request {
		id := c.own().notification
		switch {
		case c.foreign:
			id = c.e.a.notification(c.t)
		case id == "" && c.allowed:
			return request{skip: "the caller has no notification"}
		case id == "":
			id = c.e.b.notification(c.t) // someone else's: must be refused
		}
		return patch("/v1/notifications/"+id, map[string]any{"read": true})
	}},
}

// publicKey is what the widget sends for a publishable-key caller: the key
// and the embedding page's origin. Others send neither.
func (c *mctx) publicKey() (key, embedOrigin any) {
	if c.who == cPublishable {
		return c.e.b.pubSecret, widgetOrigin
	}
	return nil, nil
}

var publicPolicies = map[string]policy{
	"getPublicAgent": {own: noBearers, build: func(c *mctx) request { return get("/v1/public/agents/" + c.tf.agent).anon() }},
	"getPublicAgentByTeam": {own: noBearers, build: func(c *mctx) request {
		return get("/v1/public/teams/" + c.tf.slug + "/agents/" + c.tf.agentSl).anon()
	}},
	// Always 200 ({allowed: false} and a reason) so any site can read it;
	// only the leak check applies.
	"widgetCheck": {own: everyone, foreign: everyone, anyStatus: true, build: func(c *mctx) request {
		q := url.Values{"origin": {widgetOrigin}}
		if c.who == cPublishable {
			q.Set("key", c.e.b.pubSecret)
		}
		return get("/v1/public/agents/" + c.tf.agent + "/widget-check?" + q.Encode()).anon()
	}},
	"getEmbedPage": {own: everyone, anyStatus: true, build: func(c *mctx) request { return get("/embed/" + c.tf.agent).anon() }},
	"createPublicSession": {own: noBearers, build: func(c *mctx) request {
		key, origin := c.publicKey()
		return post("/v1/public/sessions", map[string]any{"agentId": c.tf.agent, "key": key, "embedOrigin": origin}).anon()
	}},
	"getPublicSession": {own: noBearers, build: func(c *mctx) request {
		if c.allowed {
			c.e.ensurePublicSession(c.t, c.who)
		}
		return get("/v1/public/sessions/current?agentId=" + c.tf.agent).anon()
	}},
	"publicChat": {own: noBearers, build: func(c *mctx) request {
		if c.allowed {
			c.e.ensurePublicSession(c.t, c.who)
		}
		return post("/v1/public/agents/"+c.tf.agent+"/chat", map[string]any{"message": "Where do students buy a parking permit?", "stream": false}).anon()
	}},
	// Agent profiles by ID and short name (signed in or with a key).
	"getAgentProfileByID": {own: signedIn.and(readKeys), build: func(c *mctx) request { return get("/v1/agents/id/" + c.tf.agent) }},
	"getAgentProfileByShortName": {own: signedIn.and(readKeys), build: func(c *mctx) request {
		if c.foreign {
			return get("/v1/agents/short/xyzzy")
		}
		return get("/v1/agents/short/bhelp")
	}},
}
