package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Personal data scanning at ingest (B7, docs/pii-scanning.md): on by default, a flagged document is indexed with its
// kind, count and pages (never the matched text), an editor dismisses the flag, a classification to hold keeps a
// document out of the index until an editor approves it, and a review lasts while the findings are the same.
func TestPIIScanningAtIngest(t *testing.T) {
	env := newAgentEnv(t)
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	put := func(name, text string) apitypes.Document {
		t.Helper()
		if code, res, e := env.owner.uploadFiles(docs, []upload{{name, []byte(text)}}, ""); code != 200 || len(res) != 1 {
			t.Fatalf("upload %s = %d %s", name, code, e)
		}
		d, ok := byName(env.owner.waitForDocuments(t, docs))[name]
		if !ok {
			t.Fatalf("no document %s", name)
		}
		return d
	}
	review := func(s *session, d apitypes.Document, action string) (int, string, apitypes.Document) {
		var out apitypes.Document
		code, e := s.call("POST", docs+"/"+d.Id.String()+"/pii-review", map[string]any{"action": action}, &out, nil)
		return code, e, out
	}
	chunks := func(d apitypes.Document) int64 {
		return env.scalar(t, "SELECT count(*) FROM chunks WHERE document_id = $1", d.Id)
	}

	// On by default; auditors read, only platform admins change it.
	var set apitypes.PiiSettings
	if code := env.admin.get("/v1/admin/pii", &set); code != 200 || !set.Enabled || len(set.BlockLevels) != 0 || len(set.Patterns) != 0 {
		t.Fatalf("default settings %d %+v", code, set)
	}
	if code := env.auditor.get("/v1/admin/pii", nil); code != 200 {
		t.Fatalf("auditor read = %d", code)
	}
	if code, _ := env.auditor.call("PUT", "/v1/admin/pii", map[string]any{"enabled": false, "blockLevels": []string{}, "patterns": []any{}}, nil, ifMatch(set.Revision)); code != 403 {
		t.Fatalf("auditor write = %d", code)
	}

	// Flagged: indexed, with what was found and where, never the number itself.
	roster := put("roster.md", "# Roster\n\nAda Lovelace, SSN 345-67-8901, enrolled 2026.\n")
	if roster.Status != "ready" || roster.Pii == nil || roster.Pii.State != "flagged" || len(roster.Pii.Findings) != 1 ||
		roster.Pii.Findings[0].Kind != "us_ssn" || roster.Pii.Findings[0].Count != 1 || chunks(roster) == 0 {
		t.Fatalf("flagged document %+v pii %+v", roster, roster.Pii)
	}
	if !strings.Contains(strings.Join(roster.Warnings, " "), "1 possible US Social Security number") {
		t.Fatalf("warnings %v", roster.Warnings)
	}
	var src apitypes.DataSource
	env.owner.get(env.base+"/sources/"+env.upload.Id.String(), &src)
	var waiting apitypes.DocumentPage
	env.owner.get(docs+"?review=pii", &waiting)
	if src.Documents.PiiReview != 1 || len(waiting.Items) != 1 || waiting.Items[0].Id != roster.Id {
		t.Fatalf("review count %d, filtered %d", src.Documents.PiiReview, len(waiting.Items))
	}

	// Members cannot review; a flagged document is dismissed, not approved.
	if code, _, _ := review(env.member, roster, "dismiss"); code != 403 {
		t.Fatalf("member dismiss = %d", code)
	}
	code, e, _ := review(env.editor, roster, "approve")
	mustCode(t, "approve a flagged document", code, e, 409, "not_reviewable")
	code, e, dismissed := review(env.editor, roster, "dismiss")
	mustCode(t, "dismiss", code, e, 200, "")
	if dismissed.Pii.State != "dismissed" || dismissed.Pii.ReviewedAt == nil || strings.Contains(strings.Join(dismissed.Warnings, " "), "personal data") {
		t.Fatalf("dismissed %+v %v", dismissed.Pii, dismissed.Warnings)
	}

	// Hold Open documents; add the institution's ID format.
	env.admin.get("/v1/admin/pii", &set)
	bad := []map[string]any{
		{"enabled": true, "blockLevels": []string{"secret"}, "patterns": []any{}},
		{"enabled": true, "blockLevels": []string{}, "patterns": []any{map[string]any{"name": "Any", "pattern": `\d*`}}},
	}
	for i, body := range bad {
		if code, _ := env.admin.call("PUT", "/v1/admin/pii", body, nil, ifMatch(set.Revision)); code != 400 {
			t.Fatalf("invalid settings %d = %d", i, code)
		}
	}
	code, e = env.admin.call("PUT", "/v1/admin/pii", map[string]any{"enabled": true, "blockLevels": []string{"open"},
		"patterns": []any{map[string]any{"name": "Student ID", "pattern": `\bU\d{8}\b`}}}, &set, ifMatch(set.Revision))
	mustCode(t, "hold open documents", code, e, 200, "")

	// Held: not indexed, and nothing from it is searchable.
	ids := put("ids.md", "# Card office\n\nReplacement cards for U12345678 and U87654321 are ready.\n")
	if ids.Status != "skipped" || ids.ErrorCode != "pii_review" || ids.Pii == nil || ids.Pii.State != "held" ||
		ids.Pii.Findings[0].Kind != "Student ID" || ids.Pii.Findings[0].Count != 2 || chunks(ids) != 0 {
		t.Fatalf("held document %+v pii %+v", ids, ids.Pii)
	}
	code, e, _ = review(env.editor, ids, "dismiss")
	mustCode(t, "dismiss a held document", code, e, 409, "not_reviewable")
	code, e, _ = review(env.editor, ids, "approve")
	mustCode(t, "approve", code, e, 200, "")
	approved := byName(env.owner.waitForDocuments(t, docs))["ids.md"]
	if approved.Status != "ready" || approved.Pii.State != "approved" || chunks(approved) == 0 {
		t.Fatalf("approved %+v pii %+v", approved, approved.Pii)
	}

	// A review lasts while the findings are the same; new findings are reviewed again (and held now).
	same := put("roster.md", "# Roster\n\nAda Lovelace, SSN 345-67-8901, enrolled 2026 and graduated.\n")
	if same.Status != "ready" || same.Pii.State != "dismissed" {
		t.Fatalf("same findings %s %+v", same.Status, same.Pii)
	}
	more := put("roster.md", "# Roster\n\nAda Lovelace, SSN 345-67-8901.\nCharles Babbage, SSN 456-78-9012.\n")
	if more.Status != "skipped" || more.Pii.State != "held" || chunks(more) != 0 {
		t.Fatalf("new findings %s %+v", more.Status, more.Pii)
	}

	// Off: nothing is scanned.
	code, e = env.admin.call("PUT", "/v1/admin/pii", map[string]any{"enabled": false, "blockLevels": []string{"open"}, "patterns": []any{}}, &set, ifMatch(set.Revision))
	mustCode(t, "turn off", code, e, 200, "")
	if off := put("other.md", "# Other\n\nSSN 567-89-0123.\n"); off.Status != "ready" || off.Pii != nil {
		t.Fatalf("scanned while off: %+v", off.Pii)
	}

	// No match is stored or logged anywhere; the audit log has the reviews and the settings, by kind and count.
	for _, n := range []string{"345-67-8901", "456-78-9012", "U12345678"} {
		if c := env.scalar(t, "SELECT count(*) FROM documents WHERE metadata::text LIKE '%' || $1 || '%' OR warnings::text LIKE '%' || $1 || '%'", n); c != 0 {
			t.Fatalf("%s stored in a document's metadata", n)
		}
		if c := env.scalar(t, "SELECT count(*) FROM audit_log WHERE coalesce(metadata::text, '') || coalesce(before_state::text, '') || coalesce(after_state::text, '') LIKE '%' || $1 || '%'", n); c != 0 {
			t.Fatalf("%s in the audit log", n)
		}
	}
	if env.scalar(t, `SELECT count(*) FROM audit_log WHERE action IN ('document.pii_dismiss', 'document.pii_approve')`) != 2 ||
		env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.pii' AND strpos(after_state::text, '{8}') = 0`) != 2 {
		t.Fatal("reviews and settings changes are not audited as expected")
	}
}
