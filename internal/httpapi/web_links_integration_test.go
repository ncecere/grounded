package httpapi_test

import (
	"context"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// resync runs a manual sync of a web source and waits for it.
func resync(t *testing.T, env *webEnv, srcPath string) apitypes.Crawl {
	t.Helper()
	var run apitypes.Crawl
	code, e := env.owner.call("POST", srcPath+"/sync", nil, &run, nil)
	mustCode(t, "sync", code, e, 202, "")
	return waitCrawl(t, env.owner, srcPath, run.Id)
}

// An unchanged page's links are followed from the links kept with it, without reading the page back from object
// storage: with every stored page gone from storage, a re-sync still sees every page and deletes none (#250). A page
// stored without kept links (before migration 00074) is read back once and gets them.
func TestUnchangedPagesFollowKeptLinks(t *testing.T) {
	env := newWebEnv(t, true)
	owner, site := env.owner, env.site
	src := env.createWeb(t, owner, env.base+"/sources", "Registrar site", map[string]any{
		"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 2, "useSitemaps": false,
	})
	srcPath := env.base + "/sources/" + src.Id.String()
	first := waitCrawl(t, owner, srcPath, src.ActiveCrawl.Id)
	if first.Status != "completed" || first.PagesChanged == 0 {
		t.Fatalf("first crawl = %+v", first)
	}
	owner.waitForDocuments(t, srcPath+"/documents")
	ctx := context.Background()
	kept := func() (pages, withLinks int) {
		t.Helper()
		if err := env.app.Pool.QueryRow(ctx, `SELECT count(*), count(l.document_id) FROM documents d
			LEFT JOIN web_page_links l ON l.document_id = d.id AND l.sha256 = d.sha256
			WHERE d.source_id = $1 AND d.content_type = 'text/html'`, src.Id).Scan(&pages, &withLinks); err != nil {
			t.Fatal(err)
		}
		return pages, withLinks
	}
	if pages, withLinks := kept(); pages < 4 || withLinks != pages {
		t.Fatalf("%d pages, %d with their links kept", pages, withLinks)
	}
	var docsBefore int
	_ = env.app.Pool.QueryRow(ctx, `SELECT count(*) FROM documents WHERE source_id = $1`, src.Id).Scan(&docsBefore)

	// Pages stored before their links were kept are read back once, and keep them from then on.
	if _, err := env.app.Pool.Exec(ctx, `DELETE FROM web_page_links`); err != nil {
		t.Fatal(err)
	}
	resync(t, env, srcPath)
	// (A page at the crawl's depth limit has no links to follow, so it is not read back.)
	if pages, withLinks := kept(); withLinks < 4 || withLinks > pages {
		t.Fatalf("after reading the pages back: %d pages, %d with their links kept", pages, withLinks)
	}

	// The stored pages go from storage: their kept links still lead to every page.
	rows, err := env.app.Pool.Query(ctx, `SELECT blob_key FROM documents WHERE source_id = $1 AND content_type = 'text/html'`, src.Id)
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		keys = append(keys, k)
	}
	rows.Close()
	for _, k := range keys {
		if err := env.app.Svc.Blob.Delete(ctx, k); err != nil {
			t.Fatal(err)
		}
	}
	again := resync(t, env, srcPath)
	var docsAfter int
	_ = env.app.Pool.QueryRow(ctx, `SELECT count(*) FROM documents WHERE source_id = $1`, src.Id).Scan(&docsAfter)
	if again.DocumentsDeleted != 0 || docsAfter != docsBefore || again.PagesUnchanged < 4 {
		t.Fatalf("re-sync without the stored pages = %+v; documents %d, before %d", again, docsAfter, docsBefore)
	}
}
