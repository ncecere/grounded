package httpapi_test

import (
	"net/url"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// ?q= matches the title, URL or file name, case-insensitively, and treats
// LIKE wildcards literally.
func TestDocumentSearch(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team
	var src apitypes.DataSource
	owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	docs := base + "/sources/" + src.Id.String() + "/documents"
	code, _, e := owner.uploadFiles(docs, []upload{
		{"Parking-Permits.md", []byte("# Parking\n\nPermits.")},
		{"housing.txt", []byte("Housing.")},
		{"100%_refund.txt", []byte("Refunds.")},
	}, "")
	mustCode(t, "upload", code, e, 200, "")

	names := func(q url.Values) []string {
		t.Helper()
		var page apitypes.DocumentPage
		if code := owner.get(docs+"?"+q.Encode(), &page); code != 200 {
			t.Fatalf("list %s = %d", q.Encode(), code)
		}
		out := []string{}
		for _, d := range page.Items {
			out = append(out, d.Filename)
		}
		return out
	}
	for q, want := range map[string]string{
		"parking": "Parking-Permits.md", "HOUSING": "housing.txt", "100%": "100%_refund.txt", "%_": "100%_refund.txt", "": "",
	} {
		got := names(url.Values{"q": {q}})
		if q == "" {
			if len(got) != 3 {
				t.Errorf("no search = %v", got)
			}
			continue
		}
		if len(got) != 1 || got[0] != want {
			t.Errorf("q=%q = %v, want %s", q, got, want)
		}
	}
	if got := names(url.Values{"q": {"s%g"}}); len(got) != 0 {
		t.Errorf("wildcard matched %v", got)
	}
	if got := names(url.Values{"q": {"txt"}, "limit": {"1"}}); len(got) != 1 {
		t.Errorf("paged search = %v", got)
	}
	if got := names(url.Values{"q": {"parking"}, "status": {"failed"}}); len(got) != 0 {
		t.Errorf("search + status = %v", got)
	}
	code, e = owner.call("GET", docs+"?q="+strings.Repeat("x", 201), nil, nil, nil)
	mustCode(t, "long search", code, e, 400, "invalid_search")
}

// ?kind= and ?tag= narrow the documents list, /tags lists a source's tags,
// and /passages returns a document's first passages in order.
func TestDocumentFiltersTagsAndPassages(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team
	var src apitypes.DataSource
	owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	srcPath := base + "/sources/" + src.Id.String()
	docs := srcPath + "/documents"
	code, _, e := owner.uploadFilesWithTags(docs, []upload{{"guide.md", []byte("# Guide\n\nFirst part.\n\n## More\n\nSecond part.")}}, "Handbook, qa")
	mustCode(t, "upload tagged", code, e, 200, "")
	code, _, e = owner.uploadFiles(docs, []upload{{"notes.txt", []byte("Plain notes.")}}, "")
	mustCode(t, "upload plain", code, e, 200, "")
	ready := byName(owner.waitForDocuments(t, docs))

	names := func(q url.Values) []string {
		t.Helper()
		var page apitypes.DocumentPage
		if code := owner.get(docs+"?"+q.Encode(), &page); code != 200 {
			t.Fatalf("list %s = %d", q.Encode(), code)
		}
		out := []string{}
		for _, d := range page.Items {
			out = append(out, d.Filename)
		}
		return out
	}
	for q, want := range map[string]string{"kind=markdown": "guide.md", "kind=text": "notes.txt", "tag=HANDBOOK": "guide.md", "tag=qa&q=guide": "guide.md"} {
		v, _ := url.ParseQuery(q)
		if got := names(v); len(got) != 1 || got[0] != want {
			t.Errorf("%s = %v, want %s", q, got, want)
		}
	}
	if got := names(url.Values{"tag": {"handbook"}, "kind": {"text"}}); len(got) != 0 {
		t.Errorf("tag + kind = %v", got)
	}
	code, e = owner.call("GET", docs+"?kind=exe", nil, nil, nil)
	mustCode(t, "bad kind", code, e, 400, "invalid_kind")

	var tagList []string
	if code := owner.get(srcPath+"/tags", &tagList); code != 200 || strings.Join(tagList, ",") != "handbook,qa" {
		t.Errorf("tags = %d %v", code, tagList)
	}

	guide := ready["guide.md"]
	var passages apitypes.DocumentPassagePage
	if code := owner.get(docs+"/"+guide.Id.String()+"/passages?limit=1", &passages); code != 200 {
		t.Fatalf("passages = %d", code)
	}
	if passages.Total != guide.ChunkCount || passages.Total < 1 || len(passages.Items) != 1 || passages.Items[0].Ordinal != 0 {
		t.Errorf("passages = %+v (chunks %d)", passages, guide.ChunkCount)
	}
	if !strings.Contains(passages.Items[0].Content, "First part") {
		t.Errorf("first passage = %q", passages.Items[0].Content)
	}
	code, e = owner.call("GET", docs+"/"+guide.Id.String()+"/passages?limit=101", nil, nil, nil)
	mustCode(t, "passages limit", code, e, 400, "invalid_limit")
	code, e = owner.call("GET", docs+"/"+src.Id.String()+"/passages", nil, nil, nil)
	mustCode(t, "unknown document", code, e, 404, "")
}
