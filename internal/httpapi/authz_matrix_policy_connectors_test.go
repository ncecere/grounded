package httpapi_test

import "github.com/ncecere/grounded/internal/connector/connectortest"

// Classification of the connector operations (docs/source-types.md): a team's editors, admins and owners change a
// connector source's settings and credentials, test a connection and decide held removals, signed in; a sync is also
// started by an API key with the ingest scope, and syncs are read by members and read keys.
//
// The matrix's source is an upload source, and the test connector type is off, so an allowed caller is refused for the
// state of the feature (400 not_connector_source, 409 source_type_off), which counts as allowed: the caller got past the
// authorization check. TestConnector* cover what the operations do.

func init() {
	const noSync = "00000000-0000-0000-0000-000000000001"
	notConnector := []string{"400 not_connector_source"}
	for id, p := range map[string]policy{
		"checkSourceTypeConnection": {own: editors, also: []string{"409 source_type_off"}, build: func(c *mctx) request {
			return post(c.team("/source-types/"+connectortest.TypeBucket+"/check"), map[string]any{"config": map[string]any{"tenant": "matrix"}})
		}},
		"putSourceConnector": {own: editors, also: notConnector, build: func(c *mctx) request {
			return put(c.src("/connector"), map[string]any{"schedule": "daily"}).h(c.rev(c.src("")))
		}},
		"checkSourceConnection": {own: editors, also: notConnector, build: func(c *mctx) request { return post(c.src("/connector/check"), nil) }},
		"listSourceSyncs":       {own: members.and(readKeys), also: notConnector, build: func(c *mctx) request { return get(c.src("/syncs")) }},
		"startSourceSync":       {own: editors.and(ingestKeys), also: notConnector, build: func(c *mctx) request { return post(c.src("/syncs"), nil) }},
		"cancelSourceSync": {own: editors, also: notConnector, build: func(c *mctx) request {
			return post(c.src("/syncs/"+noSync+"/cancel"), nil)
		}},
		"getSyncRemovals": {own: editors, also: notConnector, build: func(c *mctx) request { return get(c.src("/syncs/" + noSync + "/removals")) }},
		"decideSyncRemovals": {own: editors, also: notConnector, build: func(c *mctx) request {
			return post(c.src("/syncs/"+noSync+"/removals"), map[string]any{"confirm": false})
		}},
	} {
		p.scope = scopeTeam
		register(id, p)
	}
}
