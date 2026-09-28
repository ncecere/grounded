package httpapi_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// ragEnv is a platform with a connected (fake) proxy, an embedding model and
// a default profile, plus a team owned by "user".
type ragEnv struct {
	app   *testApp
	admin *session
	owner *session
	proxy *testutil.FakeProxy
	team  string
}

func newRAGEnv(t *testing.T) *ragEnv { return newRAGEnvWith(t, nil) }

func newRAGEnvWith(t *testing.T, mutate func(*config.Config)) *ragEnv {
	app := newTestAppWith(t, mutate, true)
	env := &ragEnv{app: app, admin: app.signIn("admin"), proxy: testutil.NewFakeProxy(t), team: "registrar"}
	env.proxy.AddEmbeddingModel("bow-64", 64)
	var conn apitypes.Connection
	code, e := env.admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Proxy", "baseUrl": env.proxy.BaseURL(), "apiKey": env.proxy.APIKey}, &conn, nil)
	mustCode(t, "connection", code, e, 201, "")
	var model apitypes.Model
	code, e = env.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": conn.Id, "key": "bow", "upstreamModel": "bow-64", "displayName": "BoW", "kind": "embedding",
		"maxClassification": "restricted", "dimensions": 64,
	}, &model, nil)
	mustCode(t, "model", code, e, 201, "")
	code, e = env.admin.call("POST", "/v1/admin/embedding-profiles", map[string]any{
		"key": "bow-64", "name": "BoW 64", "modelId": model.Id, "chunkSize": 128, "chunkOverlap": 16,
		"documentPrefix": "search_document: ", "queryPrefix": "search_query: ",
	}, nil, nil)
	mustCode(t, "profile", code, e, 201, "")
	env.owner = app.signIn("user")
	createTeam(t, env.admin, env.team, "user@localhost")
	env.owner.refresh()
	return env
}

type upload struct {
	name string
	data []byte
}

// uploadFiles posts files as multipart. auth, if set, is an API key.
func (s *session) uploadFiles(path string, files []upload, apiKey string) (int, []apitypes.UploadResult, string) {
	s.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, f := range files {
		w, _ := mw.CreateFormFile("files", f.name)
		_, _ = w.Write(f.data)
	}
	_ = mw.Close()
	req, _ := http.NewRequest("POST", s.app.URL+path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	client := s.client
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
		client = http.DefaultClient
	} else {
		req.Header.Set("Origin", s.app.URL)
		req.Header.Set("X-CSRF-Token", s.csrf)
	}
	res, err := client.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var env struct{ Data []apitypes.UploadResult }
	_ = json.Unmarshal(raw, &env)
	return res.StatusCode, env.Data, errorCode(raw)
}

// keyCall performs a JSON request with an API key.
func keyCall(t *testing.T, base, method, path, key string, body, out any) (int, string) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, base+path, rdr)
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 300 && out != nil {
		env := struct{ Data any }{Data: out}
		_ = json.Unmarshal(raw, &env)
	}
	return res.StatusCode, errorCode(raw)
}

func docxBytes(t *testing.T, heading, body string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range map[string]string{
		"[Content_Types].xml": `<Types/>`,
		"word/styles.xml":     `<w:styles xmlns:w="w"><w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/></w:style></w:styles>`,
		"word/document.xml": `<w:document xmlns:w="w"><w:body>` +
			`<w:p><w:pPr><w:pStyle w:val="H1"/></w:pPr><w:r><w:t>` + heading + `</w:t></w:r></w:p>` +
			`<w:p><w:r><w:t>` + body + `</w:t></w:r></w:p></w:body></w:document>`,
	} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(content))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// waitForDocuments polls until no document is pending/queued/processing.
