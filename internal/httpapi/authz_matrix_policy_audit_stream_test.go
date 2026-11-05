package httpapi_test

import "strconv"

// Classification of audit streaming (docs/specs/audit-streaming/DESIGN.md): signed-in platform admins change it, platform staff
// read it, never an API key, OAuth or a team role. The platform switch is off in the matrix and no destination exists, so a
// change is refused for the state of the feature (409 streaming_off) or answers 404 for an id that does not exist after it
// passed authorization; both count as allowed for platform admins. TestAuditStream* cover what the operations do.

const noDestination = "00000000-0000-4000-8000-000000000000"

func init() {
	body := map[string]any{"name": "SIEM", "kind": "https", "format": "ndjson", "address": "https://siem.example.edu/ingest", "caPem": ""}
	one := "/v1/admin/audit-stream/destinations/" + noDestination
	gone := []string{"404 not_found"}
	for id, p := range map[string]policy{
		"adminGetAuditStream": adminRead("/v1/admin/audit-stream"),
		"adminPutAuditStreamSettings": {own: padmin, build: func(c *mctx) request {
			rev, _ := strconv.ParseInt(field(c.current("/v1/admin/audit-stream"), "settings.revision"), 10, 64)
			return put("/v1/admin/audit-stream/settings", map[string]any{"enabled": false}).h(ifMatch(rev))
		}},
		"adminCreateAuditStreamDestination": {own: padmin, also: []string{"409 streaming_off"}, build: func(*mctx) request {
			return post("/v1/admin/audit-stream/destinations", body)
		}},
		"adminPutAuditStreamDestination":    {own: padmin, also: gone, build: func(*mctx) request { return put(one, body).h(ifMatch(1)) }},
		"adminDeleteAuditStreamDestination": {own: padmin, also: gone, build: func(*mctx) request { return del(one).h(ifMatch(1)) }},
		"adminSetAuditStreamDestinationEnabled": {own: padmin, also: gone, build: func(*mctx) request {
			return put(one+"/enabled", map[string]any{"enabled": false}).h(ifMatch(1))
		}},
		"adminTestAuditStreamDestination": {own: padmin, also: gone, build: func(*mctx) request { return post(one+"/test", nil) }},
	} {
		p.scope = scopeGlobal
		register(id, p)
	}
}
