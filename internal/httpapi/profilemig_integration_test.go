package httpapi_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// migEnv is a RAG platform with three embedding profiles: the default
// (bow-64, 128-token passages), "wide" (a 2560-dimension Matryoshka model
// stored at 768 dimensions, 256-token passages: re-chunked) and "twin" (a
// 48-dimension model with the default's chunk settings: copied).
type migEnv struct {
	*ragEnv
	base             string
	from, wide, twin apitypes.EmbeddingProfile
}

func newMigEnv(t *testing.T) *migEnv {
	env := &migEnv{ragEnv: newRAGEnv(t)}
	env.base = "/v1/teams/" + env.team
	env.proxy.AddMatryoshkaEmbeddingModel("mrl-2560", 2560)
	env.proxy.AddEmbeddingModel("bow-48", 48)
	var conns []apitypes.Connection
	if code := env.admin.get("/v1/admin/connections", &conns); code != 200 || len(conns) != 1 {
		t.Fatalf("connections = %d %d", code, len(conns))
	}
	model := func(key, upstream string, dims int) apitypes.Model {
		var m apitypes.Model
		code, e := env.admin.call("POST", "/v1/admin/models", map[string]any{
			"connectionId": conns[0].Id, "key": key, "upstreamModel": upstream, "displayName": key, "kind": "embedding",
			"maxClassification": "restricted", "dimensions": dims,
		}, &m, nil)
		mustCode(t, "model "+key, code, e, 201, "")
		return m
	}
	profile := func(body map[string]any) apitypes.EmbeddingProfile {
		var p apitypes.EmbeddingProfile
		code, e := env.admin.call("POST", "/v1/admin/embedding-profiles", body, &p, nil)
		mustCode(t, "profile", code, e, 201, "")
		return p
	}
	wide, twin := model("mrl", "mrl-2560", 2560), model("bow48", "bow-48", 48)
	env.wide = profile(map[string]any{"key": "wide-768", "name": "Wide 768", "modelId": wide.Id, "outputDimensions": 768,
		"chunkSize": 256, "chunkOverlap": 32, "documentPrefix": "doc: ", "queryPrefix": "query: "})
	env.twin = profile(map[string]any{"key": "twin-48", "name": "Twin 48", "modelId": twin.Id, "chunkSize": 128, "chunkOverlap": 16})
	var all []apitypes.EmbeddingProfile
	env.admin.get("/v1/admin/embedding-profiles", &all)
	for _, p := range all {
		if p.Key == "bow-64" {
			env.from = p
		}
	}
	return env
}

// longText is a document long enough for 128- and 256-token passages to differ.
func longText(topic string, n int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", topic)
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "Paragraph %d about %s explains the rules, the deadlines and the office that handles requests for students and staff. ", i, topic)
		if i%3 == 2 {
			b.WriteString("\n\n")
		}
	}
	return b.String()
}

// source creates an upload source with the files and waits until they're ready.
func (env *migEnv) source(t *testing.T, name string, files ...upload) apitypes.DataSource {
	t.Helper()
	var src apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": name, "classification": "open"}, &src, nil)
	mustCode(t, "create source", code, e, 201, "")
	env.upload(t, src.Id, files...)
	return src
}

func (env *migEnv) upload(t *testing.T, srcID uuid.UUID, files ...upload) {
	t.Helper()
	docs := env.base + "/sources/" + srcID.String() + "/documents"
	if code, _, e := env.owner.uploadFiles(docs, files, ""); code != 200 {
		t.Fatalf("upload = %d %s", code, e)
	}
	for _, d := range env.owner.waitForDocuments(t, docs) {
		if d.Status != "ready" {
			t.Fatalf("document %s = %s", d.Filename, d.Status)
		}
	}
}

func (env *migEnv) kb(t *testing.T, name string, sources ...uuid.UUID) apitypes.KnowledgeBase {
	t.Helper()
	var kb apitypes.KnowledgeBase
	code, e := env.owner.call("POST", env.base+"/kbs", map[string]any{"name": name}, &kb, nil)
	mustCode(t, "create kb", code, e, 201, "")
	for _, id := range sources {
		code, e = env.owner.call("PUT", env.base+"/kbs/"+kb.Id.String()+"/sources/"+id.String(), nil, &kb, nil)
		mustCode(t, "attach", code, e, 200, "")
	}
	return kb
}

