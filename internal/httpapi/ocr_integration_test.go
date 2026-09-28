package httpapi_test

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/testutil"
)

// OCR for scanned documents (docs/ocr.md): Admin -> Parsing, ingestion
// with the Tesseract sidecar (a fake one), the per-source switch, image
// uploads, bulk retry, the daily page limit, and the vision backend.

func scanned(t *testing.T, pages ...string) []byte {
	ps := make([]testutil.ScanPage, len(pages))
	for i, p := range pages {
		if strings.HasPrefix(p, "text:") {
			ps[i].Text = []testutil.ScanText{{Size: 11, X: 72, Y: 700, Text: strings.TrimPrefix(p, "text:")}}
		} else {
			ps[i].Scan = p
		}
	}
	return testutil.ScannedPDF(t, ps)
}

func withTesseract(f *testutil.FakeOCR) func(*config.Config) {
	return func(c *config.Config) { c.OCR.TesseractURL = f.URL }
}

func getParsing(t *testing.T, s *session) apitypes.ParsingSettings {
	t.Helper()
	var st apitypes.ParsingSettings
	if code := s.get("/v1/admin/parsing", &st); code != 200 {
		t.Fatalf("get parsing = %d", code)
	}
	return st
}

func putParsing(t *testing.T, admin *session, body map[string]any) apitypes.ParsingSettings {
	t.Helper()
	cur := getParsing(t, admin)
	var st apitypes.ParsingSettings
	code, e := admin.call("PUT", "/v1/admin/parsing", body, &st, ifMatch(cur.Revision))
	mustCode(t, "put parsing", code, e, 200, "")
	return st
}

func TestParsingSettings(t *testing.T) {
	sidecar := testutil.NewFakeOCR(t)
	app := newTestAppWith(t, withTesseract(sidecar), false)
	admin, auditor, user := app.signIn("admin"), app.signIn("auditor"), app.signIn("user")

	st := getParsing(t, admin)
	if st.OcrEnabled || st.Backend != "tesseract" || st.Languages != "eng" || st.Revision != 1 || st.UpdatedAt != nil ||
		st.MaxPagesPerDocument != 200 || st.Concurrency != 2 || len(st.NeedsOcr) != 0 {
		t.Fatalf("defaults = %+v", st)
	}
	configured := map[apitypes.OcrBackend]bool{}
	for _, b := range st.Backends {
		configured[b.Backend] = b.Configured
	}
	if !configured["tesseract"] || configured["tika"] || !configured["vision"] {
		t.Errorf("backends = %+v", st.Backends)
	}
	if code := auditor.get("/v1/admin/parsing", nil); code != 200 {
		t.Errorf("auditor read = %d", code)
	}
	if code := user.get("/v1/admin/parsing", nil); code != 403 {
		t.Errorf("user read = %d", code)
	}

	on := map[string]any{"ocrEnabled": true, "backend": "tesseract", "visionModelId": nil, "languages": "eng+spa"}
	code, e := admin.call("PUT", "/v1/admin/parsing", on, nil, nil)
	mustCode(t, "no If-Match", code, e, 428, "")
	for _, bad := range []struct {
		body map[string]any
		code string
	}{
		{map[string]any{"ocrEnabled": true, "backend": "tika", "visionModelId": nil, "languages": "eng"}, "backend_not_configured"},
		{map[string]any{"ocrEnabled": true, "backend": "vision", "visionModelId": nil, "languages": "eng"}, "backend_not_configured"},
		{map[string]any{"ocrEnabled": false, "backend": "tesseract", "visionModelId": uuid.New(), "languages": "eng"}, "invalid_model"},
		{map[string]any{"ocrEnabled": true, "backend": "tesseract", "visionModelId": nil, "languages": "english; rm"}, ""},
	} {
		code, _ := admin.call("PUT", "/v1/admin/parsing", bad.body, nil, ifMatch(1))
		if code != 400 {
			t.Errorf("%v: %d", bad.body, code)
		}
	}
	code, e = auditor.call("PUT", "/v1/admin/parsing", on, nil, ifMatch(1))
	mustCode(t, "auditor write", code, e, 403, "")

	st = putParsing(t, admin, on)
	if !st.OcrEnabled || st.Languages != "eng+spa" || st.Revision != 2 || st.UpdatedAt == nil {
		t.Fatalf("saved = %+v", st)
	}
	code, e = admin.call("PUT", "/v1/admin/parsing", on, nil, ifMatch(1))
	mustCode(t, "stale", code, e, 412, "")
	var audited int
	_ = app.Pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_log WHERE action = 'platform.parsing_settings_update'").Scan(&audited)
	if audited != 1 {
		t.Errorf("audit entries = %d", audited)
	}

	// Test reads the built-in sample page with the saved settings.
	var res apitypes.ParsingTestResult
	code, e = admin.call("POST", "/v1/admin/parsing/test", nil, &res, nil)
	mustCode(t, "test", code, e, 200, "")
	if !res.Ok || res.Text != testutil.FakeOCRText(1000, 240) || res.Expected != ocr.SampleText || res.Backend != "tesseract" {
		t.Errorf("test = %+v", res)
	}
	if langs := sidecar.Languages(); len(langs) != 1 || langs[0] != "eng+spa" {
		t.Errorf("languages sent = %v", langs)
	}
	sidecar.FailWith(503)
	code, e = admin.call("POST", "/v1/admin/parsing/test", map[string]any{"languages": "spa"}, &res, nil)
	mustCode(t, "failing test", code, e, 200, "")
	if res.Ok || res.Error == nil || !strings.Contains(*res.Error, "unavailable") {
		t.Errorf("failing test = %+v", res)
	}
	code, e = auditor.call("POST", "/v1/admin/parsing/test", nil, nil, nil)
	mustCode(t, "auditor test", code, e, 403, "")
}

