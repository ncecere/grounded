package httpapi_test

import "strings"

// Classification of sharing a conversation (v0.6.0, C12). The owner makes, lists and revokes links with a signed-in session: API keys, even a
// personal key that can read the conversation, get 401, and so does anyone else without a session. A link opens for the people it is for: here
// the owner's own link (the callers' own conversations; someone else's link is covered by TestSharedConversation*), and team A's link is closed to
// everyone on team B and to the platform's staff alike (404): platform roles give no access to a transcript, nor to a link to one.

func init() {
	for id, p := range sharePolicies {
		p.scope = scopeUser
		register(id, p)
	}
}

var sharePolicies = map[string]policy{
	"listConversationShares": {own: signedIn, build: func(c *mctx) request { return get("/v1/conversations/" + c.own().conv + "/shares") }},
	"createConversationShare": {own: signedIn, build: func(c *mctx) request {
		return post("/v1/conversations/"+c.own().conv+"/shares", map[string]any{"audience": "agent_users"})
	}},
	"revokeConversationShare": {own: signedIn, build: func(c *mctx) request {
		// A link of its own to revoke, so the one the other operations use stays; a stranger's or an API key's gets a made-up one.
		id := "00000000-0000-4000-8000-000000000000"
		if c.allowed {
			id = c.e.newShareID(c.t, c.who, c.own().conv)
		}
		return del("/v1/conversations/" + c.own().conv + "/shares/" + id)
	}},
	"getSharedConversation": {own: signedIn, build: func(c *mctx) request { return get("/v1/shared/" + c.shareSecret()) }},
	"getSharedCitedPassage": {own: signedIn, build: func(c *mctx) request {
		return get("/v1/shared/" + c.shareSecret() + "/messages/" + c.own().message + "/sources/1")
	}},
}

// shareSecret is the link to open: the caller's own, or, for a caller without one (anonymous, a key), a well-formed secret that exists nowhere.
func (c *mctx) shareSecret() string {
	if s := c.own().share; s != "" {
		return s
	}
	return strings.Repeat("A", 42) + "A"
}
