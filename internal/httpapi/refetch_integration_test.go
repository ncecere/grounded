package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// TestRefetchDocument: re-fetching one page (docs/ui-review W3) runs a crawl
// of just that URL. It updates the page, follows no links, removes no other
// page and leaves the source's last sync alone.
func TestRefetchDocument(t *testing.T) {
	env := newWebEnv(t, true)
	owner, site := env.owner, env.site
	src := env.createWeb(t, owner, env.base+"/sources", "Registrar site", map[string]any{
		"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 1,
	})
	srcPath := env.base + "/sources/" + src.Id.String()
	if first := waitCrawl(t, owner, srcPath, src.ActiveCrawl.Id); first.Status != "completed" {
		t.Fatalf("first crawl = %+v", first)
	}
	docs := byURL(owner.waitForDocuments(t, srcPath+"/documents"))
	about, ok := docs[site.url("/about")]
	if !ok {
		t.Fatalf("no /about document: %v", docs)
	}
	var before apitypes.DataSource
	owner.get(srcPath, &before)
	homeHits, _ := site.count("/")

	// The page changed, another one is gone: only the re-fetched page moves.
	site.set("/about", htmlPage("About | Test Registrar", `<h1>About the office</h1>
<p>The office now opens on Saturday mornings for commencement ticket pickup.</p>`))
	site.remove("/admissions/")
	var run apitypes.Crawl
	code, e := owner.call("POST", srcPath+"/documents/"+about.Id.String()+"/refetch", nil, &run, nil)
	mustCode(t, "refetch", code, e, 202, "")
	if run.Trigger != "page" {
		t.Fatalf("trigger = %s", run.Trigger)
	}
	run = waitCrawl(t, owner, srcPath, run.Id)
	if run.Status != "completed" || run.PagesFetched != 1 || run.PagesChanged != 1 || run.DocumentsDeleted != 0 {
		t.Fatalf("page run = %+v", run)
	}
	if hits, _ := site.count("/"); hits != homeHits {
		t.Errorf("the home page was fetched again (%d → %d hits)", homeHits, hits)
	}
	docs = byURL(owner.waitForDocuments(t, srcPath+"/documents"))
	if d := docs[site.url("/about")]; d.Version != 2 {
		t.Errorf("re-fetched page = %+v", d)
	}
	if _, ok := docs[site.url("/admissions/")]; !ok {
		t.Error("a page re-fetch removed another page")
	}
	var after apitypes.DataSource
	owner.get(srcPath, &after)
	if before.LastSyncAt == nil || after.LastSyncAt == nil || !after.LastSyncAt.Equal(*before.LastSyncAt) {
		t.Errorf("last sync moved: %v → %v", before.LastSyncAt, after.LastSyncAt)
	}
	if n := auditCount(t, env.app, "document.refetch"); n != 1 {
		t.Errorf("document.refetch audited %d times", n)
	}

	// Uploaded documents can't be re-fetched.
	var up apitypes.DataSource
	code, e = owner.call("POST", env.base+"/sources", map[string]any{"name": "Uploads", "type": "upload", "classification": "open"}, &up, nil)
	mustCode(t, "create upload source", code, e, 201, "")
	upPath := env.base + "/sources/" + up.Id.String()
	if code, _, e := owner.uploadFiles(upPath+"/documents", []upload{{"notes.md", []byte("# Notes\n\nSome notes about registration.")}}, ""); code != 200 {
		t.Fatalf("upload = %d %s", code, e)
	}
	upDocs := owner.waitForDocuments(t, upPath+"/documents")
	code, e = owner.call("POST", upPath+"/documents/"+upDocs[0].Id.String()+"/refetch", nil, nil, nil)
	mustCode(t, "refetch an upload", code, e, 400, "not_web_document")
}