// ocrEnv is a RAG platform with the fake Tesseract sidecar configured.
func ocrEnv(t *testing.T) (*ragEnv, *testutil.FakeOCR) {
	sidecar := testutil.NewFakeOCR(t)
	return newRAGEnvWith(t, withTesseract(sidecar)), sidecar
}

func createOCRSource(t *testing.T, s *session, team, name, classification string, extra map[string]any) apitypes.DataSource {
	t.Helper()
	body := map[string]any{"name": name, "classification": classification}
	for k, v := range extra {
		body[k] = v
	}
	var src apitypes.DataSource
	code, e := s.call("POST", "/v1/teams/"+team+"/sources", body, &src, nil)
	mustCode(t, "create source", code, e, 201, "")
	return src
}

func passagesOf(t *testing.T, s *session, docs string, d apitypes.Document) string {
	t.Helper()
	var page apitypes.DocumentPassagePage
	if code := s.get(docs+"/"+d.Id.String()+"/passages?limit=20", &page); code != 200 {
		t.Fatalf("passages = %d", code)
	}
	var b strings.Builder
	for _, p := range page.Items {
		b.WriteString(p.Content + "\n")
	}
	return b.String()
}

func ledger(t *testing.T, app *testApp, kind string) (sum int64, backend string) {
	t.Helper()
	_ = app.Pool.QueryRow(context.Background(), `SELECT coalesce(sum(quantity), 0), coalesce(max(metadata->>'backend'), '')
		FROM usage_events WHERE kind = $1`, kind).Scan(&sum, &backend)
	return sum, backend
}

// ocrState checks what a single source's response says about OCR (the upload dialog and Retry use it).
func ocrState(t *testing.T, s *session, path string, want apitypes.DataSourceOcrState) {
	t.Helper()
	var src apitypes.DataSource
	if code := s.get(path, &src); code != 200 || src.OcrState == nil || *src.OcrState != want {
		t.Errorf("ocrState = %d %v, want %s", code, src.OcrState, want)
	}
}