func (env *migEnv) getKB(t *testing.T, id uuid.UUID) apitypes.KnowledgeBase {
	t.Helper()
	var kb apitypes.KnowledgeBase
	if code := env.owner.get(env.base+"/kbs/"+id.String(), &kb); code != 200 {
		t.Fatalf("get kb = %d", code)
	}
	return kb
}

func (env *migEnv) sourceProfile(t *testing.T, id uuid.UUID) uuid.UUID {
	t.Helper()
	var src apitypes.DataSource
	if code := env.owner.get(env.base+"/sources/"+id.String(), &src); code != 200 {
		t.Fatalf("get source = %d", code)
	}
	return src.EmbeddingProfileId
}

func (env *migEnv) preflight(t *testing.T, kb, profile uuid.UUID) apitypes.ProfileMigrationPreflight {
	t.Helper()
	var pf apitypes.ProfileMigrationPreflight
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations/preflight", map[string]any{"kbId": kb, "targetProfileId": profile}, &pf, nil)
	mustCode(t, "preflight", code, e, 200, "")
	return pf
}

func (env *migEnv) start(t *testing.T, kb, profile uuid.UUID, grace *int) apitypes.ProfileMigration {
	t.Helper()
	body := map[string]any{"kbId": kb, "targetProfileId": profile}
	if grace != nil {
		body["graceDays"] = *grace
	}
	var m apitypes.ProfileMigration
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations", body, &m, nil)
	mustCode(t, "start migration", code, e, 201, "")
	return m
}

func (env *migEnv) migration(t *testing.T, id uuid.UUID) apitypes.ProfileMigration {
	t.Helper()
	var m apitypes.ProfileMigration
	if code := env.admin.get("/v1/admin/profile-migrations/"+id.String(), &m); code != 200 {
		t.Fatalf("get migration = %d", code)
	}
	return m
}

