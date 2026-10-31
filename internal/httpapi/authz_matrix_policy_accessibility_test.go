package httpapi_test

func init() {
	// Public middleware rejects bearer credentials, just like public profiles.
	// Keep this classification aligned with those routes; do not loosen middleware.
	public := policy{own: noBearers, build: func(*mctx) request { return get("/v1/accessibility").anon() }}
	public.scope = scopeGlobal
	register("getAccessibilitySettings", public)
	read := adminRead("/v1/admin/settings/accessibility")
	read.scope = scopeGlobal
	register("adminGetAccessibilitySettings", read)
	register("adminPutAccessibilitySettings", policy{scope: scopeGlobal, own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/settings/accessibility"
		return put(p, map[string]any{"contactUrl": "mailto:help@example.edu", "institutionUrl": "https://example.edu/accessibility"}).h(c.rev(p))
	}})
}