func TestOCRIngestionAndRetry(t *testing.T) {
	env, sidecar := ocrEnv(t)
	owner, base := env.owner, "/v1/teams/"+env.team
	src := createOCRSource(t, owner, env.team, "Scans", "sensitive", nil)
	if !src.OcrEnabled {
		t.Fatal("OCR is on for a new source")
	}
	docs := base + "/sources/" + src.Id.String() + "/documents"
	receipt := testutil.EncodeImage(t, "png", "RECEIPT")

	// OCR off (the default): as before, and images are refused at once.
	code, results, e := owner.uploadFiles(docs, []upload{
		{"scan.pdf", scanned(t, "PAGE ONE", "PAGE TWO")},
		{"mixed.pdf", scanned(t, "text:A typed introduction page.", "PAGE TWO")},
		{"receipt.png", receipt},
	}, "")
	if code != 200 || results[2].Status != "rejected" || results[2].Error.Code != "ocr_off" || results[2].Error.Message != ocr.UnavailableMessage {
		t.Fatalf("upload = %d %s %+v", code, e, results)
	}
	got := byName(owner.waitForDocuments(t, docs))
	if d := got["scan.pdf"]; d.Status != "skipped" || d.ErrorCode != "needs_ocr" || d.Ocr != nil || d.Kind != "pdf" {
		t.Fatalf("scan.pdf without OCR = %+v", d)
	}
	if d := got["mixed.pdf"]; d.Status != "ready" || !strings.Contains(strings.Join(d.Warnings, " "), "1 of 2 pages had no text layer (possibly scanned) and was skipped") {
		t.Errorf("mixed.pdf without OCR = %+v", d)
	}
	var page apitypes.DocumentPage
	if code := owner.get(docs+"?errorCode=needs_ocr", &page); code != 200 || len(page.Items) != 1 || page.Items[0].Filename != "scan.pdf" {
		t.Fatalf("needs OCR filter = %d %+v", code, page.Items)
	}
	st := getParsing(t, env.admin)
	if len(st.NeedsOcr) != 1 || st.NeedsOcr[0].TeamSlug != env.team || st.NeedsOcr[0].Documents != 1 {
		t.Errorf("needs OCR counts = %+v", st.NeedsOcr)
	}
	ocrState(t, owner, base+"/sources/"+src.Id.String(), apitypes.DataSourceOcrStatePlatformOff)

	// OCR on: retry the scanned documents together.
	putParsing(t, env.admin, map[string]any{"ocrEnabled": true, "backend": "tesseract", "visionModelId": nil, "languages": "eng"})
	ocrState(t, owner, base+"/sources/"+src.Id.String(), apitypes.DataSourceOcrStateOn)
	var retried apitypes.DocumentRetryResult
	code, e = owner.call("POST", docs+"/retry", map[string]any{"errorCode": "failed"}, nil, nil)
	mustCode(t, "retry by another code", code, e, 400, "")
	code, e = owner.call("POST", docs+"/retry", map[string]any{"errorCode": "needs_ocr"}, &retried, nil)
	mustCode(t, "bulk retry", code, e, 200, "")
	if retried.Retried != 1 {
		t.Fatalf("retried = %d", retried.Retried)
	}
	code, results, e = owner.uploadFiles(docs, []upload{{"receipt.png", receipt}}, "")
	if code != 200 || results[0].Status != "created" {
		t.Fatalf("image upload with OCR on = %d %s %+v", code, e, results)
	}
	got = byName(owner.waitForDocuments(t, docs))
	d := got["scan.pdf"]
	if d.Status != "ready" || d.Ocr == nil || d.Ocr.Backend != "tesseract" || !slices.Equal(d.Ocr.Pages, []int32{1, 2}) {
		t.Fatalf("scan.pdf with OCR = %+v", d)
	}
	if text := passagesOf(t, owner, docs, d); !strings.Contains(text, "Scanned text read by OCR from a page of 2550 x") {
		t.Errorf("passages = %s", text)
	}
	img := got["receipt.png"]
	if img.Status != "ready" || img.Kind != "image" || img.Pages != 1 || img.Ocr == nil || !slices.Equal(img.Ocr.Pages, []int32{1}) {
		t.Fatalf("receipt.png = %+v", img)
	}
	if pages, backend := ledger(t, env.app, "ocr_pages"); pages != 3 || backend != "tesseract" || sidecar.Calls() != 3 {
		t.Errorf("ocr_pages = %d (%s), sidecar calls %d", pages, backend, sidecar.Calls())
	}
	var parser string
	_ = env.app.Pool.QueryRow(context.Background(), "SELECT parser FROM documents WHERE id = $1", d.Id).Scan(&parser)
	if parser != "builtin:pdf+ocr:tesseract" {
		t.Errorf("parser = %q", parser)
	}

	// The source's switch: images refused, scans skipped, nothing read.
	var updated apitypes.DataSource
	code, e = owner.call("PATCH", base+"/sources/"+src.Id.String(), map[string]any{"ocrEnabled": false}, &updated, ifMatch(src.Revision))
	mustCode(t, "switch off", code, e, 200, "")
	if updated.OcrEnabled || updated.OcrState == nil || *updated.OcrState != apitypes.DataSourceOcrStateSourceOff {
		t.Fatalf("switched off = %v, state %v", updated.OcrEnabled, updated.OcrState)
	}
	code, results, _ = owner.uploadFiles(docs, []upload{{"photo.jpg", testutil.EncodeImage(t, "jpeg", "PHOTO")}, {"scan2.pdf", scanned(t, "PAGE")}}, "")
	if code != 200 || results[0].Error == nil || results[0].Error.Code != "ocr_off" || results[1].Status != "created" {
		t.Fatalf("uploads with the source's OCR off = %+v", results)
	}
	if d := byName(owner.waitForDocuments(t, docs))["scan2.pdf"]; d.ErrorCode != "needs_ocr" || sidecar.Calls() != 3 {
		t.Errorf("scan2.pdf = %+v, sidecar calls %d", d, sidecar.Calls())
	}
	var audited int
	_ = env.app.Pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_log WHERE action = 'document.retry_bulk'").Scan(&audited)
	if audited != 1 {
		t.Errorf("bulk retry audit entries = %d", audited)
	}
}

