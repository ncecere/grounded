package httpapi_test

func init() {
	for id, path := range map[string]string{
		"adminGetAuditExportSettings": "/v1/admin/audit-export-settings",
		"adminListAuditExports":       "/v1/admin/audit-exports",
		"adminGetAuditExport":         "/v1/admin/audit-exports/00000000-0000-0000-0000-000000000039",
		"adminDownloadAuditExport":    "/v1/admin/audit-exports/00000000-0000-0000-0000-000000000039/download",
	} {
		register(id, policy{scope: scopeGlobal, own: platform, also: []string{"404"}, build: func(*mctx) request { return get(path) }})
	}
	register("adminPutAuditExportSettings", policy{scope: scopeGlobal, own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/audit-export-settings"
		return put(p, map[string]any{"enabled": false, "coverageStart": "2026-01-01", "destination": "builtin"}).h(c.rev(p))
	}})
	register("adminRequestAuditExport", policy{scope: scopeGlobal, own: padmin, also: []string{"409 exports_off", "404"}, build: func(c *mctx) request {
		return post("/v1/admin/audit-exports", map[string]any{"day": "2026-01-01"}).h(c.rev("/v1/admin/audit-export-settings"))
	}})
	register("adminRetryAuditExport", policy{scope: scopeGlobal, own: padmin, also: []string{"409 exports_off", "404"}, build: func(*mctx) request {
		return post("/v1/admin/audit-exports/00000000-0000-0000-0000-000000000039/retry", nil).h(ifMatch(1))
	}})
}
