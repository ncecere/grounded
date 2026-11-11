package httpapi_test

// Classification of the source types (docs/source-types.md): every signed-in person reads the list, to add a source;
// only signed-in platform admins turn a type on or off, never an API key, OAuth or a team role. The matrix turns upload
// on, which it already is, so nothing changes. TestSourceTypes covers what the operations do.

func init() {
	register("listSourceTypes", scoped(scopeGlobal, sessionGet("/v1/source-types")))
	register("adminPutSourceType", policy{scope: scopeGlobal, own: padmin, build: func(*mctx) request {
		return put("/v1/admin/source-types/upload", map[string]any{"enabled": true})
	}})
}

func scoped(s scope, p policy) policy {
	p.scope = s
	return p
}
