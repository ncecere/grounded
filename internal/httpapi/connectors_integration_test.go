package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/connector/connectortest"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/sourcesync"
	"github.com/ncecere/grounded/internal/testutil"
)

// The connector runtime (ADR-0035, #258; docs/source-types.md), exercised through the API with an in-memory provider
// (internal/connector/connectortest). These tests are the conformance a connector's own tests repeat against its
// recorded provider: adding, changing, renaming, moving and deleting items; credentials that are never shown; the hold
// on large removals; failures, cancelling and resuming; team limits; and document permissions.

func init() { connectortest.Register() }

type connectorEnv struct {
	*accessEnv
	p *connectortest.Provider
}

// newConnectorEnv turns both test types on, lets "open" data live in them, and turns document permissions on.
func newConnectorEnv(t *testing.T) *connectorEnv {
	t.Helper()
	env := &connectorEnv{accessEnv: &accessEnv{publishEnv: newPublishEnv(t)}, p: connectortest.NewProvider()}
	t.Cleanup(env.p.Close)
	env.app.Svc.Connectors.RetryDelay = func(int) time.Duration { return 200 * time.Millisecond }
	for _, typ := range []string{connectortest.TypeDrive, connectortest.TypeBucket} {
		code, e := env.admin.call("PUT", "/v1/admin/source-types/"+typ, map[string]any{"enabled": true}, nil, nil)
		mustCode(t, "turn on "+typ, code, e, 200, "")
	}
	var levels []apitypes.Classification
	env.admin.get("/v1/classifications", &levels)
	for _, l := range levels {
		code, e := env.admin.call("PATCH", "/v1/admin/classifications/"+l.Key, map[string]any{
			"allowedSourceTypes": []string{"upload", "web", connectortest.TypeDrive, connectortest.TypeBucket}}, nil, ifMatch(l.Revision))
		mustCode(t, "allow the test types at "+l.Key, code, e, 200, "")
	}
	code, e := env.switchDocumentAccess(t, true)
	mustCode(t, "document permissions on", code, e, 200, "")
	return env
}

func (env *connectorEnv) settings(extra map[string]any) map[string]any {
	cfg := map[string]any{"tenant": env.p.Tenant}
	for k, v := range extra {
		cfg[k] = v
	}
	return map[string]any{"config": cfg, "credentials": map[string]string{"token": env.p.Token}}
}

// create makes a connector source and waits for its first sync.
func (env *connectorEnv) create(t *testing.T, typ, name string, extra map[string]any) apitypes.DataSource {
	t.Helper()
	var src apitypes.DataSource
	code, e := env.editor.call("POST", env.base+"/sources", map[string]any{"name": name, "type": typ, "classification": "open",
		"connector": env.settings(extra)}, &src, nil)
	mustCode(t, "create "+name, code, e, 201, "")
	if src.Connector == nil || src.ActiveSync == nil || src.ActiveSync.Trigger != "create" || !src.ActiveSync.Full {
		t.Fatalf("a new connector source starts a full sync: %+v", src)
	}
	env.waitSync(t, src.Id.String())
	return src
}

func (env *connectorEnv) path(id string) string { return env.base + "/sources/" + id }

// waitSync waits for the source's active sync to end and its documents to be processed, and returns its latest sync.
func (env *connectorEnv) waitSync(t *testing.T, id string) apitypes.SourceSync {
	t.Helper()
	deadline := time.Now().Add(testutil.Scale(45 * time.Second))
	for {
		var src apitypes.DataSource
		if code := env.editor.get(env.path(id), &src); code != 200 {
			t.Fatalf("get source = %d", code)
		}
		if src.ActiveSync == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("sync still active: %+v", src.ActiveSync)
		}
		time.Sleep(100 * time.Millisecond)
	}
	env.editor.waitForDocuments(t, env.path(id)+"/documents")
	return env.syncs(t, id)[0]
}

func (env *connectorEnv) syncs(t *testing.T, id string) []apitypes.SourceSync {
	t.Helper()
	var list []apitypes.SourceSync
	if code := env.editor.get(env.path(id)+"/syncs", &list); code != 200 || len(list) == 0 {
		t.Fatalf("list syncs = %d %+v", code, list)
	}
	return list
}

