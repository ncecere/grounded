package httpapi_test

import "fmt"

// Classification of platform-shared sources (/v1/admin/shared-sources,
// DESIGN.md §5.4): the team source handlers with the platform as owner.
// Platform admins change them, auditors read them; no team role or key
// reaches them here.

func init() {
	for id, p := range sharedPolicies {
		p.scope = scopeGlobal
		register(id, p)
	}
}

func (c *mctx) shared(suffix string) string {
	return "/v1/admin/shared-sources/" + c.e.sharedSource + suffix
}
func (c *mctx) sharedWeb(suffix string) string {
	return "/v1/admin/shared-sources/" + c.e.sharedWeb + suffix
}

var sharedPolicies = map[string]policy{
	"adminListSharedSources":     adminRead("/v1/admin/shared-sources"),
	"adminListSharedSourceUsage": adminRead("/v1/admin/shared-source-usage"),
	"adminCreateSharedSource": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/shared-sources", map[string]any{"name": fmt.Sprintf("shared %d", c.e.next()), "classification": "open"})
	}},
	"adminGetSharedSource": {own: platform, build: func(c *mctx) request { return get(c.shared("")) }},
	"adminUpdateSharedSource": {own: padmin, build: func(c *mctx) request {
		return patch(c.shared(""), map[string]any{"description": upd}).h(c.rev(c.shared("")))
	}},
	"adminDeleteSharedSource": {own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/shared-sources/" + c.pickP(c.e.sharedSource, c.e.freshSharedSource))
	}},
	"adminListSharedDocuments": {own: platform, build: func(c *mctx) request { return get(c.shared("/documents")) }},
	"adminUploadSharedDocuments": {own: padmin, build: func(c *mctx) request {
		return request{method: "POST", path: c.shared("/documents"), files: []upload{{"matrix.md", []byte("# Matrix\n\nShared.\n")}}}
	}},
	"adminGetSharedDocument": {own: platform, build: func(c *mctx) request { return get(c.shared("/documents/" + c.e.sharedDoc)) }},
	"adminUpdateSharedDocument": {own: padmin, build: func(c *mctx) request {
		return patch(c.shared("/documents/"+c.e.sharedDoc), map[string]any{"tags": []string{"matrix"}})
	}},
	"adminDeleteSharedDocument": {own: padmin, build: func(c *mctx) request {
		return del(c.shared("/documents/" + c.pickP(c.e.sharedDoc, c.e.freshSharedDoc)))
	}},
	"adminListSharedDocumentPassages": {own: platform, build: func(c *mctx) request {
		return get(c.shared("/documents/" + c.e.sharedDoc + "/passages"))
	}},
	"adminListSharedSourceTags": {own: platform, build: func(c *mctx) request { return get(c.shared("/tags")) }},
	"adminRetrySharedDocument": {own: padmin, also: []string{"409"}, build: func(c *mctx) request {
		return post(c.shared("/documents/"+c.e.sharedDoc+"/retry"), nil)
	}},
	"adminRetrySharedDocuments": {own: padmin, build: func(c *mctx) request {
		return post(c.shared("/documents/retry"), map[string]any{"errorCode": "needs_ocr"})
	}},
	"adminRefetchSharedDocument": {own: padmin, also: []string{"409"}, build: func(c *mctx) request {
		return post(c.sharedWeb("/documents/"+c.e.sharedWebDoc+"/refetch"), nil)
	}},
	"adminSyncSharedSource":            {own: padmin, also: []string{"409"}, build: func(c *mctx) request { return post(c.sharedWeb("/sync"), nil) }},
	"adminListSharedBoilerplateBlocks": {own: platform, build: func(c *mctx) request { return get(c.sharedWeb("/boilerplate")) }},
	"adminListSharedCrawls":            {own: platform, build: func(c *mctx) request { return get(c.sharedWeb("/crawls")) }},
	"adminCancelSharedCrawl": {own: padmin, also: []string{"409"}, build: func(c *mctx) request {
		return post(c.sharedWeb("/crawls/"+c.e.sharedCrawl+"/cancel"), nil)
	}},
}