func (s *session) waitForDocuments(t *testing.T, path string) []apitypes.Document {
	t.Helper()
	deadline := time.Now().Add(45 * time.Second)
	for {
		var page apitypes.DocumentPage
		if code := s.get(path+"?limit=200", &page); code != 200 {
			t.Fatalf("list documents = %d", code)
		}
		busy := false
		for _, d := range page.Items {
			if d.Status == "pending" || d.Status == "queued" || d.Status == "processing" {
				busy = true
			}
		}
		if !busy {
			return page.Items
		}
		if time.Now().After(deadline) {
			t.Fatalf("documents still processing: %+v", page.Items)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func byName(docs []apitypes.Document) map[string]apitypes.Document {
	m := map[string]apitypes.Document{}
	for _, d := range docs {
		m[d.Filename] = d
	}
	return m
}

func TestUploadIngestAndRetrieve(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team

	var src apitypes.DataSource
	code, e := owner.call("POST", base+"/sources", map[string]any{"name": "Policies", "classification": "sensitive"}, &src, nil)
	mustCode(t, "create source", code, e, 201, "")
	code, e = owner.call("POST", base+"/sources", map[string]any{"name": "Secret", "classification": "restricted"}, nil, nil)
	mustCode(t, "above team approval", code, e, 400, "classification_not_approved")

	docs := base + "/sources/" + src.Id.String() + "/documents"
	parking := "# Parking\n\nStudents must display a valid parking permit decal. Permits are sold by Transportation Services.\n\n## Citations\n\nParking citations can be appealed within ten days."
	code, results, e := owner.uploadFiles(docs, []upload{
		{"parking.md", []byte(parking)},
		{"housing.docx", docxBytes(t, "Housing", "Residence halls open for move-in on August 18. Bring your campus ID card.")},
		{"notes.txt", []byte("Library hours are extended during finals week.")},
		{"virus.exe", []byte("MZ\x00\x00")},
		{"fake.pdf", []byte("not really a pdf")},
		{"empty.txt", nil},
	}, "")
	if code != 200 || len(results) != 6 {
		t.Fatalf("upload = %d %s %+v", code, e, results)
	}
	want := map[string]string{"parking.md": "created", "housing.docx": "created", "notes.txt": "created", "virus.exe": "rejected", "fake.pdf": "rejected", "empty.txt": "rejected"}
	for _, r := range results {
		if r.Status != apitypes.UploadResultStatus(want[r.Filename]) {
			t.Errorf("%s: status %s (%+v)", r.Filename, r.Status, r.Error)
		}
	}

	ready := byName(owner.waitForDocuments(t, docs))
	for _, name := range []string{"parking.md", "housing.docx", "notes.txt"} {
		d := ready[name]
		if d.Status != "ready" || d.ChunkCount == 0 {
			t.Fatalf("%s = %+v", name, d)
		}
	}
	if ready["housing.docx"].Title != "Housing" || ready["housing.docx"].Kind != "docx" {
		t.Errorf("docx metadata = %+v", ready["housing.docx"])
	}

	// Usage is recorded for embedding.
	var embedTokens int64
	_ = env.app.Pool.QueryRow(context.Background(), "SELECT coalesce(sum(quantity),0) FROM usage_events WHERE kind = 'embed_tokens'").Scan(&embedTokens)
	if embedTokens == 0 {
		t.Error("no embed_tokens usage recorded")
	}

	var kb apitypes.KnowledgeBase
	code, e = owner.call("POST", base+"/kbs", map[string]any{"name": "Campus life", "topK": 3}, &kb, nil)
	mustCode(t, "create kb", code, e, 201, "")
	code, e = owner.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, &kb, nil)
	mustCode(t, "attach", code, e, 200, "")
	if kb.EffectiveClassification == nil || *kb.EffectiveClassification != "sensitive" {
		t.Errorf("effective classification = %v", kb.EffectiveClassification)
	}

	// Fusion weights: the platform default until the KB overrides them. The
	// fake proxy's 8-dimension hashed vectors are a weak retriever, so this
	// KB favours keyword search (the per-KB override).
	if kb.FusionWeights != nil || kb.EffectiveFusionWeights == nil || *kb.EffectiveFusionWeights != (apitypes.FusionWeights{Vector: 1, Keyword: 0.1}) {
		t.Errorf("default weights = %+v %+v", kb.FusionWeights, kb.EffectiveFusionWeights)
	}
	kbPath := base + "/kbs/" + kb.Id.String()
	code, e = owner.call("PATCH", kbPath, map[string]any{"fusionWeights": map[string]any{"vector": 0, "keyword": 0}}, nil, ifMatch(kb.Revision))
	mustCode(t, "zero weights", code, e, 400, "invalid_fusion_weights")
	code, e = owner.call("PATCH", kbPath, map[string]any{"fusionWeights": map[string]any{"vector": 1, "keyword": 1.5}}, nil, ifMatch(kb.Revision))
	mustCode(t, "weight above 1", code, e, 400, "invalid_fusion_weights")
	code, e = owner.call("PATCH", kbPath, map[string]any{"fusionWeights": map[string]any{"vector": 1, "keyword": 1}, "useDefaultFusionWeights": true}, nil, ifMatch(kb.Revision))
	mustCode(t, "weights and default", code, e, 400, "invalid_fusion_weights")
	code, e = owner.call("PATCH", kbPath, map[string]any{"fusionWeights": map[string]any{"vector": 0.5, "keyword": 1}}, &kb, ifMatch(kb.Revision))
	mustCode(t, "set weights", code, e, 200, "")
	if kb.FusionWeights == nil || *kb.FusionWeights != (apitypes.FusionWeights{Vector: 0.5, Keyword: 1}) || *kb.EffectiveFusionWeights != *kb.FusionWeights {
		t.Errorf("override = %+v %+v", kb.FusionWeights, kb.EffectiveFusionWeights)
	}
	code, e = owner.call("PATCH", kbPath, map[string]any{"topK": 3}, &kb, ifMatch(kb.Revision))
	mustCode(t, "other change keeps weights", code, e, 200, "")
	if kb.FusionWeights == nil {
		t.Error("an unrelated update dropped the weights")
	}

	retrieve := func(s *session, q string) apitypes.RetrieveResult {
		t.Helper()
		var res apitypes.RetrieveResult
		code, e := s.call("POST", base+"/kbs/"+kb.Id.String()+"/retrieve", map[string]any{"query": q}, &res, nil)
		mustCode(t, "retrieve "+q, code, e, 200, "")
		return res
	}
	res := retrieve(owner, "how do I appeal a parking citation")
	if len(res.Hits) == 0 || !strings.Contains(res.Hits[0].Content, "appealed") || strings.Join(res.Hits[0].HeadingPath, ">") != "Parking>Citations" {
		t.Fatalf("top hit = %+v", res.Hits)
	}
	if res.Hits[0].Filename != "parking.md" || res.Hits[0].LexicalRank == nil {
		t.Errorf("citation = %+v", res.Hits[0])
	}
	// Keyword search matches questions containing words the answer lacks.
	res = retrieve(owner, "what is the process to appeal my parking citation?")
	if len(res.Hits) == 0 || res.Hits[0].LexicalRank == nil || !strings.Contains(res.Hits[0].Content, "appealed") {
		t.Fatalf("natural-language question: %+v", res.Hits)
	}
	if res := retrieve(owner, "the of and"); len(res.Hits) > 0 && res.Hits[0].LexicalRank != nil {
		t.Errorf("stopword-only query matched keywords: %+v", res.Hits[0])
	}
	// Keyword weight 0 is vector-only: no full-text ranks at all.
	code, e = owner.call("PATCH", kbPath, map[string]any{"fusionWeights": map[string]any{"vector": 1, "keyword": 0}}, &kb, ifMatch(kb.Revision))
	mustCode(t, "vector only", code, e, 200, "")
	for _, h := range retrieve(owner, "how do I appeal a parking citation").Hits {
		if h.LexicalRank != nil || h.VectorRank == nil {
			t.Fatalf("vector-only hit = %+v", h)
		}
	}
	code, e = owner.call("PATCH", kbPath, map[string]any{"fusionWeights": map[string]any{"vector": 0.5, "keyword": 1}}, &kb, ifMatch(kb.Revision))
	mustCode(t, "restore weights", code, e, 200, "")
	if top := retrieve(owner, "move-in residence halls").Hits; len(top) == 0 || top[0].Title != "Housing" {
		t.Errorf("housing query = %+v", top)
	}

	// A source that is not attached never leaks into results, even when it
	// matches the query better (both vector and full-text paths are scoped).
	var other apitypes.DataSource
	owner.call("POST", base+"/sources", map[string]any{"name": "Unattached", "classification": "open"}, &other, nil)
	otherDocs := base + "/sources/" + other.Id.String() + "/documents"
	owner.uploadFiles(otherDocs, []upload{{"leak.md", []byte("# Appeal parking citation\n\nHow do I appeal a parking citation? Appeal parking citation appeal.")}}, "")
	owner.waitForDocuments(t, otherDocs)
	for _, h := range retrieve(owner, "how do I appeal a parking citation").Hits {
		if h.SourceId == other.Id {
			t.Fatalf("unattached source leaked into results: %+v", h)
		}
	}

	// Replacing a file re-processes it; old content disappears.
	code, results, _ = owner.uploadFiles(docs, []upload{{"parking.md", []byte("# Parking\n\nParking is free on weekends in commuter lots.")}}, "")
	if code != 200 || results[0].Status != "replaced" || results[0].Document.Version != 2 {
		t.Fatalf("replace = %d %+v", code, results)
	}
	code, results, _ = owner.uploadFiles(docs, []upload{{"notes.txt", []byte("Library hours are extended during finals week.")}}, "")
	if code != 200 || results[0].Status != "unchanged" {
		t.Errorf("identical re-upload = %+v", results[0])
	}
	owner.waitForDocuments(t, docs)
	for _, h := range retrieve(owner, "parking citation appeal").Hits {
		if strings.Contains(h.Content, "appealed") {
			t.Fatal("replaced content still retrievable")
		}
	}
	if top := retrieve(owner, "weekend parking commuter lots").Hits; len(top) == 0 || !strings.Contains(top[0].Content, "weekends") {
		t.Errorf("new content not found: %+v", top)
	}

	// Deleting a document removes it from retrieval.
	notes := ready["notes.txt"]
	code, e = owner.call("DELETE", docs+"/"+notes.Id.String(), nil, nil, nil)
	mustCode(t, "delete doc", code, e, 200, "")
	for _, h := range retrieve(owner, "library finals hours").Hits {
		if h.DocumentId == notes.Id {
			t.Fatal("deleted document still retrievable")
		}
	}

	// A source used by a KB cannot be deleted; the team cannot be approved below it.
	code, e = owner.call("DELETE", base+"/sources/"+src.Id.String(), nil, nil, nil)
	mustCode(t, "delete used source", code, e, 409, "source_in_use")
	var team apitypes.TeamSummary
	env.admin.get("/v1/admin/teams/"+env.team, &team)
	code, e = env.admin.call("PATCH", "/v1/admin/teams/"+env.team, map[string]any{"maxClassification": "open"}, nil, ifMatch(team.Team.Revision))
	mustCode(t, "lower team below its data", code, e, 409, "classification_in_use")
}

func TestAPIKeysAndPermissions(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team
	var src apitypes.DataSource
	owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	var kb apitypes.KnowledgeBase
	owner.call("POST", base+"/kbs", map[string]any{"name": "KB"}, &kb, nil)
	owner.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	docs := base + "/sources/" + src.Id.String() + "/documents"

	// Keys: an ingest key uploads; a query key retrieves but cannot upload.
	var ingestKey, queryKey apitypes.APIKeyCreated
	code, e := owner.call("POST", base+"/api-keys", map[string]any{"name": "loader", "kind": "service", "scopes": []string{"ingest"}}, &ingestKey, nil)
	mustCode(t, "service key", code, e, 201, "")
	code, e = owner.call("POST", base+"/api-keys", map[string]any{"name": "app", "scopes": []string{"query"}, "knowledgeBaseIds": []string{kb.Id.String()}}, &queryKey, nil)
	mustCode(t, "query key", code, e, 201, "")
	if !strings.HasPrefix(ingestKey.Secret, ingestKey.Key.Prefix) {
		t.Fatalf("secret/prefix mismatch: %+v", ingestKey)
	}

	code, results, _ := owner.uploadFiles(docs, []upload{{"faq.md", []byte("# FAQ\n\nThe bursar accepts tuition payments online.")}}, ingestKey.Secret)
	if code != 200 || results[0].Status != "created" {
		t.Fatalf("key upload = %d %+v", code, results)
	}
	code, _, e = owner.uploadFiles(docs, []upload{{"x.md", []byte("x")}}, queryKey.Secret)
	mustCode(t, "query key uploads", code, e, 403, "forbidden")
	owner.waitForDocuments(t, docs)

	var res apitypes.RetrieveResult
	code, e = keyCall(t, env.app.URL, "POST", base+"/kbs/"+kb.Id.String()+"/retrieve", queryKey.Secret, map[string]any{"query": "tuition payments"}, &res)
	mustCode(t, "key retrieve", code, e, 200, "")
	if len(res.Hits) == 0 || res.Hits[0].Filename != "faq.md" {
		t.Fatalf("key retrieve hits = %+v", res.Hits)
	}
	code, e = keyCall(t, env.app.URL, "POST", base+"/kbs/"+kb.Id.String()+"/retrieve", ingestKey.Secret, map[string]any{"query": "tuition"}, nil)
	mustCode(t, "ingest key retrieves", code, e, 403, "forbidden")
	code, e = keyCall(t, env.app.URL, "POST", base+"/kbs/"+kb.Id.String()+"/retrieve", "rag_wrong", map[string]any{"query": "x"}, nil)
	mustCode(t, "bad key", code, e, 401, "invalid_api_key")
	// Keys cannot reach session-only routes or other teams.
	code, e = keyCall(t, env.app.URL, "GET", "/v1/me", queryKey.Secret, nil, nil)
	mustCode(t, "key on session route", code, e, 401, "unauthorized")
	createTeam(t, env.admin, "other", "admin@localhost")
	code, e = keyCall(t, env.app.URL, "GET", "/v1/teams/other/kbs", queryKey.Secret, nil, nil)
	mustCode(t, "key on other team", code, e, 404, "team_not_found")

	// Team roles: members read, editors write, only admins lower classification.
	env.app.signIn("alex")
	env.app.signIn("blair")
	owner.call("POST", base+"/members", map[string]string{"email": "alex@localhost", "role": "member"}, nil, nil)
	owner.call("POST", base+"/members", map[string]string{"email": "blair@localhost", "role": "editor"}, nil, nil)
	member, editor := env.app.signIn("alex"), env.app.signIn("blair")
	code, e = member.call("POST", base+"/sources", map[string]any{"name": "M", "classification": "open"}, nil, nil)
	mustCode(t, "member creates source", code, e, 403, "forbidden")
	if code := member.get(base+"/sources", nil); code != 200 {
		t.Fatalf("member lists sources = %d", code)
	}
	var sens apitypes.DataSource
	code, e = editor.call("POST", base+"/sources", map[string]any{"name": "Sensitive", "classification": "sensitive"}, &sens, nil)
	mustCode(t, "editor creates source", code, e, 201, "")
	code, e = editor.call("PATCH", base+"/sources/"+sens.Id.String(), map[string]any{"classification": "open", "reason": "Reviewed: no sensitive data"}, nil, ifMatch(sens.Revision))
	mustCode(t, "editor lowers classification", code, e, 403, "forbidden")
	code, e = owner.call("PATCH", base+"/sources/"+sens.Id.String(), map[string]any{"classification": "open"}, nil, ifMatch(sens.Revision))
	mustCode(t, "lower without reason", code, e, 400, "reason_required")
	code, e = owner.call("PATCH", base+"/sources/"+sens.Id.String(), map[string]any{"classification": "open", "reason": "Reviewed: no sensitive data"}, nil, ifMatch(sens.Revision))
	mustCode(t, "owner lowers with reason", code, e, 200, "")

	// Paused sources accept no uploads; resuming allows them again.
	var paused apitypes.DataSource
	code, e = owner.call("PATCH", base+"/sources/"+src.Id.String(), map[string]any{"status": "paused"}, &paused, ifMatch(src.Revision))
	mustCode(t, "pause", code, e, 200, "")
	code, _, e = owner.uploadFiles(docs, []upload{{"late.md", []byte("# Late")}}, "")
	mustCode(t, "upload to paused source", code, e, 409, "source_paused")
	code, e = owner.call("PATCH", base+"/sources/"+src.Id.String(), map[string]any{"status": "active"}, nil, ifMatch(paused.Revision))
	mustCode(t, "resume", code, e, 200, "")

	// Platform admins who are not members see no team content.
	code, e = env.admin.call("GET", base+"/sources", nil, nil, nil)
	mustCode(t, "platform admin reads sources", code, e, 404, "team_not_found")
	// Nor under a break-glass session without the documents scope (ADR-0024).
	bgs := startBreakGlass(t, env.admin, env.team, "conversations")
	code, e = env.admin.call("GET", base+"/sources/"+src.Id.String()+"/documents", nil, nil, nil)
	mustCode(t, "platform admin, conversations-only break-glass", code, e, 404, "team_not_found")
	code, e = env.admin.call("POST", "/v1/admin/break-glass/"+bgs.Id.String()+"/end", nil, nil, nil)
	mustCode(t, "end break-glass", code, e, 200, "")

	// Leaving the team revokes the member's personal keys.
	var alexKey apitypes.APIKeyCreated
	code, e = member.call("POST", base+"/api-keys", map[string]any{"name": "mine", "scopes": []string{"query"}}, &alexKey, nil)
	mustCode(t, "member key", code, e, 201, "")
	code, e = member.call("POST", base+"/api-keys", map[string]any{"name": "too much", "scopes": []string{"ingest"}}, nil, nil)
	mustCode(t, "member ingest scope", code, e, 403, "forbidden")
	member.call("DELETE", base+"/members/"+member.me.User.Id.String(), nil, nil, nil)
	code, e = keyCall(t, env.app.URL, "GET", base+"/kbs", alexKey.Secret, nil, nil)
	mustCode(t, "revoked member key", code, e, 401, "invalid_api_key")
}

func TestModelOutageFailsAndRetries(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team
	var src apitypes.DataSource
	owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	docs := base + "/sources/" + src.Id.String() + "/documents"

	env.proxy.FailWith(http.StatusUnauthorized) // misconfigured key: a permanent failure
	_, results, _ := owner.uploadFiles(docs, []upload{{"a.md", []byte("# A\n\nAlpha content.")}}, "")
	d := byName(owner.waitForDocuments(t, docs))["a.md"]
	if d.Status != "failed" || d.ErrorCode != "model_auth" {
		t.Fatalf("doc = %+v", d)
	}
	env.proxy.FailWith(0)
	code, e := owner.call("POST", docs+"/"+results[0].Document.Id.String()+"/retry", nil, nil, nil)
	mustCode(t, "retry", code, e, 200, "")
	if d := byName(owner.waitForDocuments(t, docs))["a.md"]; d.Status != "ready" {
		t.Fatalf("after retry = %+v", d)
	}
}

// P-06: a damaged PDF fails with a friendly message and the parser's text
// as the detail.
func TestDamagedDocumentErrorIsFriendly(t *testing.T) {
	env := newRAGEnv(t)
	base := "/v1/teams/" + env.team
	var src apitypes.DataSource
	code, e := env.owner.call("POST", base+"/sources", map[string]any{"name": "Forms", "classification": "open"}, &src, nil)
	mustCode(t, "create source", code, e, 201, "")
	docs := base + "/sources/" + src.Id.String() + "/documents"
	code, results, e := env.owner.uploadFiles(docs, []upload{{"broken.pdf", []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\ngarbage\n")}}, "")
	if code != 200 || len(results) != 1 || results[0].Status != "created" {
		t.Fatalf("upload = %d %s %+v", code, e, results)
	}
	d := byName(env.owner.waitForDocuments(t, docs))["broken.pdf"]
	if d.Status != "failed" || d.ErrorCode != "corrupt" || !strings.HasPrefix(d.ErrorMessage, "This PDF appears to be damaged or password-protected") ||
		!strings.Contains(d.ErrorDetail, "damaged") {
		t.Fatalf("document = %+v", d)
	}
}
