package httpapi_test

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// guideMarkdown is a document of n sections, one passage each (chunker version 1 cuts at every heading).
func guideMarkdown(title string, n int, change int) string {
	var b strings.Builder
	b.WriteString("# " + title + "\n\n")
	for i := range n {
		body := fmt.Sprintf("Section %d explains topic%d with its own words: alpha%d beta%d gamma%d.", i, i, i, i, i)
		if i == change {
			body += "!" // one byte
		}
		fmt.Fprintf(&b, "## Part %d\n\n%s\n\n", i, body)
	}
	return b.String()
}

// documentChunks are a document's passages in order: ID and content.
func documentChunks(t *testing.T, env *ragEnv, doc uuid.UUID) ([]uuid.UUID, []string) {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT id, content FROM chunks WHERE document_id = $1 ORDER BY ordinal`, doc)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []uuid.UUID
	var contents []string
	for rows.Next() {
		var id uuid.UUID
		var c string
		if err := rows.Scan(&id, &c); err != nil {
			t.Fatal(err)
		}
		ids, contents = append(ids, id), append(contents, c)
	}
	return ids, contents
}

// vectorCount is the number of a document's vectors in its source's profile table.
func vectorCount(t *testing.T, env *ragEnv, src, doc uuid.UUID) int {
	t.Helper()
	var prof uuid.UUID
	if err := env.app.Pool.QueryRow(context.Background(), `SELECT embedding_profile_id FROM data_sources WHERE id = $1`, src).Scan(&prof); err != nil {
		t.Fatal(err)
	}
	table := "emb_" + strings.ReplaceAll(prof.String(), "-", "")
	var n int
	if err := env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM `+table+` v JOIN chunks c ON c.id = v.chunk_id WHERE c.document_id = $1`, doc).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A new version of a document embeds only the passages whose embedded input changed: the others keep their rows (so
// their IDs and citations), their vectors and their search results (#250). A changed title changes every passage's input,
// so it embeds them all. The document is large enough that its rows are written in several statements.
func TestChangedDocumentEmbedsOnlyChangedPassages(t *testing.T) {
	env := newRAGEnv(t)
	owner, base := env.owner, "/v1/teams/"+env.team
	var src apitypes.DataSource
	code, e := owner.call("POST", base+"/sources", map[string]any{"name": "Guides", "classification": "open"}, &src, nil)
	mustCode(t, "create source", code, e, 201, "")
	docs := base + "/sources/" + src.Id.String() + "/documents"
	const sections = 1100 // more than one insert batch (500)

	code, results, e := owner.uploadFiles(docs, []upload{{"guide.md", []byte(guideMarkdown("Guide", sections, -1))}}, "")
	if code != 200 || len(results) != 1 {
		t.Fatalf("upload = %d %s %+v", code, e, results)
	}
	doc := results[0].Document.Id
	if d := byName(owner.waitForDocuments(t, docs))["guide.md"]; d.Status != "ready" || d.ChunkCount < sections {
		t.Fatalf("first version = %+v", d)
	}
	ids1, contents1 := documentChunks(t, env, doc)
	n := len(ids1)
	changed := slices.IndexFunc(contents1, func(c string) bool { return strings.Contains(c, "topic600 ") })
	if len(env.proxy.EmbedInputs()) != n || vectorCount(t, env, src.Id, doc) != n || changed < 0 {
		t.Fatalf("first version embedded %d inputs, %d vectors, %d rows", len(env.proxy.EmbedInputs()), vectorCount(t, env, src.Id, doc), n)
	}

	var kb apitypes.KnowledgeBase
	code, e = owner.call("POST", base+"/kbs", map[string]any{"name": "Guides", "topK": 5}, &kb, nil)
	mustCode(t, "create kb", code, e, 201, "")
	code, e = owner.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, &kb, nil)
	mustCode(t, "attach", code, e, 200, "")
	// The fake proxy's hashed vectors are a weak retriever: keyword search leads.
	code, e = owner.call("PATCH", base+"/kbs/"+kb.Id.String(), map[string]any{"fusionWeights": map[string]any{"vector": 0.2, "keyword": 1}}, &kb, ifMatch(kb.Revision))
	mustCode(t, "weights", code, e, 200, "")
	retrieve := func(q string) []string {
		t.Helper()
		var res apitypes.RetrieveResult
		code, e := owner.call("POST", base+"/kbs/"+kb.Id.String()+"/retrieve", map[string]any{"query": q}, &res, nil)
		mustCode(t, "retrieve", code, e, 200, "")
		var out []string
		for _, h := range res.Hits {
			out = append(out, h.ChunkId.String()+" "+h.Content)
		}
		return out
	}
	before := retrieve("topic17 alpha17 beta17")
	if !slices.ContainsFunc(before, func(h string) bool { return strings.Contains(h, "topic17 ") }) {
		t.Fatalf("hits before = %v", before)
	}

	// One byte changes in one section.
	env.proxy.ResetEmbedInputs()
	start := time.Now()
	code, results, _ = owner.uploadFiles(docs, []upload{{"guide.md", []byte(guideMarkdown("Guide", sections, 600))}}, "")
	if code != 200 || results[0].Status != "replaced" {
		t.Fatalf("replace = %d %+v", code, results)
	}
	if d := byName(owner.waitForDocuments(t, docs))["guide.md"]; d.Status != "ready" || int(d.ChunkCount) != n || d.Version != 2 {
		t.Fatalf("second version = %+v", d)
	}
	inputs := env.proxy.EmbedInputs()
	t.Logf("a one-byte change in a document of %d passages: %d embedding inputs (before #250: %d), %v", n, len(inputs), n, time.Since(start))
	if len(inputs) != 1 || !strings.Contains(inputs[0], "topic600") || !strings.Contains(inputs[0], "Guide") {
		t.Fatalf("embedded after a one-byte change: %d inputs %.200q", len(inputs), inputs)
	}
	ids2, contents2 := documentChunks(t, env, doc)
	if len(ids2) != n || vectorCount(t, env, src.Id, doc) != n {
		t.Fatalf("%d passages, %d vectors", len(ids2), vectorCount(t, env, src.Id, doc))
	}
	for i := range ids2 {
		if (ids2[i] == ids1[i]) != (i != changed) {
			t.Fatalf("passage %d: kept %v", i, ids2[i] == ids1[i])
		}
	}
	if !strings.Contains(contents2[changed], "gamma600.!") {
		t.Errorf("changed passage = %q", contents2[changed])
	}
	if after := retrieve("topic17 alpha17 beta17"); !slices.Equal(after, before) {
		t.Errorf("hits changed:\n%v\n%v", before, after)
	}
	if hits := retrieve("topic600 alpha600 beta600"); !slices.ContainsFunc(hits, func(h string) bool { return strings.HasPrefix(h, ids2[changed].String()) }) {
		t.Errorf("the changed passage is not found: %v", hits)
	}
	var embedded int
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT (metadata->>'embeddedChunks')::int FROM usage_events
		WHERE kind = 'embed_tokens' AND document_id = $1 ORDER BY occurred_at DESC LIMIT 1`, doc).Scan(&embedded)
	if embedded != 1 {
		t.Errorf("usage embeddedChunks = %d", embedded)
	}

	// A new title is in every passage's input: all are embedded again.
	env.proxy.ResetEmbedInputs()
	owner.uploadFiles(docs, []upload{{"guide.md", []byte(guideMarkdown("Handbook", sections, 600))}}, "")
	if d := byName(owner.waitForDocuments(t, docs))["guide.md"]; d.Status != "ready" || d.Title != "Handbook" {
		t.Fatalf("third version = %+v", d)
	}
	if got := len(env.proxy.EmbedInputs()); got != n {
		t.Errorf("a new title embedded %d inputs, want %d", got, n)
	}
	ids3, _ := documentChunks(t, env, doc)
	if len(ids3) != n || ids3[0] == ids2[0] {
		t.Errorf("passages after a new title: %d, first kept %v", len(ids3), ids3[0] == ids2[0])
	}
}

// A retry after the embedding model failed starts from chunking: the original is not parsed again and its scanned
// pages are not read or counted with OCR again (#250).
func TestRetryReusesTheParse(t *testing.T) {
	env, sidecar := ocrEnv(t)
	owner, base := env.owner, "/v1/teams/"+env.team
	putParsing(t, env.admin, map[string]any{"ocrEnabled": true, "backend": "tesseract", "visionModelId": nil, "languages": "eng"})
	src := createOCRSource(t, owner, env.team, "Scans", "open", nil)
	docs := base + "/sources/" + src.Id.String() + "/documents"

	env.proxy.FailWith(http.StatusUnauthorized) // a permanent failure, after parsing
	start := time.Now()
	d := uploadOCR(t, owner, docs, "scan.pdf", scanned(t, "PAGE ONE", "PAGE TWO", "PAGE THREE"))
	failed := waitDoc(t, owner, docs, d.Id, "failed", func(d apitypes.Document) bool { return d.Status == "failed" })
	first := time.Since(start)
	if failed.ErrorCode != "model_auth" || sidecar.Calls() != 3 {
		t.Fatalf("first attempt = %+v, OCR calls %d", failed, sidecar.Calls())
	}
	env.proxy.FailWith(0)
	start = time.Now()
	code, e := owner.call("POST", docs+"/"+d.Id.String()+"/retry", nil, nil, nil)
	mustCode(t, "retry", code, e, 200, "")
	ready := waitDoc(t, owner, docs, d.Id, "ready", func(d apitypes.Document) bool { return d.Status == "ready" })
	t.Logf("first attempt (read, parse, OCR of 3 pages) %v; retry %v", first, time.Since(start))
	if sidecar.Calls() != 3 {
		t.Errorf("the retry read %d pages with OCR again", sidecar.Calls()-3)
	}
	if pages, _ := ledger(t, env.app, "ocr_pages"); pages != 3 {
		t.Errorf("ocr_pages = %d, want 3 (counted once)", pages)
	}
	if ready.Pages != 3 || ready.Ocr == nil || !slices.Equal(ready.Ocr.Pages, []int32{1, 2, 3}) || ready.Kind != "pdf" {
		t.Errorf("after the retry = %+v", ready)
	}
	if text := passagesOf(t, owner, docs, ready); !strings.Contains(text, "Scanned text read by OCR") {
		t.Errorf("passages = %s", text)
	}
	var parser string
	_ = env.app.Pool.QueryRow(context.Background(), "SELECT parser FROM documents WHERE id = $1", d.Id).Scan(&parser)
	if parser != "builtin:pdf+ocr:tesseract" {
		t.Errorf("parser = %q", parser)
	}
}

// A boilerplate refresh re-chunks several documents at once, so their new passages share embedding requests (#250).
// The time is logged; the test checks the outcome.
func TestBoilerplateRefreshRechunksDocumentsTogether(t *testing.T) {
	env := newRAGEnv(t)
	owner, base := env.owner, "/v1/teams/"+env.team
	var src apitypes.DataSource
	code, e := owner.call("POST", base+"/sources", map[string]any{"name": "Handbooks", "classification": "open"}, &src, nil)
	mustCode(t, "create upload source", code, e, 201, "")
	srcPath := base + "/sources/" + src.Id.String()
	const pages = 40
	var files []upload
	for i := range pages {
		files = append(files, upload{fmt.Sprintf("page-%02d.md", i), []byte(fmt.Sprintf(
			"# Page %d\n\nThis page covers %s in its own words.\n\nOffice of the Test Registrar, 101 Main Hall. KiwiSignoff for every handbook page.\n",
			i, strings.Repeat(string(rune('a'+i%26)), 3+i/26)))})
	}
	if code, _, e := owner.uploadFiles(srcPath+"/documents", files, ""); code != 200 {
		t.Fatalf("upload = %d %s", code, e)
	}
	owner.waitForDocuments(t, srcPath+"/documents")
	env.proxy.SetEmbedLatency(200 * time.Millisecond) // a gateway's round trip
	requests := len(env.proxy.EmbedBatches())
	var cur apitypes.DataSource
	owner.get(srcPath, &cur)
	start := time.Now()
	code, e = owner.call("PATCH", srcPath, map[string]any{"boilerplate": map[string]any{"enabled": true}}, &cur, ifMatch(cur.Revision))
	mustCode(t, "enable", code, e, 200, "")
	bp := waitBoilerplate(t, owner, srcPath, func(b apitypes.SourceBoilerplate) bool { return b.PagesAffected == pages-1 })
	t.Logf("re-chunked %d documents in %v, %d embedding requests", bp.PagesAffected, time.Since(start), len(env.proxy.EmbedBatches())-requests)
	if got := chunksContaining(t, env, src.Id, "KiwiSignoff"); len(got) != 1 {
		t.Fatalf("one copy stays: %v", got)
	}
}
