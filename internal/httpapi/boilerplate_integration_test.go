package httpapi_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/ingest"
)

// Boilerplate that main-content extraction keeps: it sits inside <main>, as
// on many real sites ("QUICKLINKS" blocks, calls to action, sign-offs).
const (
	bpQuicklinks = `<h2>QUICKLINKS</h2><ul><li><a href="/soc">Schedule of Courses</a></li><li><a href="/dates">Dates and Deadlines</a></li><li><a href="/forms">Registrar Forms</a></li></ul>`
	bpFooter     = `<p>ZebraFooter: questions? Contact the Office of the Test Registrar, 101 Main Hall, 555-0100.</p>`
)

func bpPage(title, body string) []byte {
	return []byte(`<!DOCTYPE html><html><head><title>` + title + `</title></head><body><main>` +
		bpQuicklinks + `<h1>` + title + `</h1>` + body + bpFooter + `</main></body></html>`)
}

// bpTopics gives each page distinct content.
var bpTopics = []string{
	"Drop and add runs through the first week of classes; late drops need a college petition.",
	"Official transcripts are ordered online and usually mailed within three business days.",
	"Residency reclassification requires twelve months of documented domicile in the state.",
	"Degree applications are due by the published deadline in the semester you graduate.",
	"Enrollment verification letters are generated instantly from the student portal.",
	"Final exam schedules are released midway through the term by the scheduling office.",
	"Waitlisted students are enrolled automatically when a seat opens before the deadline.",
	"Withdrawal from all courses requires meeting with a dean and settling fee liability.",
}

// bpSite serves a home page linking to one page per topic.
func bpSite(t *testing.T) *testSite {
	s := newTestSite(t)
	var links strings.Builder
	for i := range bpTopics {
		fmt.Fprintf(&links, `<li><a href="/topic/%d">Topic %d</a></li>`, i, i)
	}
	s.set("/", bpPage("Home", `<p>Welcome to the office of the test registrar.</p><ul>`+links.String()+`</ul>`))
	for i, topic := range bpTopics {
		s.set(fmt.Sprintf("/topic/%d", i), bpPage(fmt.Sprintf("Topic %d", i), "<p>"+topic+"</p>"))
	}
	s.sitemap = nil
	return s
}