// sync starts a sync and waits for it.
func (env *connectorEnv) sync(t *testing.T, id string, full bool) apitypes.SourceSync {
	t.Helper()
	var run apitypes.SourceSync
	code, e := env.editor.call("POST", env.path(id)+"/syncs", map[string]any{"full": full}, &run, nil)
	mustCode(t, "start sync", code, e, 202, "")
	done := env.waitSync(t, id)
	if done.Id != run.Id {
		t.Fatalf("the latest sync is %s, started %s", done.Id, run.Id)
	}
	return done
}

func (env *connectorEnv) documents(t *testing.T, id string) map[string]apitypes.Document {
	t.Helper()
	out := map[string]apitypes.Document{}
	for _, d := range env.editor.waitForDocuments(t, env.path(id)+"/documents") {
		out[d.Filename] = d
	}
	return out
}

func counts(s apitypes.SourceSync) string {
	return fmt.Sprintf("added=%d changed=%d unchanged=%d skipped=%d removed=%d permissions=%d complete=%v status=%s",
		s.ItemsAdded, s.ItemsChanged, s.ItemsUnchanged, s.ItemsSkipped, s.ItemsRemoved, s.PermissionsChanged, s.Complete, s.Status)
}

func TestConnectorSyncAddsChangesRenamesAndRemoves(t *testing.T) {
	env := newConnectorEnv(t)
	p := env.p
	p.Put("f1", "handbook/leave.md", "# Leave\n\nStaff accrue annual leave each month.\n", nil)
	p.Put("f2", "handbook/travel.md", "# Travel\n\nBook travel through the travel office.\n", nil)
	p.Put("f3", "handbook/expenses.md", "# Expenses\n\nSubmit receipts within thirty days.\n", nil)
	p.Put("f4", "handbook/logo.png", "not really an image", nil)
	p.Put("f5", "other/notes.md", "# Notes\n\nOutside the folder this source indexes.\n", nil)
	src := env.create(t, connectortest.TypeBucket, "Staff handbook", map[string]any{"folder": "handbook"})
	id := src.Id.String()

	first := env.syncs(t, id)[0]
	if got := counts(first); got != "added=3 changed=0 unchanged=0 skipped=1 removed=0 permissions=0 complete=true status=completed" {
		t.Fatalf("first sync: %s", got)
	}
	if len(first.Problems) != 1 || first.Problems[0].Title != "logo.png" || !strings.Contains(first.Problems[0].Reason, "not indexed") {
		t.Errorf("the skipped file is listed with its reason: %+v", first.Problems)
	}
	docs := env.documents(t, id)
	leave := docs["leave.md"]
	if len(docs) != 3 || leave.Status != "ready" || leave.Title != "Leave" || leave.Url != "https://files.example.org/"+p.Tenant+"/f1" || leave.Version != 1 {
		t.Fatalf("documents after the first sync: %+v", docs)
	}
	if p.Opens() != 3 {
		t.Errorf("the first sync read %d files, want 3", p.Opens())
	}

	// Nothing changed: nothing is read again.
	if got := counts(env.sync(t, id, false)); got != "added=0 changed=0 unchanged=0 skipped=0 removed=0 permissions=0 complete=false status=completed" {
		t.Errorf("a sync with nothing new: %s", got)
	}
	if got := counts(env.sync(t, id, true)); got != "added=0 changed=0 unchanged=3 skipped=1 removed=0 permissions=0 complete=true status=completed" || p.Opens() != 3 {
		t.Errorf("a full sync with nothing new: %s, %d reads", got, p.Opens())
	}

	// An edit is a new version of the same document; a rename keeps the document and reads nothing.
	p.Put("f1", "handbook/leave.md", "# Leave\n\nStaff accrue annual leave each fortnight.\n", nil)
	p.Rename("f2", "handbook/travel-and-fleet.md")
	if got := counts(env.sync(t, id, false)); got != "added=0 changed=1 unchanged=1 skipped=0 removed=0 permissions=0 complete=false status=completed" {
		t.Errorf("an edit and a rename: %s", got)
	}
	docs = env.documents(t, id)
	if d := docs["leave.md"]; d.Id != leave.Id || d.Version != 2 || d.Status != "ready" {
		t.Errorf("the edited document: %+v", d)
	}
	if d, old := docs["travel-and-fleet.md"], docs["travel.md"]; d.Title != "travel-and-fleet" || d.Version != 1 || old.Filename != "" || p.Opens() != 4 {
		t.Errorf("the renamed document keeps its identity and is not read again: %+v, %d reads", d, p.Opens())
	}

	// Deleted in the provider, and moved out of the folder: both go, and the rest stays.
	p.Delete("f3")
	p.Rename("f2", "archive/travel.md")
	if got := counts(env.sync(t, id, false)); got != "added=0 changed=0 unchanged=0 skipped=0 removed=2 permissions=0 complete=false status=completed" {
		t.Errorf("a deletion and a move out of the folder: %s", got)
	}
	if docs = env.documents(t, id); len(docs) != 1 || docs["leave.md"].Id != leave.Id {
		t.Errorf("documents after the removals: %+v", docs)
	}
	var after apitypes.DataSource
	env.editor.get(env.path(id), &after)
	if after.LastSyncAt == nil || after.NextSyncAt != nil || after.Connector.Schedule != "manual" || after.Connector.LastCompleteAt == nil {
		t.Errorf("the source after its syncs: lastSync=%v nextSync=%v connector=%+v", after.LastSyncAt, after.NextSyncAt, after.Connector)
	}
}

