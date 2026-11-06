package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Restricting a source by hand (docs/document-permissions.md): the platform switch gates it; every document follows at
// once and new ones get it; making the source unrestricted clears them; the switch can't be turned off while anything is
// restricted; each change is audited.

func (env *accessEnv) switchDocumentAccess(t *testing.T, on bool) (int, string) {
	t.Helper()
	var cur apitypes.DocumentAccessSettings
	if code := env.admin.get("/v1/admin/document-access", &cur); code != 200 {
		t.Fatalf("get document access = %d", code)
	}
	return env.admin.call("PUT", "/v1/admin/document-access", map[string]any{"enabled": on}, nil, ifMatch(cur.Revision))
}

func (env *accessEnv) setSourceAccess(t *testing.T, s *session, principals any) (apitypes.DataSource, int, string) {
	t.Helper()
	var src, out apitypes.DataSource
	path := env.base + "/sources/" + env.upload.Id.String()
	s.get(path, &src)
	code, e := s.call("PUT", path+"/access", map[string]any{"principals": principals}, &out, ifMatch(src.Revision))
	return out, code, e
}

func (env *accessEnv) restrictedDocuments(t *testing.T) map[string]bool {
	t.Helper()
	var page struct {
		Items []apitypes.Document `json:"items"`
	}
	env.owner.get(env.base+"/sources/"+env.upload.Id.String()+"/documents", &page)
	out := map[string]bool{}
	for _, d := range page.Items {
		out[d.Filename] = d.Restricted != nil && *d.Restricted
	}
	return out
}

func TestDocumentAccessSwitchAndSourceRestriction(t *testing.T) {
	env := &accessEnv{publishEnv: newPublishEnv(t)}
	var st apitypes.DocumentAccessSettings
	if code := env.auditor.get("/v1/admin/document-access", &st); code != 200 || st.Enabled || st.RestrictedDocuments != 0 {
		t.Fatalf("defaults as seen by the auditor = %d %+v", code, st)
	}

	// Off: restricting is refused; making a source unrestricted is always allowed.
	if _, code, e := env.setSourceAccess(t, env.editor, []string{"group:parking-office"}); code != 409 || e != "document_permissions_off" {
		t.Fatalf("restrict while off = %d %s", code, e)
	}
	code, e := env.switchDocumentAccess(t, true)
	mustCode(t, "turn on", code, e, 200, "")

	// Members can't; invalid principals are refused.
	if _, code, _ := env.setSourceAccess(t, env.member, []string{"group:parking-office"}); code != 403 {
		t.Errorf("a member restricting = %d", code)
	}
	for _, bad := range [][]string{{}, {"parking-office"}, {"user:not-a-uuid"}, {"email:nobody"}, {"role:admin"}} {
		if _, code, e := env.setSourceAccess(t, env.editor, bad); code != 400 || e != "invalid_access" {
			t.Errorf("restrict to %v = %d %s", bad, code, e)
		}
	}

	src, code, e := env.setSourceAccess(t, env.editor, []string{" group:Parking-Office ", "email:Ana@Example.edu", "group:parking-office"})
	mustCode(t, "restrict", code, e, 200, "")
	if src.Access == nil || !src.Access.Restricted || strings.Join(src.Access.Principals, ",") != "group:parking-office,email:ana@example.edu" {
		t.Fatalf("source access = %+v", src.Access)
	}
	for name, restricted := range env.restrictedDocuments(t) {
		if !restricted {
			t.Errorf("%s is not restricted with its source", name)
		}
	}
	// A document added afterwards gets the restriction.
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	env.owner.uploadFiles(docs, []upload{{"later.md", []byte("# Later\n\nThe shuttle runs every twenty minutes.\n")}}, "")
	env.owner.waitForDocuments(t, docs)
	if !env.restrictedDocuments(t)["later.md"] {
		t.Error("a document added to a restricted source is unrestricted")
	}
	if code, e := env.switchDocumentAccess(t, false); code != 409 || e != "documents_restricted" {
		t.Errorf("turning off with restricted documents = %d %s", code, e)
	}

	// The group picker offers groups seen at sign-in.
	env.setGroups(t, env.member, "parking-office", "payroll")
	var groups []string
	if code := env.editor.get(env.base+"/access/groups?prefix=par", &groups); code != 200 || strings.Join(groups, ",") != "parking-office" {
		t.Errorf("known groups = %d %v", code, groups)
	}
	if code := env.member.get(env.base+"/access/groups", &groups); code != 403 {
		t.Errorf("a member's known groups = %d", code)
	}

	// Unrestricted again: every document follows; the switch can then go off.
	src, code, e = env.setSourceAccess(t, env.editor, nil)
	mustCode(t, "unrestrict", code, e, 200, "")
	if src.Access == nil || src.Access.Restricted || len(src.Access.Principals) != 0 {
		t.Fatalf("source access after clearing = %+v", src.Access)
	}
	for name, restricted := range env.restrictedDocuments(t) {
		if restricted {
			t.Errorf("%s is still restricted", name)
		}
	}
	code, e = env.switchDocumentAccess(t, false)
	mustCode(t, "turn off", code, e, 200, "")

	// Audited: the switch twice on and off, the restriction and its removal.
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'source.access_update' AND target_id = $1`, env.upload.Id.String()); n != 2 {
		t.Errorf("source.access_update entries = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.document_permissions'`); n != 2 {
		t.Errorf("platform.document_permissions entries = %d", n)
	}
}