func getDoc(t *testing.T, s *session, docs string, id uuid.UUID) apitypes.Document {
	t.Helper()
	var d apitypes.Document
	if code := s.get(docs+"/"+id.String(), &d); code != 200 {
		t.Fatalf("get document = %d", code)
	}
	return d
}

// waitDoc polls a document (slowly: sessions have a per-minute query
// limit) until cond holds.
func waitDoc(t *testing.T, s *session, docs string, id uuid.UUID, what string, cond func(apitypes.Document) bool) apitypes.Document {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for {
		d := getDoc(t, s, docs, id)
		if cond(d) {
			return d
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s: %+v", what, d)
		}
		time.Sleep(300 * time.Millisecond)
	}
}

func uploadOCR(t *testing.T, s *session, docs, name string, data []byte) apitypes.Document {
	t.Helper()
	code, results, e := s.uploadFiles(docs, []upload{{name, data}}, "")
	if code != 200 || results[0].Document == nil {
		t.Fatalf("upload %s = %d %s %+v", name, code, e, results)
	}
	return *results[0].Document
}

func TestOCRDailyLimitWaitsAndWakes(t *testing.T) {
	env, _ := ocrEnv(t)
	owner := env.owner
	putParsing(t, env.admin, map[string]any{"ocrEnabled": true, "backend": "tesseract", "visionModelId": nil, "languages": "eng"})
	setTeamLimits(t, env.admin, env.team, map[string]any{"ocr_pages_per_day": 3})
	src := createOCRSource(t, owner, env.team, "Scans", "sensitive", nil)
	docs := "/v1/teams/" + env.team + "/sources/" + src.Id.String() + "/documents"
	first := uploadOCR(t, owner, docs, "first.pdf", scanned(t, "PAGE ONE", "PAGE TWO"))
	waitDoc(t, owner, docs, first.Id, "the first document", func(d apitypes.Document) bool { return d.Status == "ready" && d.Ocr != nil })

	// Two more pages would pass today's 3: the document waits (pending, with
	// the reason), not failed, and frees its slot.
	big := uploadOCR(t, owner, docs, "two-pages.pdf", scanned(t, "PAGE ONE", "PAGE TWO"))
	waitDoc(t, owner, docs, big.Id, "the document to wait", func(d apitypes.Document) bool {
		return d.Status == "pending" && d.ErrorCode == "ocr_daily_limit" && strings.Contains(d.ErrorMessage, "daily OCR page limit")
	})
	text := uploadOCR(t, owner, docs, "notes.md", []byte("# Notes\n\nOther documents keep flowing."))
	waitDoc(t, owner, docs, text.Id, "other documents to be indexed", func(d apitypes.Document) bool { return d.Status == "ready" })
	if d := getDoc(t, owner, docs, big.Id); d.Status != "pending" {
		t.Fatalf("the waiting document moved: %+v", d)
	}

	// Raising the limit wakes it.
	setTeamLimits(t, env.admin, env.team, map[string]any{"ocr_pages_per_day": 10})
	waitDoc(t, owner, docs, big.Id, "the document after the limit was raised", func(d apitypes.Document) bool {
		return d.Status == "ready" && d.Ocr != nil && len(d.Ocr.Pages) == 2
	})
	if it := teamLimit(t, owner, env.team, "ocr_pages_per_day"); it.Used == nil || *it.Used != 4 {
		t.Errorf("ocr_pages_per_day used = %+v", it.Used)
	}

	// Used up again: the next document waits until the day turns (here the
	// usage moves to yesterday and the wait ends now).
	setTeamLimits(t, env.admin, env.team, map[string]any{"ocr_pages_per_day": 4})
	next := uploadOCR(t, owner, docs, "tomorrow.pdf", scanned(t, "PAGE"))
	waitDoc(t, owner, docs, next.Id, "the next document to wait", func(d apitypes.Document) bool { return d.ErrorCode == "ocr_daily_limit" })
	ctx := context.Background()
	if _, err := env.app.Pool.Exec(ctx, "UPDATE usage_events SET occurred_at = occurred_at - interval '1 day' WHERE kind = 'ocr_pages'"); err != nil {
		t.Fatal(err)
	}
	if _, err := env.app.Pool.Exec(ctx, "UPDATE documents SET waiting_until = now() - interval '1 second' WHERE id = $1", next.Id); err != nil {
		t.Fatal(err)
	}
	waitDoc(t, owner, docs, next.Id, "the document on the next day", func(d apitypes.Document) bool { return d.Status == "ready" })

	// A document needing more pages than the whole limit reads what the
	// limit allows (it could never wait long enough), with a warning.
	setTeamLimits(t, env.admin, env.team, map[string]any{"ocr_pages_per_day": 1})
	if _, err := env.app.Pool.Exec(ctx, "UPDATE usage_events SET occurred_at = occurred_at - interval '1 day' WHERE kind = 'ocr_pages'"); err != nil {
		t.Fatal(err)
	}
	huge := uploadOCR(t, owner, docs, "huge.pdf", scanned(t, "PAGE ONE", "PAGE TWO"))
	waitDoc(t, owner, docs, huge.Id, "a document bigger than the limit", func(d apitypes.Document) bool {
		return d.Status == "ready" && d.Ocr != nil && len(d.Ocr.Pages) == 1 &&
			strings.Contains(strings.Join(d.Warnings, " "), "more than the team's daily OCR page limit")
	})

	// Blocked (0): documents are indexed without OCR, with a warning.
	setTeamLimits(t, env.admin, env.team, map[string]any{"ocr_pages_per_day": 0})
	mixed := uploadOCR(t, owner, docs, "mixed.pdf", scanned(t, "text:A typed page.", "PAGE"))
	waitDoc(t, owner, docs, mixed.Id, "a document while OCR is blocked", func(d apitypes.Document) bool {
		return d.Status == "ready" && d.Ocr == nil && strings.Contains(strings.Join(d.Warnings, " "), "OCR is blocked for this team")
	})
}

