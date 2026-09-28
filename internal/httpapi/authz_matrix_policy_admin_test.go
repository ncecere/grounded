package httpapi_test

import "fmt"

// Classification of platform administration (/v1/admin, DESIGN.md §3.4):
// platform admins change things, auditors read, nobody else gets in, and
// API keys never administer the platform.

func init() {
	for id, p := range adminPolicies {
		p.scope = scopeGlobal
		register(id, p)
	}
}

// adminRead is a GET for platform admins and auditors.
func adminRead(path string) policy {
	return policy{own: platform, build: func(*mctx) request { return get(path) }}
}

func migrationAction(action string) policy {
	return policy{own: padmin, also: []string{"409"}, build: func(c *mctx) request {
		p := "/v1/admin/profile-migrations/" + c.e.migration
		return post(p+"/"+action, nil).h(c.rev(p))
	}}
}

var adminPolicies = map[string]policy{
	// Users and teams.
	"adminListUsers": adminRead("/v1/admin/users"),
	"adminGetUser": {own: platform, build: func(c *mctx) request {
		return get("/v1/admin/users/" + c.e.member.me.User.Id.String())
	}},
	"adminUpdateUser": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/users/" + c.e.freshUser(c.t).me.User.Id.String()
		return patch(p, map[string]any{"status": "active"}).h(c.rev(p))
	}},
	"adminListTeams": adminRead("/v1/admin/teams"),
	"adminCreateTeam": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/teams", map[string]any{"slug": fmt.Sprintf("team-%d", c.e.next()), "name": "New team",
			"maxClassification": "open", "ownerEmail": "someone@example.org"})
	}},
	"adminGetTeam": {own: platform, build: func(c *mctx) request { return get("/v1/admin/teams/" + c.e.b.slug) }},
	"adminUpdateTeam": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/teams/" + c.e.b.slug
		return patch(p, map[string]any{"description": upd}).h(c.rev(p))
	}},
	"adminAssignOwner": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/teams/"+c.e.b.slug+"/owners", map[string]any{"email": c.e.freshUser(c.t).me.User.Email})
	}},

	// Limits and classifications.
	"adminGetLimits": adminRead("/v1/admin/limits"),
	"adminUpdateLimits": {own: padmin, build: func(c *mctx) request {
		return put("/v1/admin/limits", map[string]any{"items": []any{}}).h(c.rev("/v1/admin/limits"))
	}},
	"adminGetTeamLimits": {own: platform, build: func(c *mctx) request { return get("/v1/admin/teams/" + c.e.b.slug + "/limits") }},
	"adminUpdateTeamLimits": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/teams/" + c.e.b.slug + "/limits"
		return put(p, map[string]any{"items": []any{}}).h(c.rev(p))
	}},
	"adminCreateClassification": {own: padmin, build: func(c *mctx) request {
		n := c.e.next()
		return post("/v1/admin/classifications", map[string]any{"key": fmt.Sprintf("level_%d", n), "name": fmt.Sprintf("Level %d", n),
			"rank": 100 + n, "maxAudience": "team"})
	}},
	"adminUpdateClassification": {own: padmin, build: func(c *mctx) request {
		return patch("/v1/admin/classifications/open", map[string]any{"description": upd}).h(ifMatch(c.classificationRev("open")))
	}},

	// Audit, key rotation, retention and legal holds.
	"adminListAudit":          adminRead("/v1/admin/audit"),
	"adminGetKeyRotation":     adminRead("/v1/admin/key-rotation"),
	"adminGetRetention":       adminRead("/v1/admin/retention"),
	"adminGetRetentionReport": adminRead("/v1/admin/retention/report"),
	"adminListRetentionRuns":  adminRead("/v1/admin/retention/runs"),
	"adminPutRetention": {own: padmin, build: func(c *mctx) request {
		return put("/v1/admin/retention", map[string]any{"periods": []any{}}).h(c.rev("/v1/admin/retention"))
	}},
	"adminStartRetentionRun": {own: padmin, also: []string{"409"}, build: func(*mctx) request {
		return post("/v1/admin/retention/runs", map[string]any{})
	}},
	"adminListLegalHolds": adminRead("/v1/admin/legal-holds"),
	"adminCreateLegalHold": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/legal-holds", map[string]any{"scopeType": "team", "scope": c.e.b.slug, "reason": "Matrix"})
	}},
	"adminGetLegalHold": {own: platform, build: func(c *mctx) request { return get("/v1/admin/legal-holds/" + c.e.legalHold) }},
	"adminReleaseLegalHold": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/legal-holds/"+c.pickP(c.e.legalHold, c.e.freshLegalHold)+"/release", map[string]any{"reason": "Matrix"})
	}},

	// Connections, models and embedding profiles.
	"adminListConnections": adminRead("/v1/admin/connections"),
	"adminCreateConnection": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/connections", map[string]any{"name": fmt.Sprintf("conn %d", c.e.next()), "baseUrl": c.e.proxy.BaseURL()})
	}},
	"adminGetConnection": {own: platform, build: func(c *mctx) request { return get("/v1/admin/connections/" + c.e.conn.Id.String()) }},
	"adminUpdateConnection": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/connections/" + c.e.conn.Id.String()
		return patch(p, map[string]any{"description": upd}).h(c.rev(p))
	}},
	"adminDeleteConnection": {own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/connections/" + c.pickP(c.e.conn.Id.String(), c.e.freshConnection))
	}},
	"adminTestConnection": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/connections/"+c.e.conn.Id.String()+"/test", nil)
	}},
	"adminListModels": adminRead("/v1/admin/models"),
	"adminCreateModel": {own: padmin, build: func(c *mctx) request {
		n := c.e.next()
		return post("/v1/admin/models", map[string]any{"connectionId": c.e.conn.Id, "key": fmt.Sprintf("m-%d", n), "upstreamModel": fmt.Sprintf("upstream-%d", n),
			"displayName": fmt.Sprintf("M %d", n), "kind": "chat", "maxClassification": "open"})
	}},
	"adminGetModel": {own: platform, build: func(c *mctx) request { return get("/v1/admin/models/" + c.e.chat.Id.String()) }},
	"adminUpdateModel": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/models/" + c.e.chat.Id.String()
		return patch(p, map[string]any{"description": upd}).h(c.rev(p))
	}},
	"adminDeleteModel": {own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/models/" + c.pickP(c.e.chat.Id.String(), c.e.freshModel))
	}},
	"adminTestModel":             {own: padmin, build: func(c *mctx) request { return post("/v1/admin/models/"+c.e.chat.Id.String()+"/test", nil) }},
	"adminGetCatalogUsage":       adminRead("/v1/admin/catalog-usage"),
	"adminListEmbeddingProfiles": adminRead("/v1/admin/embedding-profiles"),
	"adminCreateEmbeddingProfile": {own: padmin, build: func(c *mctx) request {
		n := c.e.next()
		model := field(c.current("/v1/admin/embedding-profiles/"+c.e.profile), "model.id")
		return post("/v1/admin/embedding-profiles", map[string]any{"key": fmt.Sprintf("np-%d", n), "name": fmt.Sprintf("NP %d", n), "modelId": model})
	}},
	"adminGetEmbeddingProfile": {own: platform, build: func(c *mctx) request { return get("/v1/admin/embedding-profiles/" + c.e.profile) }},
	"adminUpdateEmbeddingProfile": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/embedding-profiles/" + c.e.profile
		return patch(p, map[string]any{"description": upd}).h(c.rev(p))
	}},
	"adminDeleteEmbeddingProfile": {own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/embedding-profiles/" + c.pickP(c.e.profile, c.e.freshProfile))
	}},

	// Crawl allowlist, domain requests, overview.
	"adminListCrawlAllowlist": adminRead("/v1/admin/crawl-allowlist"),
	"adminAddCrawlAllowlist": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/crawl-allowlist", map[string]any{"pattern": fmt.Sprintf("a%d.example.net", c.e.next())})
	}},
	"adminRemoveCrawlAllowlist": {own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/crawl-allowlist/" + c.pickP(c.e.allowlist, c.e.freshAllowlist))
	}},
	"adminGetOverview":        adminRead("/v1/admin/overview"),
	"adminGetAttention":       adminRead("/v1/admin/attention"),
	"adminListDomainRequests": adminRead("/v1/admin/domain-requests"),
	"adminReviewDomainRequest": {own: padmin, build: func(c *mctx) request {
		id := c.e.b.domainRequest
		if c.allowed {
			id = c.e.freshDomainRequest(c.t, c.e.b)
		}
		return post("/v1/admin/domain-requests/"+id+"/review", map[string]any{"decision": "deny", "note": "Matrix"})
	}},

	// Agents across the platform, short names, public access, maintenance.
	"adminListAgents": adminRead("/v1/admin/agents"),
	"adminSetAgentStatus": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/agents/"+c.e.b.agent+"/status", map[string]any{"status": "active"})
	}},
	"adminSetAgentShortName": {own: padmin, build: func(c *mctx) request {
		return put("/v1/admin/agents/"+c.e.b.agent+"/short-name", map[string]any{"shortName": "bhelp"})
	}},
	"adminGetPublicAccess": adminRead("/v1/admin/settings/public-access"),
	"adminPutPublicAccess": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/settings/public-access"
		return put(p, map[string]any{"publicAgentsEnabled": true}).h(c.rev(p))
	}},
	"adminGetMaintenance": adminRead("/v1/admin/settings/maintenance"),
	"adminPutMaintenance": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/settings/maintenance"
		return put(p, map[string]any{"enabled": false}).h(c.rev(p))
	}},

	// Access log, analytics, SystemOne and moderation.
	"adminListAccessLog":        adminRead("/v1/admin/access-log"),
	"adminGetAnalytics":         adminRead("/v1/admin/analytics"),
	"adminExportAnalyticsDaily": adminRead("/v1/admin/analytics/daily.csv"),
	"adminListModerationEvents": adminRead("/v1/admin/analytics/moderation-events"),
	"adminGetSystemOne":         adminRead("/v1/admin/systemone"),
	"adminGetModerationPolicy":  adminRead("/v1/admin/moderation/policies/team"),
	"adminPutSystemOne": {own: padmin, build: func(c *mctx) request {
		cur := c.current("/v1/admin/systemone")
		return put("/v1/admin/systemone", map[string]any{"modelId": nil, "judging": cur["judging"]}).h(c.rev("/v1/admin/systemone"))
	}},
	"adminPutModerationPolicy": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/moderation/policies/team"
		return put(p, map[string]any{"modelId": c.e.classifier.Id, "categories": map[string]any{}, "outputMode": "stream_retract",
			"failClosed": false}).h(c.rev(p))
	}},
	"adminTestModeration": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/moderation/test", map[string]any{"modelId": c.e.classifier.Id, "text": "Where is the library?"})
	}},

	// Profile migrations (P2).
	"adminListKnowledgeBases":    adminRead("/v1/admin/knowledge-bases"),
	"adminListProfileMigrations": adminRead("/v1/admin/profile-migrations"),
	"adminGetProfileMigration": {own: platform, build: func(c *mctx) request {
		return get("/v1/admin/profile-migrations/" + c.e.migration)
	}},
	// A read (counts and estimates) sent as POST: auditors may run it.
	"adminPreflightProfileMigration": {own: platform, build: func(c *mctx) request {
		return post("/v1/admin/profile-migrations/preflight", map[string]any{"kbId": c.e.b.kb, "targetProfileId": c.e.targetProfile})
	}},
	"adminStartProfileMigration": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/profile-migrations", map[string]any{"kbId": c.pickP(c.e.migrationKB, c.e.freshMigrationKB),
			"targetProfileId": c.e.targetProfile})
	}},
	// Actions depend on the migration's state: 409 when it has none to act on.
	"adminCancelProfileMigration":     migrationAction("cancel"),
	"adminSwitchBackProfileMigration": migrationAction("switch-back"),
	"adminRetryProfileMigration":      migrationAction("retry"),
	"adminFinishProfileMigration":     migrationAction("finish"),

	// Break-glass administration.
	"adminGetBreakGlassSettings": adminRead("/v1/admin/settings/break-glass"),
	"adminPutBreakGlassSettings": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/settings/break-glass"
		return put(p, map[string]any{"approvalRequired": false, "maxDurationMinutes": 480, "approvalTimeoutMinutes": 60}).h(c.rev(p))
	}},
	"adminListBreakGlassSessions": adminRead("/v1/admin/break-glass"),
	"adminStartBreakGlassSession": {own: padmin, build: func(c *mctx) request {
		if c.allowed {
			c.e.endOpenBreakGlass(c.t) // one open session per admin and team
		}
		return post("/v1/admin/break-glass", map[string]any{"team": c.e.b.slug, "reason": bgReason, "scopes": []string{"documents"}})
	}},
	"adminGetBreakGlassSession": {own: platform, build: func(c *mctx) request { return get("/v1/admin/break-glass/" + c.e.breakGlass) }},
	"adminListBreakGlassReads": {own: platform, build: func(c *mctx) request {
		return get("/v1/admin/break-glass/" + c.e.breakGlass + "/reads")
	}},
	// Approving or denying needs a pending request; a session that is
	// already active (approval is off) is refused with 409.
	// Self-approval is refused (403): the admin who asked can't approve.
	"adminApproveBreakGlassSession": {own: padmin, also: []string{"409", "403 forbidden"}, build: func(c *mctx) request {
		return post("/v1/admin/break-glass/"+c.pickP(c.e.breakGlass, c.e.freshBreakGlass)+"/approve", nil)
	}},
	"adminDenyBreakGlassSession": {own: padmin, also: []string{"409", "403 forbidden"}, build: func(c *mctx) request {
		return post("/v1/admin/break-glass/"+c.pickP(c.e.breakGlass, c.e.freshBreakGlass)+"/deny", map[string]any{"reason": "Matrix"})
	}},
	"adminEndBreakGlassSession": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/break-glass/"+c.pickP(c.e.breakGlass, c.e.freshBreakGlass)+"/end", nil)
	}},
}