func TestConnectorCredentialsAreNeverShown(t *testing.T) {
	env := newConnectorEnv(t)
	p := env.p
	p.Put("f1", "a.md", "# A\n\nOne.\n", nil)

	// Missing, unknown and refused credentials.
	post := func(creds map[string]string) (int, string) {
		return env.editor.call("POST", env.base+"/sources", map[string]any{"name": "Bad", "type": connectortest.TypeBucket, "classification": "open",
			"connector": map[string]any{"config": map[string]any{"tenant": p.Tenant}, "credentials": creds}}, nil, nil)
	}
	code, e := post(map[string]string{})
	mustCode(t, "no token", code, e, 400, "credentials_missing")
	code, e = post(map[string]string{"token": p.Token, "password": "x"})
	mustCode(t, "unknown credential", code, e, 400, "invalid_credentials")
	code, e = env.editor.call("POST", env.base+"/sources", map[string]any{"name": "Bad", "type": connectortest.TypeBucket, "classification": "open",
		"connector": map[string]any{"config": map[string]any{"tenant": p.Tenant, "depth": 3}, "credentials": map[string]string{"token": p.Token}}}, nil, nil)
	mustCode(t, "unknown setting", code, e, 400, "invalid_config")

	// Testing a connection before the source exists: who the credential is, what it reaches, and a refusal.
	var check apitypes.ConnectionCheck
	code, e = env.editor.call("POST", env.base+"/source-types/"+connectortest.TypeBucket+"/check", env.settings(nil), &check, nil)
	mustCode(t, "check before creating", code, e, 200, "")
	if !strings.Contains(check.Summary, p.Tenant) {
		t.Errorf("check = %+v", check)
	}
	wrong := "wrong-token-" + p.Token[:8]
	code, raw := env.editor.raw("POST", env.base+"/source-types/"+connectortest.TypeBucket+"/check",
		map[string]any{"config": map[string]any{"tenant": p.Tenant}, "credentials": map[string]string{"token": wrong}}, nil)
	if code != 422 || !strings.Contains(string(raw), "credentials_refused") || strings.Contains(string(raw), wrong) {
		t.Errorf("a refused credential = %d %s", code, raw)
	}
	if code, _ := env.member.call("POST", env.base+"/source-types/"+connectortest.TypeBucket+"/check", env.settings(nil), nil, nil); code != 403 {
		t.Errorf("a member testing a connection = %d", code)
	}

	src := env.create(t, connectortest.TypeBucket, "Files", nil)
	id := src.Id.String()
	if !slices.Equal(src.Connector.CredentialKeys, []string{"token"}) || src.Connector.CredentialsSetAt == nil {
		t.Errorf("the source says which credentials are stored: %+v", src.Connector)
	}

	// The provider rotates its token: the next sync fails once, with a message and without retries.
	old := p.Token
	p.Token = "tok-rotated-" + old[4:12]
	before := p.Syncs()
	failed := env.sync(t, id, false)
	if failed.Status != "failed" || !strings.Contains(failed.Error, "refused the credentials") || p.Syncs() != before {
		t.Errorf("a sync with a refused credential: %s %q, provider syncs %d -> %d", failed.Status, failed.Error, before, p.Syncs())
	}
	code, e = env.editor.call("POST", env.path(id)+"/connector/check", nil, nil, nil)
	mustCode(t, "check with the stored, refused credential", code, e, 422, "credentials_refused")
	code, e = env.editor.call("POST", env.path(id)+"/connector/check", map[string]any{"credentials": map[string]string{"token": p.Token}}, nil, nil)
	mustCode(t, "check with a new credential before saving it", code, e, 200, "")

	// Entering the new one needs the revision, makes a new one, and makes the next sync list everything again.
	var cur, saved apitypes.DataSource
	env.editor.get(env.path(id), &cur)
	body := map[string]any{"credentials": map[string]string{"token": p.Token, "account": "svc-grounded"}}
	if code, _ := env.editor.call("PUT", env.path(id)+"/connector", body, nil, nil); code != 428 {
		t.Errorf("without If-Match = %d", code)
	}
	if code, _ := env.member.call("PUT", env.path(id)+"/connector", body, nil, ifMatch(cur.Revision)); code != 403 {
		t.Errorf("a member changing credentials = %d", code)
	}
	code, e = env.editor.call("PUT", env.path(id)+"/connector", body, &saved, ifMatch(cur.Revision))
	mustCode(t, "new credentials", code, e, 200, "")
	if saved.Revision != cur.Revision+1 || !slices.Equal(saved.Connector.CredentialKeys, []string{"token", "account"}) {
		t.Errorf("after new credentials: revision %d -> %d, keys %v", cur.Revision, saved.Revision, saved.Connector.CredentialKeys)
	}
	if got := env.sync(t, id, false); got.Status != "completed" || !got.Complete || got.ItemsUnchanged != 1 {
		t.Errorf("the sync after new credentials lists everything: %s", counts(got))
	}
	// An empty value removes a credential; removing a required one is refused.
	code, e = env.editor.call("PUT", env.path(id)+"/connector", map[string]any{"credentials": map[string]string{"account": ""}}, &saved, ifMatch(saved.Revision))
	mustCode(t, "remove an optional credential", code, e, 200, "")
	if !slices.Equal(saved.Connector.CredentialKeys, []string{"token"}) {
		t.Errorf("keys after removing one = %v", saved.Connector.CredentialKeys)
	}
	code, e = env.editor.call("PUT", env.path(id)+"/connector", map[string]any{"credentials": map[string]string{"token": ""}}, nil, ifMatch(saved.Revision))
	mustCode(t, "remove a required credential", code, e, 400, "credentials_missing")

	// No response, audit entry or stored row holds a credential in the clear.
	for _, secret := range []string{old, p.Token, "svc-grounded"} {
		for _, path := range []string{env.path(id), env.base + "/sources", env.path(id) + "/syncs", "/v1/source-types"} {
			if _, raw := env.editor.raw("GET", path, nil, nil); strings.Contains(string(raw), secret) {
				t.Errorf("GET %s shows a credential", path)
			}
		}
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE (to_jsonb(audit_log.*))::text LIKE '%' || $1 || '%'`, secret); n != 0 {
			t.Errorf("%d audit entries hold a credential", n)
		}
		if n := env.scalar(t, `SELECT count(*) FROM source_connectors WHERE convert_from(credentials_cipher, 'LATIN1') LIKE '%' || $1 || '%'`, secret); n != 0 {
			t.Error("a credential is stored in the clear")
		}
		if n := env.scalar(t, `SELECT count(*) FROM source_syncs WHERE error LIKE '%' || $1 || '%'`, secret); n != 0 {
			t.Error("a sync's error holds a credential")
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'source.connector_update' AND metadata->>'credentials' = 'true'`); n != 2 {
		t.Errorf("source.connector_update entries = %d", n)
	}
}