func TestOCRVisionBackend(t *testing.T) {
	env := newRAGEnv(t)
	owner, admin := env.owner, env.admin
	var conns []apitypes.Connection
	admin.get("/v1/admin/connections", &conns)
	var model apitypes.Model
	code, e := admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": conns[0].Id, "key": "vision", "upstreamModel": testutil.FakeVisionModel, "displayName": "Vision",
		"kind": "vision", "maxClassification": "open", "maxOutputTokens": 2000,
	}, &model, nil)
	mustCode(t, "vision model", code, e, 201, "")
	if model.Kind != "vision" {
		t.Fatalf("model = %+v", model)
	}
	var test apitypes.ModelTestResult
	code, e = admin.call("POST", "/v1/admin/models/"+model.Id.String()+"/test", nil, &test, nil)
	mustCode(t, "test model", code, e, 200, "")
	if !test.Ok || test.Reply == nil || *test.Reply != testutil.FakeTranscription(1000, 240) {
		t.Errorf("model test = %+v", test)
	}
	putParsing(t, admin, map[string]any{"ocrEnabled": true, "backend": "vision", "visionModelId": model.Id, "languages": "eng"})

	open := createOCRSource(t, owner, env.team, "Open scans", "open", nil)
	docs := "/v1/teams/" + env.team + "/sources/" + open.Id.String() + "/documents"
	d := uploadOCR(t, owner, docs, "scan.pdf", scanned(t, "PAGE ONE"))
	d = waitDoc(t, owner, docs, d.Id, "the vision-read document", func(d apitypes.Document) bool { return d.Status == "ready" })
	if d.Ocr == nil || d.Ocr.Backend != "vision" {
		t.Fatalf("document = %+v", d)
	}
	if text := passagesOf(t, owner, docs, d); !strings.Contains(text, "A page image of 2550 x") {
		t.Errorf("passages = %s", text)
	}
	var in, out int64
	var modelID uuid.UUID
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT
		coalesce(sum(quantity) FILTER (WHERE kind = 'vision_tokens_in'), 0), coalesce(sum(quantity) FILTER (WHERE kind = 'vision_tokens_out'), 0),
		(array_agg(model_id) FILTER (WHERE kind = 'vision_tokens_in'))[1] FROM usage_events`).Scan(&in, &out, &modelID)
	if in != 1000 || out == 0 || modelID != model.Id {
		t.Errorf("vision tokens in %d out %d model %s", in, out, modelID)
	}
	if pages, backend := ledger(t, env.app, "ocr_pages"); pages != 1 || backend != "vision" {
		t.Errorf("ocr_pages = %d (%s)", pages, backend)
	}

	// A source above the model's classification can't use it.
	sensitive := createOCRSource(t, owner, env.team, "Sensitive scans", "sensitive", nil)
	sdocs := "/v1/teams/" + env.team + "/sources/" + sensitive.Id.String() + "/documents"
	code, results, _ := owner.uploadFiles(sdocs, []upload{{"id.png", testutil.EncodeImage(t, "png", "ID CARD")}}, "")
	if code != 200 || results[0].Error == nil || results[0].Error.Code != "ocr_off" || !strings.Contains(results[0].Error.Message, "classification") {
		t.Fatalf("image above the model's classification = %+v", results)
	}
	calls := env.proxy.VisionRequests()
	s := uploadOCR(t, owner, sdocs, "scan.pdf", scanned(t, "PAGE"))
	waitDoc(t, owner, sdocs, s.Id, "the sensitive scan", func(d apitypes.Document) bool { return d.ErrorCode == "needs_ocr" })
	if env.proxy.VisionRequests() != calls {
		t.Error("a sensitive page was sent to a model approved only for open data")
	}
}
