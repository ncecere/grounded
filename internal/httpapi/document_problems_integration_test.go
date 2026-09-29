package httpapi_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Admins and failed documents (owner decision 3 of docs/v0.2.0.md §7):
// Admin -> Parsing & OCR lists documents that failed or need OCR by team,
// source and reason with counts and dates but no names or text; Retry these
// respects OCR; Notify owners reaches the team's owners with a link to the
// filtered documents. Auditors read; nothing names a document.

// docMarker is in every file name and document text of the test: it must
// never reach a platform admin, the audit log's metadata or a notification.
const docMarker = "Marmoset"

func problemGroups(t *testing.T, s *session) ([]apitypes.DocumentProblemGroup, string) {
	t.Helper()
	code, raw := s.raw("GET", "/v1/admin/parsing/document-problems", nil, nil)
	if code != 200 {
		t.Fatalf("document problems = %d %s", code, raw)
	}
	var out struct {
		Data apitypes.DocumentProblemList `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out.Data.Items, string(raw)
}

func groupOf(groups []apitypes.DocumentProblemGroup, reason apitypes.DocumentProblemReason) *apitypes.DocumentProblemGroup {
	for i := range groups {
		if groups[i].Reason == reason {
			return &groups[i]
		}
	}
	return nil
}

func TestDocumentProblemsForAdmins(t *testing.T) {
	env, _ := ocrEnv(t)
	owner, admin, base := env.owner, env.admin, "/v1/teams/"+env.team
	auditor := env.app.signIn("auditor")
	src := createOCRSource(t, owner, env.team, "Scanned forms", "open", nil)
	docs := base + "/sources/" + src.Id.String() + "/documents"
	code, results, e := owner.uploadFiles(docs, []upload{
		{docMarker + "-scan.pdf", scanned(t, "PAGE ONE")},
		{docMarker + "-broken.pdf", []byte("%PDF-1.7 " + docMarker + " is not really a PDF")},
		{docMarker + "-notes.md", []byte("# " + docMarker + " notes\n\nThe office opens at nine.\n")},
	}, "")
	if code != 200 || results[0].Status != "created" || results[1].Status != "created" {
		t.Fatalf("upload = %d %s %+v", code, e, results)
	}
	got := byName(owner.waitForDocuments(t, docs))
	if got[docMarker+"-scan.pdf"].ErrorCode != "needs_ocr" || got[docMarker+"-broken.pdf"].Status != "failed" || got[docMarker+"-notes.md"].Status != "ready" {
		t.Fatalf("documents = %+v", got)
	}

	// The list: counts per reason, the oldest date, OCR's state; no names.
	groups, raw := problemGroups(t, admin)
	scans, broken := groupOf(groups, "needs_ocr"), groupOf(groups, "damaged")
	if len(groups) != 2 || scans == nil || broken == nil || scans.Documents != 1 || broken.Documents != 1 || scans.SourceName != "Scanned forms" ||
		scans.TeamSlug != env.team || scans.TeamId == nil || scans.OcrState != "platform_off" || scans.OldestAt.IsZero() {
		t.Fatalf("groups = %+v", groups)
	}
	if strings.Contains(strings.ToLower(raw), strings.ToLower(docMarker)) {
		t.Fatalf("the list names a document: %s", raw)
	}
	if _, raw := problemGroups(t, auditor); strings.Contains(strings.ToLower(raw), strings.ToLower(docMarker)) {
		t.Fatalf("the auditor's list names a document: %s", raw)
	}
	for who, s := range map[string]*session{"team owner": owner} {
		if code, _ := s.raw("GET", "/v1/admin/parsing/document-problems", nil, nil); code != 403 {
			t.Errorf("%s read the list: %d", who, code)
		}
	}
	action := func(s *session, what, reason string, out any) (int, string) {
		return s.call("POST", "/v1/admin/parsing/document-problems/"+what, map[string]any{"sourceId": src.Id, "reason": reason}, out, nil)
	}
	for _, what := range []string{"retry", "notify"} {
		if code, e := action(auditor, what, "needs_ocr", nil); code != 403 {
			t.Errorf("an auditor's %s = %d %s", what, code, e)
		}
		if code, e := action(owner, what, "needs_ocr", nil); code != 403 {
			t.Errorf("a team owner's admin %s = %d %s", what, code, e)
		}
	}
	code, e = action(admin, "retry", "sideways", nil)
	mustCode(t, "an unknown reason", code, e, 400, "invalid_reason")

	// Retry these respects OCR: with it off, nothing is queued, and it says why.
	code, raw2 := admin.raw("POST", "/v1/admin/parsing/document-problems/retry", map[string]any{"sourceId": src.Id, "reason": "needs_ocr"}, nil)
	if code != 409 || !strings.Contains(string(raw2), "ocr_off") || !strings.Contains(string(raw2), "OCR is off for the platform") {
		t.Fatalf("retry with OCR off = %d %s", code, raw2)
	}

	// Notify owners: the owners get a notification with the count and a link to the filtered documents.
	var told apitypes.DocumentProblemNotifyResult
	code, e = action(admin, "notify", "needs_ocr", &told)
	mustCode(t, "notify", code, e, 200, "")
	if told.Owners != 1 || told.Documents != 1 {
		t.Fatalf("notified = %+v", told)
	}
	checkAttentionNotice(t, env, src.Id.String())
	code, e = action(admin, "notify", "other", nil)
	mustCode(t, "nothing to report", code, e, 409, "no_documents")

	// OCR on: the scanned document is queued and read; the damaged one is retried on request.
	putParsing(t, admin, map[string]any{"ocrEnabled": true, "backend": "tesseract", "visionModelId": nil, "languages": "eng"})
	var retried apitypes.DocumentRetryResult
	code, e = action(admin, "retry", "needs_ocr", &retried)
	mustCode(t, "retry", code, e, 200, "")
	if retried.Retried != 1 {
		t.Fatalf("retried = %+v", retried)
	}
	waitDoc(t, owner, docs, got[docMarker+"-scan.pdf"].Id, "the scan read with OCR", func(d apitypes.Document) bool { return d.Status == "ready" })
	if groups, _ := problemGroups(t, admin); len(groups) != 1 || groups[0].Reason != "damaged" || groups[0].OcrState != "on" {
		t.Fatalf("groups after the retry = %+v", groups)
	}
	checkProblemAudit(t, env)
}

// checkAttentionNotice: the owner's notification counts, links to the
// source's documents filtered to Needs OCR, and names no document.
func checkAttentionNotice(t *testing.T, env *ragEnv, sourceID string) {
	t.Helper()
	page := inbox(t, env.owner, nil)
	for _, n := range page.Items {
		if n.Type != "source.documents_attention" {
			continue
		}
		if !strings.Contains(n.Title, "1 document in Scanned forms needs attention") ||
			n.Link != "/teams/"+env.team+"/sources/"+sourceID+"?status=needs_ocr&tab=documents" {
			t.Fatalf("notification = %+v", n)
		}
		if strings.Contains(strings.ToLower(n.Title+n.Body), strings.ToLower(docMarker)) {
			t.Fatalf("the notification names a document: %+v", n)
		}
		return
	}
	t.Fatalf("no documents notification in %+v", page.Items)
}

// checkProblemAudit: both actions are audited as platform actions with
// counts, and no entry names a document.
func checkProblemAudit(t *testing.T, env *ragEnv) {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(),
		`SELECT action, metadata::text FROM audit_log WHERE action IN ('platform.documents_retry', 'platform.document_owners_notify') ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var actions []string
	for rows.Next() {
		var action, meta string
		if err := rows.Scan(&action, &meta); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(meta, `"count": 1`) || strings.Contains(strings.ToLower(meta), strings.ToLower(docMarker)) {
			t.Errorf("%s metadata = %s", action, meta)
		}
		actions = append(actions, action)
	}
	if strings.Join(actions, ",") != "platform.document_owners_notify,platform.documents_retry" {
		t.Fatalf("audited = %v", actions)
	}
}
