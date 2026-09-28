package httpapi_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A rate-limited gateway is backpressure, not failure: 429s and 503s with
// Retry-After snooze the document's job without using its attempts, and
// every document is indexed.
func TestIngestBackpressure(t *testing.T) {
	env := newRAGEnv(t)
	base := "/v1/teams/" + env.team

	// The connection's request limit is part of the admin API.
	var conns []apitypes.Connection
	env.admin.get("/v1/admin/connections", &conns)
	if len(conns) != 1 || conns[0].RequestsPerMinute != nil {
		t.Fatalf("connections = %+v", conns)
	}
	conn := conns[0]
	path := "/v1/admin/connections/" + conn.Id.String()
	code, e := env.admin.call("PATCH", path, map[string]any{"requestsPerMinute": -1}, nil, ifMatch(conn.Revision))
	mustCode(t, "negative limit", code, e, 400, "invalid_requests_per_minute")
	code, e = env.admin.call("PATCH", path, map[string]any{"requestsPerMinute": 6000}, &conn, ifMatch(conn.Revision))
	mustCode(t, "set limit", code, e, 200, "")
	if conn.RequestsPerMinute == nil || *conn.RequestsPerMinute != 6000 {
		t.Fatalf("requestsPerMinute = %v", conn.RequestsPerMinute)
	}
	code, e = env.admin.call("PATCH", path, map[string]any{"name": "Proxy (renamed)"}, &conn, ifMatch(conn.Revision))
	mustCode(t, "rename", code, e, 200, "")
	if conn.RequestsPerMinute == nil {
		t.Fatal("an unrelated update removed the limit")
	}

	var src apitypes.DataSource
	code, e = env.owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	mustCode(t, "source", code, e, 201, "")
	docs := base + "/sources/" + src.Id.String() + "/documents"

	// The gateway refuses the first three requests with 429 and Retry-After.
	// Counted as failures, they would use up attempts (MaxAttempts is 5).
	env.proxy.RejectEmbeddings(3, 429, "1")
	files := make([]upload, 6)
	for i := range files {
		files[i] = upload{fmt.Sprintf("doc%d.txt", i), []byte(fmt.Sprintf("Document %d is about topic number %d.", i, i))}
	}
	if code, _, e := env.owner.uploadFiles(docs, files, ""); code != 200 {
		t.Fatalf("upload = %d %s", code, e)
	}
	ready := env.owner.waitForDocuments(t, docs)
	for _, d := range ready {
		if d.Status != "ready" {
			t.Fatalf("%s = %+v", d.Filename, d)
		}
	}
	if n := env.proxy.EmbedRejected(); n != 3 {
		t.Errorf("rejected requests = %d, want 3", n)
	}
	// Snoozes do not count as attempts.
	var maxAttempts int
	if err := env.app.Pool.QueryRow(context.Background(), "SELECT max(attempts) FROM documents WHERE source_id = $1", src.Id).Scan(&maxAttempts); err != nil {
		t.Fatal(err)
	}
	if maxAttempts != 1 {
		t.Errorf("max document attempts = %d, want 1", maxAttempts)
	}
	var riverAttempts int
	if err := env.app.Pool.QueryRow(context.Background(), "SELECT coalesce(max(attempt), 0) FROM river_job WHERE kind = 'ingest.document'").Scan(&riverAttempts); err != nil {
		t.Fatal(err)
	}
	if riverAttempts > 1 {
		t.Errorf("max River attempt = %d, want 1", riverAttempts)
	}

	// 503 with Retry-After is backpressure too.
	env.proxy.RejectEmbeddings(2, 503, "1")
	if code, _, e := env.owner.uploadFiles(docs, []upload{{"late.txt", []byte("A late document about the drop/add deadline.")}}, ""); code != 200 {
		t.Fatalf("upload = %d %s", code, e)
	}
	for _, d := range env.owner.waitForDocuments(t, docs) {
		if d.Status != "ready" {
			t.Fatalf("%s = %+v", d.Filename, d)
		}
	}

	// Queries: a 429 with a long Retry-After answers 503 (with Retry-After),
	// and blocks the connection, so the next query does not reach the proxy.
	var kb apitypes.KnowledgeBase
	code, e = env.owner.call("POST", base+"/kbs", map[string]any{"name": "KB"}, &kb, nil)
	mustCode(t, "kb", code, e, 201, "")
	env.owner.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	retrieve := func() (int, string) {
		return env.owner.call("POST", base+"/kbs/"+kb.Id.String()+"/retrieve", map[string]any{"query": "drop/add deadline"}, nil, nil)
	}
	code, e = retrieve()
	mustCode(t, "retrieve", code, e, 200, "")
	env.proxy.RejectEmbeddings(1, 429, "30")
	code, e = retrieve()
	mustCode(t, "retrieve, gateway 429", code, e, 503, "model_unavailable")
	before := env.proxy.EmbedRejected()
	code, e = retrieve()
	mustCode(t, "retrieve, connection blocked", code, e, 503, "model_unavailable")
	if env.proxy.EmbedRejected() != before {
		t.Error("a blocked connection still sent the request")
	}
}
