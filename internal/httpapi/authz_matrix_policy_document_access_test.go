package httpapi_test

import "strconv"

// Classification of document permissions (docs/document-permissions.md). The switch: signed-in platform admins change it,
// platform staff read it, never an API key, OAuth or a team role. A source's restriction and the group names: the team's
// editors, admins and owners signed in (not API keys). The switch is off in the matrix, so restricting a source is refused
// for the state of the feature (409 document_permissions_off), which counts as allowed. TestDocumentAccess* cover what the
// operations do.

func init() {
	global := map[string]policy{
		"adminGetDocumentAccess": adminRead("/v1/admin/document-access"),
		"adminPutDocumentAccess": {own: padmin, build: func(c *mctx) request {
			rev, _ := strconv.ParseInt(field(c.current("/v1/admin/document-access"), "revision"), 10, 64)
			return put("/v1/admin/document-access", map[string]any{"enabled": false}).h(ifMatch(rev))
		}},
	}
	for id, p := range global {
		p.scope = scopeGlobal
		register(id, p)
	}
	register("putSourceAccess", policy{scope: scopeTeam, own: editors, also: []string{"409 document_permissions_off"}, build: func(c *mctx) request {
		return put(c.src("/access"), map[string]any{"principals": []string{"group:matrix"}}).h(c.rev(c.src("")))
	}})
	register("listKnownGroups", policy{scope: scopeTeam, own: editors, build: func(c *mctx) request { return get(c.team("/access/groups")) }})
}