// waitBoilerplate polls a source until its boilerplate refresh settles and
// done reports true.
func waitBoilerplate(t *testing.T, s *session, srcPath string, done func(apitypes.SourceBoilerplate) bool) apitypes.SourceBoilerplate {
	t.Helper()
	deadline := time.Now().Add(90 * time.Second)
	for {
		var src apitypes.DataSource
		if code := s.get(srcPath, &src); code != 200 {
			t.Fatalf("get source = %d", code)
		}
		if b := src.Boilerplate; !b.Pending && done(b) {
			return b
		}
		if time.Now().After(deadline) {
			t.Fatalf("boilerplate refresh did not settle: %+v", src.Boilerplate)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// chunksContaining counts a source's chunks containing text, per document URL.
func chunksContaining(t *testing.T, env *ragEnv, sourceID fmt.Stringer, text string) map[string]int {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT d.url, d.filename, count(*) FROM chunks c JOIN documents d ON d.id = c.document_id
		WHERE c.source_id = $1 AND c.content LIKE '%' || $2 || '%' GROUP BY d.url, d.filename`, sourceID.String(), text)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var u, f string
		var n int
		if err := rows.Scan(&u, &f, &n); err != nil {
			t.Fatal(err)
		}
		out[u+f] = n
	}
	return out
}

// chunkIDs is a snapshot of a source's chunk rows (id -> content).
func chunkIDs(t *testing.T, env *ragEnv, sourceID fmt.Stringer) map[string]string {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT id::text, content FROM chunks WHERE source_id = $1`, sourceID.String())
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, c string
		if err := rows.Scan(&id, &c); err != nil {
			t.Fatal(err)
		}
		out[id] = c
	}
	return out
}

func embedEvents(t *testing.T, env *ragEnv, sourceID fmt.Stringer) int {
	t.Helper()
	var n int
	if err := env.app.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM usage_events WHERE kind = 'embed_tokens' AND source_id = $1`, sourceID.String()).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// waitNoRefreshJob waits until no boilerplate.refresh job is queued or
// running (River records completion asynchronously, and a new refresh for
// the source is not inserted while one is still marked running).
func waitNoRefreshJob(t *testing.T, env *ragEnv) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		var n int
		if err := env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job WHERE kind = 'boilerplate.refresh'
			AND state IN ('available', 'pending', 'running', 'retryable', 'scheduled')`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d boilerplate.refresh jobs still active", n)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestBoilerplateWebCrawl(t *testing.T) {
	env := newWebEnv(t, true)
	env.site = bpSite(t)
	owner, site := env.owner, env.site
	src := env.createWeb(t, owner, env.base+"/sources", "Boilerplate site", map[string]any{
		"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 1, "useSitemaps": false,
	})
	srcPath := env.base + "/sources/" + src.Id.String()
	if !src.Boilerplate.Enabled || src.Boilerplate.MinDocs != 5 || src.Boilerplate.Ratio != 0.2 {
		t.Fatalf("web sources are on by default: %+v", src.Boilerplate)
	}
	if c := waitCrawl(t, owner, srcPath, src.ActiveCrawl.Id); c.Status != "completed" {
		t.Fatalf("crawl = %+v", c)
	}
	docs := owner.waitForDocuments(t, srcPath+"/documents")
	if len(docs) != len(bpTopics)+1 {
		t.Fatalf("documents = %d", len(docs))
	}
	// After the crawl, the refresh counts the blocks (9 pages: threshold
	// max(5, ceil(0.2 x 9)) = 5) and re-chunks every page from its parsed
	// text: the shared blocks stay only on the canonical page (the home
	// page, the shortest URL).
	bp := waitBoilerplate(t, owner, srcPath, func(b apitypes.SourceBoilerplate) bool { return b.RepeatedBlocks > 0 })
	if bp.RepeatedBlocks != 3 || bp.PagesAffected != int64(len(bpTopics)) || bp.DocumentsCounted != 9 || bp.Threshold != 5 {
		t.Fatalf("summary = %+v", bp)
	}
	home := site.url("/")
	for _, text := range []string{"ZebraFooter", "QUICKLINKS", "Schedule of Courses"} {
		got := chunksContaining(t, env.ragEnv, src.Id, text)
		if len(got) != 1 || got[home] != 1 {
			t.Errorf("%q: chunks per page = %v, want only the canonical home page", text, got)
		}
	}
	// Page content is untouched, and headings still give context.
	for i, topic := range bpTopics {
		if got := chunksContaining(t, env.ragEnv, src.Id, topic); got[site.url(fmt.Sprintf("/topic/%d", i))] != 1 {
			t.Errorf("topic %d content lost: %v", i, got)
		}
	}
	var blocks []apitypes.BoilerplateBlock
	if code := owner.get(srcPath+"/boilerplate", &blocks); code != 200 || len(blocks) != 3 {
		t.Fatalf("boilerplate list = %d %+v", code, blocks)
	}
	texts := map[string]int32{}
	for _, b := range blocks {
		texts[b.Text] = b.Documents
		if len([]rune(b.Text)) > 80 || strings.Contains(b.Text, "](") {
			t.Errorf("block text = %q", b.Text)
		}
	}
	if texts["QUICKLINKS"] != 9 || texts["Schedule of Courses Dates and Deadlines Registrar Forms"] != 9 {
		t.Errorf("blocks = %+v", blocks)
	}

	// The refresh is idempotent: running it again changes no chunk and
	// embeds nothing. Here the documents are also put back on an older
	// revision with no job, as if a refresh had ended before finishing: the
	// sweep finds them and resumes.
	before, events := chunkIDs(t, env.ragEnv, src.Id), embedEvents(t, env.ragEnv, src.Id)
	waitNoRefreshJob(t, env.ragEnv)
	if _, err := env.app.Pool.Exec(context.Background(), `UPDATE document_blocks SET rev = rev - 1 WHERE source_id = $1`, src.Id); err != nil {
		t.Fatal(err)
	}
	sweep := &river.InsertOpts{UniqueOpts: river.UniqueOpts{ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning, rivertype.JobStateScheduled,
	}}}
	if _, err := env.app.Svc.Sources.Jobs.Insert(context.Background(), ingest.SweepArgs{}, sweep); err != nil {
		t.Fatal(err)
	}
	waitBoilerplate(t, owner, srcPath, func(apitypes.SourceBoilerplate) bool { return true })
	if after := chunkIDs(t, env.ragEnv, src.Id); fmt.Sprint(after) != fmt.Sprint(before) {
		t.Errorf("a second refresh changed chunks:\nbefore %v\nafter  %v", before, after)
	}
	if n := embedEvents(t, env.ragEnv, src.Id); n != events {
		t.Errorf("a second refresh embedded again: %d -> %d usage events", events, n)
	}

	// Turning it off (a settings change) triggers the refresh, which puts
	// the blocks back; it is audited.
	var cur, upd apitypes.DataSource
	owner.get(srcPath, &cur)
	code, e := owner.call("PATCH", srcPath, map[string]any{"boilerplate": map[string]any{"enabled": false}}, &upd, ifMatch(cur.Revision))
	mustCode(t, "disable boilerplate", code, e, 200, "")
	if upd.Boilerplate.Enabled || upd.Boilerplate.Overrides.Enabled == nil || !upd.Boilerplate.Pending {
		t.Fatalf("after disabling: %+v", upd.Boilerplate)
	}
	waitBoilerplate(t, owner, srcPath, func(b apitypes.SourceBoilerplate) bool { return b.RepeatedBlocks == 0 && b.PagesAffected == 0 })
	if got := chunksContaining(t, env.ragEnv, src.Id, "ZebraFooter"); len(got) != len(bpTopics)+1 {
		t.Errorf("footer back on every page: %v", got)
	}
	if n := auditCount(t, env.app, "source.boilerplate_update"); n != 1 {
		t.Errorf("boilerplate_update audit entries = %d", n)
	}

	// Invalid settings are rejected.
	code, e = owner.call("PATCH", srcPath, map[string]any{"boilerplate": map[string]any{"ratio": 2}}, nil, ifMatch(upd.Revision))
	if code != 400 {
		t.Errorf("ratio 2: %d %s", code, e)
	}
}