func TestConnectorHoldsLargeRemovals(t *testing.T) {
	env := newConnectorEnv(t)
	p := env.p
	for i := 0; i < 30; i++ {
		p.Put(fmt.Sprintf("f%02d", i), fmt.Sprintf("policy-%02d.md", i), fmt.Sprintf("# Policy %d\n\nRule number %d applies.\n", i, i), nil)
	}
	src := env.create(t, connectortest.TypeBucket, "Policies", nil)
	id := src.Id.String()

	// The provider answers a full listing with nothing (a revoked permission, a wrong folder): nothing is removed.
	p.HideAll(true)
	held := env.sync(t, id, true)
	if held.Status != "completed" || held.Removals != "pending" || held.RemovalsPending != 30 || held.ItemsRemoved != 0 || !strings.Contains(held.RemovalsReason, "empty the source") {
		t.Fatalf("a listing that came back empty: %+v", held)
	}
	if n := len(env.documents(t, id)); n != 30 {
		t.Fatalf("%d documents after the held sync, want 30", n)
	}
	var cur apitypes.DataSource
	env.editor.get(env.path(id), &cur)
	if cur.HeldSync == nil || cur.HeldSync.Id != held.Id {
		t.Errorf("the source shows the held sync: %+v", cur.HeldSync)
	}
	var rem apitypes.SyncRemovals
	path := env.path(id) + "/syncs/" + held.Id.String() + "/removals"
	if code := env.editor.get(path, &rem); code != 200 || len(rem.Documents) != 30 || rem.Documents[0].Filename != "policy-00.md" {
		t.Errorf("held removals = %d %d documents", code, len(rem.Documents))
	}
	if code, _ := env.member.call("POST", path, map[string]any{"confirm": true}, nil, nil); code != 403 {
		t.Errorf("a member confirming removals = %d", code)
	}
	// Dismissed: the documents stay, and the decision can't be made twice.
	var out apitypes.SourceSync
	code, e := env.editor.call("POST", path, map[string]any{"confirm": false}, &out, nil)
	mustCode(t, "dismiss", code, e, 200, "")
	if out.Removals != "dismissed" || out.RemovalsPending != 0 || len(env.documents(t, id)) != 30 {
		t.Errorf("after dismissing: %+v", out)
	}
	code, e = env.editor.call("POST", path, map[string]any{"confirm": true}, nil, nil)
	mustCode(t, "decide twice", code, e, 409, "removals_decided")

	// The provider is back. Removing 2 of 30 is ordinary; removing 12 of the remaining 28 is held; a later sync
	// supersedes an undecided hold; confirming removes.
	p.HideAll(false)
	p.Delete("f00")
	p.Delete("f01")
	if got := env.sync(t, id, true); got.ItemsRemoved != 2 || got.Removals != "" {
		t.Errorf("a small removal: %+v", got)
	}
	for i := 2; i < 14; i++ {
		p.Delete(fmt.Sprintf("f%02d", i))
	}
	big := env.sync(t, id, false)
	if big.Removals != "pending" || big.RemovalsPending != 12 || !strings.Contains(big.RemovalsReason, "12 of this source's 28") {
		t.Fatalf("a large removal from the change feed: %+v", big)
	}
	again := env.sync(t, id, true)
	if again.Removals != "pending" || again.RemovalsPending != 12 || env.syncs(t, id)[1].Removals != "superseded" {
		t.Fatalf("a later sync decides again: %+v, earlier %s", again, env.syncs(t, id)[1].Removals)
	}
	code, e = env.editor.call("POST", env.path(id)+"/syncs/"+again.Id.String()+"/removals", map[string]any{"confirm": true}, &out, nil)
	mustCode(t, "confirm", code, e, 200, "")
	if out.Removals != "confirmed" || out.ItemsRemoved != 12 || len(env.documents(t, id)) != 16 {
		t.Errorf("after confirming: %+v, %d documents", out, len(env.documents(t, id)))
	}
	for _, action := range []string{"source.removals_dismiss", "source.removals_confirm"} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1`, action); n != 1 {
			t.Errorf("%s entries = %d", action, n)
		}
	}
}

func TestConnectorSyncFailsRetriesResumesAndCancels(t *testing.T) {
	env := newConnectorEnv(t)
	p := env.p
	for i := 0; i < 8; i++ {
		p.Put(fmt.Sprintf("f%d", i), fmt.Sprintf("note-%d.md", i), fmt.Sprintf("# Note %d\n\nBody of note %d.\n", i, i), nil)
	}
	// The first sync checkpoints every 2 items and fails halfway, once: the retry continues from its checkpoint, and the
	// listing still counts as complete because it is the same sync.
	p.CheckpointEvery(2)
	p.FailSyncs(1, connectortest.ErrOutage)
	src := env.create(t, connectortest.TypeBucket, "Notes", nil)
	id := src.Id.String()
	first := env.syncs(t, id)[0]
	if first.Status != "completed" || !first.Complete || first.ItemsAdded != 8 || first.ItemsRemoved != 0 || first.Removals != "" {
		t.Fatalf("a sync that failed once and was retried: %+v", first)
	}
	if got := p.Resumed(); len(got) != 1 || !strings.Contains(strings.ReplaceAll(string(got[0]), " ", ""), `"listing":4`) {
		t.Errorf("the retry started from the checkpoint: %s", got)
	}
	if len(env.documents(t, id)) != 8 {
		t.Errorf("documents after the retried sync = %d", len(env.documents(t, id)))
	}

	// A provider that stays down: the sync fails after its attempts, removes nothing, and keeps its cursor.
	p.Delete("f0")
	p.FailSyncs(10, connectortest.ErrOutage)
	failed := env.sync(t, id, true)
	if failed.Status != "failed" || !strings.Contains(failed.Error, "unavailable") || failed.ItemsRemoved != 0 || len(env.documents(t, id)) != 8 {
		t.Fatalf("a sync that kept failing: %+v", failed)
	}
	p.FailSyncs(0, nil)

	// Cancelled while running: what it added stays, nothing is removed, and the next sync finishes the work.
	p.Put("f8", "note-8.md", "# Note 8\n\nAdded later.\n", nil)
	p.Put("f9", "note-9.md", "# Note 9\n\nAdded later.\n", nil)
	started, release := make(chan struct{}), make(chan struct{})
	p.OnItem(func(n int) {
		if n == 2 {
			close(started)
			<-release
		}
	})
	var run apitypes.SourceSync
	code, e := env.editor.call("POST", env.path(id)+"/syncs", map[string]any{"full": true}, &run, nil)
	mustCode(t, "start", code, e, 202, "")
	<-started
	var busy struct {
		Error struct {
			Details struct{ Sync apitypes.SourceSync }
		}
	}
	code, raw := env.editor.raw("POST", env.path(id)+"/syncs", nil, nil)
	if _ = json.Unmarshal(raw, &busy); code != 409 || busy.Error.Details.Sync.Id != run.Id {
		t.Errorf("a second sync while one runs = %d %s", code, raw)
	}
	var cancelled apitypes.SourceSync
	code, e = env.editor.call("POST", env.path(id)+"/syncs/"+run.Id.String()+"/cancel", nil, &cancelled, nil)
	mustCode(t, "cancel", code, e, 200, "")
	p.OnItem(nil)
	close(release)
	if got := env.waitSync(t, id); got.Status != "cancelled" || got.ItemsRemoved != 0 || got.Removals != "" {
		t.Errorf("the cancelled sync: %+v", got)
	}
	code, e = env.editor.call("POST", env.path(id)+"/syncs/"+run.Id.String()+"/cancel", nil, nil, nil)
	mustCode(t, "cancel twice", code, e, 409, "sync_not_active")
	done := env.sync(t, id, true)
	if done.Status != "completed" || done.ItemsRemoved != 1 || len(env.documents(t, id)) != 9 {
		t.Errorf("the sync after the cancelled one: %s, %d documents", counts(done), len(env.documents(t, id)))
	}
}

func TestConnectorSyncStopsAtATeamLimitAndWhenOff(t *testing.T) {
	env := newConnectorEnv(t)
	p := env.p
	for i := 0; i < 6; i++ {
		p.Put(fmt.Sprintf("f%d", i), fmt.Sprintf("page-%d.md", i), fmt.Sprintf("# Page %d\n\nText of page %d.\n", i, i), nil)
	}
	existing := env.scalar(t, `SELECT count(*) FROM documents WHERE team_id = (SELECT id FROM teams WHERE slug = $1)`, env.team)
	setTeamLimits(t, env.admin, env.team, map[string]any{"documents": existing + 4})
	src := env.create(t, connectortest.TypeBucket, "Pages", nil)
	id := src.Id.String()
	first := env.syncs(t, id)[0]
	if first.Status != "completed" || first.StoppedReason != "limit:documents" || first.ItemsAdded != 4 || first.Complete || first.ItemsRemoved != 0 {
		t.Fatalf("a sync that reached the documents limit: %+v", first)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"documents": nil})
	if got := env.sync(t, id, false); got.ItemsAdded != 2 || got.ItemsUnchanged != 4 || !got.Complete {
		t.Errorf("the sync after the limit was raised lists everything: %s", counts(got))
	}

	// A paused source and a type that is off start nothing; pausing cancels a running sync.
	var cur apitypes.DataSource
	env.editor.get(env.path(id), &cur)
	code, e := env.editor.call("PATCH", env.path(id), map[string]any{"status": "paused"}, &cur, ifMatch(cur.Revision))
	mustCode(t, "pause", code, e, 200, "")
	code, e = env.editor.call("POST", env.path(id)+"/syncs", nil, nil, nil)
	mustCode(t, "sync while paused", code, e, 409, "source_paused")
	code, e = env.editor.call("PATCH", env.path(id), map[string]any{"status": "active"}, &cur, ifMatch(cur.Revision))
	mustCode(t, "resume", code, e, 200, "")
	code, e = env.admin.call("PUT", "/v1/admin/source-types/"+connectortest.TypeBucket, map[string]any{"enabled": false}, nil, nil)
	mustCode(t, "type off", code, e, 200, "")
	code, e = env.editor.call("POST", env.path(id)+"/syncs", nil, nil, nil)
	mustCode(t, "sync while the type is off", code, e, 409, "source_type_off")
	code, e = env.editor.call("POST", env.base+"/sources", map[string]any{"name": "Another", "type": connectortest.TypeBucket, "classification": "open",
		"connector": env.settings(nil)}, nil, nil)
	mustCode(t, "create while the type is off", code, e, 409, "source_type_off")
	if n := len(env.documents(t, id)); n != 6 {
		t.Errorf("the documents of a type that is off stay: %d", n)
	}

	// On a schedule: due sources start when the scheduler runs, and not while the type is off.
	code, e = env.editor.call("PUT", env.path(id)+"/connector", map[string]any{"schedule": "hourly"}, &cur, ifMatch(cur.Revision))
	mustCode(t, "hourly", code, e, 200, "")
	if cur.NextSyncAt == nil || cur.Connector.Schedule != "hourly" {
		t.Fatalf("an hourly source has a next sync: %+v", cur.NextSyncAt)
	}
	due := func() {
		t.Helper()
		if _, err := env.app.Pool.Exec(context.Background(), `UPDATE data_sources SET next_sync_at = now() - interval '1 minute' WHERE id = $1`, src.Id); err != nil {
			t.Fatal(err)
		}
		if err := (&sourcesync.ScheduleWorker{S: env.app.Svc.Connectors}).Work(context.Background(), nil); err != nil {
			t.Fatal(err)
		}
	}
	n := len(env.syncs(t, id))
	due()
	if got := len(env.syncs(t, id)); got != n {
		t.Errorf("the scheduler started a sync of a type that is off (%d -> %d)", n, got)
	}
	code, e = env.admin.call("PUT", "/v1/admin/source-types/"+connectortest.TypeBucket, map[string]any{"enabled": true}, nil, nil)
	mustCode(t, "type on", code, e, 200, "")
	p.Put("f6", "page-6.md", "# Page 6\n\nA new page.\n", nil)
	due()
	scheduled := env.waitSync(t, id)
	if scheduled.Trigger != "schedule" || scheduled.ItemsAdded != 1 || len(env.syncs(t, id)) != n+1 {
		t.Errorf("the scheduled sync: %+v", scheduled)
	}
	env.editor.get(env.path(id), &cur)
	if cur.NextSyncAt == nil || time.Until(*cur.NextSyncAt) < 50*time.Minute {
		t.Errorf("the next sync is an hour on: %v", cur.NextSyncAt)
	}
}

var _ = connector.ErrStopped
