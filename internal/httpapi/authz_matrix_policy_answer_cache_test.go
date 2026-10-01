package httpapi_test

// Classification of the answer cache (docs/answer-cache.md): an agent's
// settings and Clear cache are for the team's editors, admins and owners
// (sessions only, like agent editing); the platform switch is on admin
// settings.

func init() {
	register("getAgentAnswerCache", policy{scope: scopeTeam, own: editors, build: func(c *mctx) request {
		return get(c.ag("/answer-cache"))
	}})
	register("updateAgentAnswerCache", policy{scope: scopeTeam, own: editors, build: func(c *mctx) request {
		p := c.ag("/answer-cache")
		return put(p, map[string]any{"enabled": true, "nearIdentical": false, "expiryHours": 24}).h(c.rev(p))
	}})
	register("clearAgentAnswerCache", policy{scope: scopeTeam, own: editors, build: func(c *mctx) request {
		return post(c.ag("/answer-cache/clear"), nil)
	}})
	register("adminGetAnswerCacheSettings", policy{scope: scopeGlobal, own: platform, build: func(*mctx) request {
		return get("/v1/admin/settings/answer-cache")
	}})
	register("adminPutAnswerCacheSettings", policy{scope: scopeGlobal, own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/settings/answer-cache"
		return put(p, map[string]any{"enabled": true}).h(c.rev(p))
	}})
}