func (env *migEnv) wait(t *testing.T, id uuid.UUID, what string, done func(apitypes.ProfileMigration) bool) apitypes.ProfileMigration {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for {
		m := env.migration(t, id)
		if done(m) {
			return m
		}
		if time.Now().After(deadline) {
			t.Fatalf("migration never %s: %+v", what, m)
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func (env *migEnv) waitStatus(t *testing.T, id uuid.UUID, status apitypes.ProfileMigrationStatus) apitypes.ProfileMigration {
	t.Helper()
	return env.wait(t, id, string(status), func(m apitypes.ProfileMigration) bool { return m.Status == status })
}

func (env *migEnv) action(t *testing.T, m apitypes.ProfileMigration, action string, wantCode int, wantErr string) apitypes.ProfileMigration {
	t.Helper()
	var out apitypes.ProfileMigration
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/"+action, nil, &out, ifMatch(m.Revision))
	mustCode(t, action, code, e, wantCode, wantErr)
	return out
}

func (env *migEnv) scalar(t *testing.T, sql string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := env.app.Pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// chunks counts a source's chunks for a profile.
func (env *migEnv) chunks(t *testing.T, src, profile uuid.UUID) int64 {
	return env.scalar(t, `SELECT count(*) FROM chunks WHERE source_id = $1 AND profile_id = $2`, src, profile)
}

// vectors counts a source's vectors in a profile's table.
func (env *migEnv) vectors(t *testing.T, src, profile uuid.UUID) int64 {
	table := pgx.Identifier{"emb_" + strings.ReplaceAll(profile.String(), "-", "")}.Sanitize()
	return env.scalar(t, `SELECT count(*) FROM `+table+` WHERE source_id = $1`, src)
}

func (env *migEnv) cleanup(t *testing.T) {
	t.Helper()
	more, err := env.app.Svc.ProfileMigrations.Cleanup(context.Background(), time.Now().Add(time.Minute))
	if err != nil || more {
		t.Fatalf("cleanup = %v, more %v", err, more)
	}
}

func (env *migEnv) retrieve(t *testing.T, kb uuid.UUID, q string) []apitypes.RetrieveHit {
	t.Helper()
	var res apitypes.RetrieveResult
	code, e := env.owner.call("POST", env.base+"/kbs/"+kb.String()+"/retrieve", map[string]any{"query": q}, &res, nil)
	mustCode(t, "retrieve", code, e, 200, "")
	return res.Hits
}

// anyHit reports whether a hit contains text (the fake embeddings rank
// poorly, so the top hit isn't asserted).
func anyHit(hits []apitypes.RetrieveHit, text string) bool {
	for _, h := range hits {
		if strings.Contains(h.Content, text) {
			return true
		}
	}
	return false
}

func eventuallyTrue(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(45 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out: %s", what)
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func auditActionsFor(t *testing.T, env *migEnv, kb uuid.UUID) map[string]int {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT action, metadata::text FROM audit_log WHERE target_id = $1 AND action LIKE 'kb.profile%'`, kb.String())
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var action, meta string
		if err := rows.Scan(&action, &meta); err != nil {
			t.Fatal(err)
		}
		out[action]++
		if strings.Contains(meta, "Paragraph") || strings.Contains(meta, ".md") {
			t.Errorf("%s metadata carries content: %s", action, meta)
		}
	}
	return out
}

// A 2560→768 Matryoshka target with other chunk settings: the preflight,
// blockers, the background re-embed (re-chunked from the parsed text, no
// re-parse), the atomic switch, uploads during the grace period, switching
// back and the cleanup.
func TestProfileMigrationRechunkSwitchBackCleanup(t *testing.T) {
	env := newMigEnv(t)
	ctx := context.Background()
	src := env.source(t, "Handbook",
		upload{"parking.md", []byte(longText("Parking permits", 40))},
		upload{"housing.md", []byte(longText("Housing", 12))},
		upload{"notes.txt", []byte("Library hours are extended during finals week.")})
	kb := env.kb(t, "Handbook", src.Id)
	passagesBefore := env.chunks(t, src.Id, env.from.Id)

	// Only platform admins and auditors see migrations.
	code, e := env.owner.call("POST", "/v1/admin/profile-migrations/preflight", map[string]any{"kbId": kb.Id, "targetProfileId": env.wide.Id}, nil, nil)
	mustCode(t, "member preflight", code, e, 403, "")
	same := env.preflight(t, kb.Id, env.from.Id)
	if len(same.Blockers) != 1 || same.Blockers[0].Code != "same_profile" {
		t.Fatalf("same-profile blockers = %+v", same.Blockers)
	}
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations", map[string]any{"kbId": kb.Id, "targetProfileId": env.from.Id}, nil, nil)
	mustCode(t, "blocked start", code, e, 409, "migration_blocked")

	pf := env.preflight(t, kb.Id, env.wide.Id)
	if len(pf.Blockers) != 0 || !pf.Estimate.Rechunk || pf.Estimate.Documents != 3 || pf.Estimate.EmbeddingCalls < 1 ||
		pf.Estimate.Minutes != nil || pf.Target.Dimensions != 768 || len(pf.Sources) != 1 || pf.DefaultGraceDays != 7 {
		t.Fatalf("preflight = %+v", pf)
	}
	codes := map[string]bool{}
	for _, w := range pf.Warnings {
		codes[w.Code] = true
	}
	if !codes["rechunk"] || !codes["no_rate_limit"] {
		t.Errorf("warnings = %+v", pf.Warnings)
	}

	parsesBefore := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'document_processed'`)
	m := env.start(t, kb.Id, env.wide.Id, nil)
	m = env.waitStatus(t, m.Id, apitypes.ProfileMigrationStatusSwitched)
	if !m.CanSwitchBack || m.OldVectorsUntil == nil || m.OldVectorsUntil.Before(time.Now().Add(6*24*time.Hour)) {
		t.Fatalf("switched = %+v", m)
	}
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != env.wide.Id {
		t.Fatalf("kb profile = %s", got)
	}
	if env.sourceProfile(t, src.Id) != env.wide.Id {
		t.Error("a source used by one KB moves with it")
	}
	// Re-chunked with the wider passages, from the stored parsed text: no
	// document was processed again.
	wide := env.chunks(t, src.Id, env.wide.Id)
	if wide == 0 || wide >= passagesBefore || env.vectors(t, src.Id, env.wide.Id) != wide {
		t.Errorf("passages: %d before, %d wide (%d vectors)", passagesBefore, wide, env.vectors(t, src.Id, env.wide.Id))
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'document_processed'`); n != parsesBefore {
		t.Errorf("documents processed again: %d -> %d", parsesBefore, n)
	}
	table := pgx.Identifier{"emb_" + strings.ReplaceAll(env.wide.Id.String(), "-", "")}.Sanitize()
	if dims := env.scalar(t, `SELECT vector_dims(embedding::vector) FROM `+table+` LIMIT 1`); dims != 768 {
		t.Errorf("stored dimensions = %d", dims)
	}
	if hits := env.retrieve(t, kb.Id, "parking permits deadlines"); !anyHit(hits, "Parking") {
		t.Fatalf("hits after the switch: %d", len(hits))
	}
	if env.proxy.EmbedRequestsFor("mrl-2560") == 0 {
		t.Error("the target model was never called")
	}
	// The team sees the migration on the KB page.
	var mine *apitypes.ProfileMigration
	if code := env.owner.get(env.base+"/kbs/"+kb.Id.String()+"/profile-migration", &mine); code != 200 || mine == nil || mine.Status != "switched" {
		t.Fatalf("team view = %d %+v", code, mine)
	}
	if n := env.scalar(t, `SELECT count(*) FROM notifications WHERE type = 'platform.profile_migration'`); n != 1 {
		t.Errorf("admin notifications = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM notifications WHERE type = 'kb.profile_changed'`); n != 1 {
		t.Errorf("team notifications = %d", n)
	}

	// During the grace period new documents get vectors for both profiles,
	// so switching back loses nothing.
	env.upload(t, src.Id, upload{"dining.md", []byte("# Dining\n\nThe dining hall serves brunch on weekends.")})
	eventuallyTrue(t, "new document embedded for both profiles", func() bool {
		return env.scalar(t, `SELECT count(DISTINCT profile_id) FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.filename = 'dining.md'`) == 2
	})

	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/switch-back", nil, nil, nil)
	mustCode(t, "switch back without If-Match", code, e, 428, "")
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/switch-back", nil, nil, ifMatch(m.Revision+5))
	mustCode(t, "stale switch back", code, e, 412, "")
	back := env.action(t, m, "switch-back", 200, "")
	if back.Status != "switched_back" || back.CanSwitchBack {
		t.Fatalf("switched back = %+v", back)
	}
	if env.getKB(t, kb.Id).EmbeddingProfileId != env.from.Id || env.sourceProfile(t, src.Id) != env.from.Id {
		t.Fatal("the KB and its source are back on the previous profile")
	}
	if hits := env.retrieve(t, kb.Id, "dining hall brunch"); !anyHit(hits, "brunch") {
		t.Fatalf("hits after switching back: %d", len(hits))
	}
	env.action(t, back, "switch-back", 409, "switch_back_unavailable")

	// The cleanup deletes the new profile's vectors, which nothing needs.
	env.cleanup(t)
	if n := env.chunks(t, src.Id, env.wide.Id); n != 0 || env.vectors(t, src.Id, env.wide.Id) != 0 {
		t.Errorf("wide chunks left = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM source_embedding_sets`); n != 0 {
		t.Errorf("sets left = %d", n)
	}
	if n := env.chunks(t, src.Id, env.from.Id); n <= passagesBefore {
		t.Errorf("previous profile passages = %d (before %d, plus dining)", n, passagesBefore)
	}
	got := auditActionsFor(t, env, kb.Id)
	if got["kb.profile_migration_start"] != 1 || got["kb.profile_switch"] != 1 || got["kb.profile_switch_back"] != 1 {
		t.Errorf("audit = %v", got)
	}
	// AD-15: the unused profile keeps its migration's history: deleting it is refused (retire it instead).
	code, e = env.admin.call("DELETE", "/v1/admin/embedding-profiles/"+env.wide.Id.String(), nil, nil, nil)
	mustCode(t, "delete a profile with migrations", code, e, 409, "profile_in_migrations")
	_ = ctx
}

// A source shared by two KBs keeps vectors for both profiles until both
// have moved; documents uploaded during the migration reach both
// profiles; the same chunk settings copy passages instead of cutting them
// again; grace 0 or Finish deletes the old vectors.
func TestProfileMigrationSharedSourceAndUploads(t *testing.T) {
	env := newMigEnv(t)
	shared := env.source(t, "Registrar pages", upload{"calendar.md", []byte(longText("Academic calendar", 10))},
		upload{"transcripts.md", []byte("# Transcripts\n\nOfficial transcripts are ordered online.")})
	own := env.source(t, "Office notes", upload{"hours.md", []byte("# Hours\n\nThe office opens at nine.")})
	kb1 := env.kb(t, "Registrar", shared.Id, own.Id)
	kb2 := env.kb(t, "Advising", shared.Id)

	env.proxy.SetEmbedLatency(300 * time.Millisecond)
	grace := 1
	m := env.start(t, kb1.Id, env.twin.Id, &grace)
	if m.Estimate.Rechunk {
		t.Error("same chunk settings: passages are copied")
	}
	// Uploaded while the migration runs.
	env.upload(t, own.Id, upload{"parking.md", []byte("# Parking\n\nVisitors park in lot C.")})
	env.proxy.SetEmbedLatency(0)
	m = env.waitStatus(t, m.Id, apitypes.ProfileMigrationStatusSwitched)
	if env.getKB(t, kb1.Id).EmbeddingProfileId != env.twin.Id || env.getKB(t, kb2.Id).EmbeddingProfileId != env.from.Id {
		t.Fatal("only the migrated KB switches")
	}
	if env.sourceProfile(t, shared.Id) != env.from.Id || env.sourceProfile(t, own.Id) != env.twin.Id {
		t.Error("the shared source keeps its profile while another KB uses it")
	}
	if a, b := env.chunks(t, shared.Id, env.from.Id), env.chunks(t, shared.Id, env.twin.Id); a == 0 || a != b {
		t.Errorf("shared passages: %d from, %d twin (copied)", a, b)
	}
	defer func() {
		if t.Failed() {
			rows, _ := env.app.Pool.Query(context.Background(), `SELECT d.filename, d.status, d.version, c.profile_id::text, count(c.id) FROM documents d LEFT JOIN chunks c ON c.document_id = d.id GROUP BY 1,2,3,4 ORDER BY 1`)
			for rows.Next() {
				var f, st, p string
				var v, n int
				_ = rows.Scan(&f, &st, &v, &p, &n)
				t.Logf("doc %s %s v%d profile %s: %d", f, st, v, p, n)
			}
			rows.Close()
			rows, _ = env.app.Pool.Query(context.Background(), `SELECT kind, state, args::text, coalesce(errors::text,'') FROM river_job WHERE kind LIKE 'embedding%' ORDER BY id`)
			for rows.Next() {
				var k, st, a, e string
				_ = rows.Scan(&k, &st, &a, &e)
				t.Logf("job %s %s %s %s", k, st, a, e)
			}
			rows.Close()
			t.Logf("from %s twin %s", env.from.Id, env.twin.Id)
		}
	}()
	eventuallyTrue(t, "upload during the migration embedded for both profiles", func() bool {
		return env.scalar(t, `SELECT count(DISTINCT profile_id) FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.filename = 'parking.md'`) == 2
	})
	if hits := env.retrieve(t, kb1.Id, "visitors park lot"); !anyHit(hits, "lot C") {
		t.Fatalf("kb1 hits: %d", len(hits))
	}
	if hits := env.retrieve(t, kb2.Id, "official transcripts online"); !anyHit(hits, "transcripts") {
		t.Fatalf("kb2 hits: %d", len(hits))
	}
	// A new source (on the default profile) can't join the switched KB.
	fresh := env.source(t, "Fresh", upload{"x.md", []byte("# X\n\nSomething.")})
	code, e := env.owner.call("PUT", env.base+"/kbs/"+kb1.Id.String()+"/sources/"+fresh.Id.String(), nil, nil, nil)
	mustCode(t, "attach other profile", code, e, 400, "profile_mismatch")

	// The grace period keeps the old vectors; Finish ends it. The shared
	// source keeps both sets: the other KB still searches the old one.
	env.cleanup(t)
	if env.chunks(t, own.Id, env.from.Id) == 0 {
		t.Fatal("old vectors deleted during the grace period")
	}
	m = env.action(t, m, "finish", 200, "")
	if m.Status != "completed" || m.CanSwitchBack {
		t.Fatalf("finished = %+v", m)
	}
	env.cleanup(t)
	if env.chunks(t, own.Id, env.from.Id) != 0 || env.chunks(t, shared.Id, env.from.Id) == 0 || env.chunks(t, shared.Id, env.twin.Id) == 0 {
		t.Fatalf("after finish: own/from %d, shared/from %d, shared/twin %d",
			env.chunks(t, own.Id, env.from.Id), env.chunks(t, shared.Id, env.from.Id), env.chunks(t, shared.Id, env.twin.Id))
	}

	// The second KB finds the shared source already embedded and switches
	// at once; with grace 0 the old vectors go at the switch.
	pf := env.preflight(t, kb2.Id, env.twin.Id)
	if len(pf.Sources) != 1 || !pf.Sources[0].AlreadyEmbedded || pf.Estimate.Documents != 0 || pf.Sources[0].OtherKnowledgeBases != 1 {
		t.Fatalf("second preflight = %+v", pf)
	}
	zero := 0
	m2 := env.start(t, kb2.Id, env.twin.Id, &zero)
	if m2.Status != "switched" {
		t.Fatalf("second migration = %+v", m2)
	}
	if env.sourceProfile(t, shared.Id) != env.twin.Id {
		t.Error("the shared source moves once every KB has")
	}
	env.cleanup(t)
	if n := env.chunks(t, shared.Id, env.from.Id); n != 0 {
		t.Errorf("shared old passages left = %d", n)
	}
	if m2 = env.migration(t, m2.Id); m2.Status != "completed" {
		t.Errorf("grace 0 = %s", m2.Status)
	}
	if hits := env.retrieve(t, kb2.Id, "official transcripts online"); len(hits) == 0 {
		t.Fatal("kb2 lost its content")
	}
}

// Failed documents stop the switch until retried; a cancelled migration
// leaves the KB as it was and its vectors are deleted.
func TestProfileMigrationFailuresRetryCancel(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Pages", upload{"ok.md", []byte("# Fine\n\nNothing special here.")},
		upload{"zebra.md", []byte("# Zebra crossing\n\nZebraMarker rules for crossings.")})
	kb := env.kb(t, "Pages", src.Id)
	env.proxy.RejectInputsContaining("ZebraMarker")
	m := env.start(t, kb.Id, env.twin.Id, nil)
	m = env.wait(t, m.Id, "needs attention", func(m apitypes.ProfileMigration) bool { return m.Progress.Failed == 1 })
	if m.Status != "running" || m.Sources == nil || (*m.Sources)[0].State != "attention" || m.Failures == nil || len(*m.Failures) != 1 {
		t.Fatalf("attention = %+v", m)
	}
	if f := (*m.Failures)[0]; f.Title == "" || f.Code == "" || f.SourceName != "Pages" {
		t.Errorf("failure = %+v", f)
	}
	if env.getKB(t, kb.Id).EmbeddingProfileId != env.from.Id {
		t.Fatal("a KB with failed documents doesn't switch")
	}
	eventuallyTrue(t, "admins notified", func() bool {
		return env.scalar(t, `SELECT count(*) FROM notification_events WHERE type = 'platform.profile_migration' AND data->>'result' = 'attention'`) == 1
	})
	env.proxy.RejectInputsContaining("")
	m = env.action(t, m, "retry", 200, "")
	env.waitStatus(t, m.Id, apitypes.ProfileMigrationStatusSwitched)

	// Cancel: a second KB with its own source.
	other := env.source(t, "Other", upload{"a.md", []byte(longText("Advising", 20))})
	kb2 := env.kb(t, "Other", other.Id)
	env.proxy.SetEmbedLatency(2 * time.Second)
	m2 := env.start(t, kb2.Id, env.wide.Id, nil)
	m2 = env.action(t, m2, "cancel", 200, "")
	if m2.Status != "cancelled" {
		t.Fatalf("cancelled = %+v", m2)
	}
	env.action(t, m2, "cancel", 409, "migration_not_running")
	env.proxy.SetEmbedLatency(0)
	eventuallyTrue(t, "cancelled vectors deleted", func() bool {
		env.cleanup(t)
		return env.chunks(t, other.Id, env.wide.Id) == 0 &&
			env.scalar(t, `SELECT count(*) FROM source_embedding_sets WHERE source_id = $1`, other.Id) == 0
	})
	if env.getKB(t, kb2.Id).EmbeddingProfileId != env.from.Id || env.chunks(t, other.Id, env.from.Id) == 0 {
		t.Fatal("cancel leaves the KB as it was")
	}
	got := auditActionsFor(t, env, kb2.Id)
	if got["kb.profile_migration_cancel"] != 1 {
		t.Errorf("audit = %v", got)
	}
	var list []apitypes.ProfileMigration
	if code := env.admin.get("/v1/admin/profile-migrations", &list); code != 200 || len(list) != 2 {
		t.Fatalf("list = %d %d", code, len(list))
	}
	var kbs []apitypes.AdminKnowledgeBase
	if code := env.admin.get("/v1/admin/knowledge-bases", &kbs); code != 200 || len(kbs) != 2 {
		t.Fatalf("admin kbs = %d %+v", code, kbs)
	}
}
