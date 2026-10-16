package httpapi_test

// Classification of in-app team requests (v0.6.0, E3). Anyone signed in may ask for a team, see their own requests and withdraw one (never
// API keys); platform staff read the review queue, and only platform admins decide.
//
// The platform switch is off in the matrix, so asking is refused for the state of the feature (403 team_requests_off) after it passed
// authorization, and the operations on one request answer 404 for an id that does not exist. Both count as allowed for the callers who may
// make the call; everyone else is refused earlier (401 for keys and anonymous callers, 403 for non-admins). TestTeamRequests* cover what
// the decisions do.

const noRequest = "/v1/team-requests/00000000-0000-4000-8000-000000000000"

func init() {
	for id, p := range map[string]policy{
		"listMyTeamRequests": {own: signedIn, build: func(*mctx) request { return get("/v1/team-requests") }},
		"createTeamRequest": {own: signedIn, also: []string{"403 team_requests_off"}, build: func(c *mctx) request {
			return post("/v1/team-requests", map[string]any{"name": "Matrix team", "purpose": "Matrix", "classification": "open"})
		}},
		"withdrawTeamRequest": {own: signedIn, also: []string{"404 request_not_found"}, build: func(*mctx) request {
			return post(noRequest+"/withdraw", nil)
		}},
		"adminListTeamRequests": adminRead("/v1/admin/team-requests"),
		"adminGetTeamRequest": {own: platform, also: []string{"404 request_not_found"}, build: func(*mctx) request {
			return get("/v1/admin/" + noRequest[len("/v1/"):])
		}},
		"adminApproveTeamRequest": {own: padmin, also: []string{"404 request_not_found"}, build: func(*mctx) request {
			return post("/v1/admin/"+noRequest[len("/v1/"):]+"/approve", map[string]any{"slug": "matrix-team"}).h(ifMatch(1))
		}},
		"adminDeclineTeamRequest": {own: padmin, also: []string{"404 request_not_found"}, build: func(*mctx) request {
			return post("/v1/admin/"+noRequest[len("/v1/"):]+"/decline", map[string]any{"reason": "Matrix"}).h(ifMatch(1))
		}},
		"adminGetTeamRequestSettings": adminRead("/v1/admin/settings/team-requests"),
		"adminPutTeamRequestSettings": {own: padmin, build: func(c *mctx) request {
			p := "/v1/admin/settings/team-requests"
			return put(p, map[string]any{"enabled": false, "maxOpen": 2, "allowedGroup": ""}).h(c.rev(p))
		}},
	} {
		p.scope = scopeGlobal
		register(id, p)
	}
}