func TestBoilerplateUploads(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team
	var src apitypes.DataSource
	code, e := owner.call("POST", base+"/sources", map[string]any{"name": "Handbooks", "classification": "open"}, &src, nil)
	mustCode(t, "create upload source", code, e, 201, "")
	if src.Boilerplate.Enabled {
		t.Fatalf("uploads are off by default: %+v", src.Boilerplate)
	}
	srcPath := base + "/sources/" + src.Id.String()
	footer := "Office of the Test Registrar, 101 Main Hall. KiwiSignoff for every handbook page."
	var files []upload
	for i, topic := range bpTopics[:6] {
		files = append(files, upload{fmt.Sprintf("page-%d.md", i), []byte(fmt.Sprintf("# Page %d\n\n%s\n\n%s\n", i, topic, footer))})
	}
	if code, _, e := owner.uploadFiles(srcPath+"/documents", files, ""); code != 200 {
		t.Fatalf("upload = %d %s", code, e)
	}
	owner.waitForDocuments(t, srcPath+"/documents")
	// Off: nothing is removed, and no refresh runs.
	time.Sleep(300 * time.Millisecond)
	if got := chunksContaining(t, env, src.Id, "KiwiSignoff"); len(got) != 6 {
		t.Fatalf("uploads with suppression off keep every copy: %v", got)
	}
	var cur apitypes.DataSource
	owner.get(srcPath, &cur)
	if cur.Boilerplate.Pending || cur.Boilerplate.RepeatedBlocks != 0 {
		t.Fatalf("summary = %+v", cur.Boilerplate)
	}

	// Opting in re-chunks from the stored parsed text: one copy remains
	// (6 documents: threshold 5).
	code, e = owner.call("PATCH", srcPath, map[string]any{"boilerplate": map[string]any{"enabled": true}}, &cur, ifMatch(cur.Revision))
	mustCode(t, "enable", code, e, 200, "")
	bp := waitBoilerplate(t, owner, srcPath, func(b apitypes.SourceBoilerplate) bool { return b.RepeatedBlocks > 0 })
	if bp.RepeatedBlocks != 1 || bp.PagesAffected != 5 {
		t.Fatalf("summary = %+v", bp)
	}
	if got := chunksContaining(t, env, src.Id, "KiwiSignoff"); len(got) != 1 || got["page-0.md"] != 1 {
		t.Fatalf("one copy stays (shortest name, then lowest ID): %v", got)
	}
}
