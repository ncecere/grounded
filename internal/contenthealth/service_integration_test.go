package contenthealth

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

func wantStatus(t *testing.T, what string, err error, status int, code string) {
	t.Helper()
	e, ok := apperr.As(err)
	if !ok || e.Status != status || (code != "" && e.Code != code) {
		t.Errorf("%s = %v, want %d %s", what, err, status, code)
	}
}

// make creates and runs a report as the team's editor and returns it (ended).
func (f *fixture) make(in CreateInput) Report {
	f.t.Helper()
	rep, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, in)
	if err != nil {
		f.t.Fatalf("create: %v", err)
	}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		f.t.Fatalf("execute: %v", err)
	}
	got, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	return got
}

// Who may use it: a team's editors, admins and owners, in the app. Everyone else, including members, API keys, OAuth clients,
// platform staff and another team's owner, gets the same 404, for every operation.
func TestAccessByRole(t *testing.T) {
	f := newFixture(t)
	rep := f.make(CreateInput{})
	key := authz.Actor{UserID: f.ownerA.UserID, Key: &authz.KeyGrant{ID: uuid.New(), TeamID: f.teamA, Scopes: []string{"query", "ingest", "manage"}}}
	oauth := authz.Actor{UserID: f.ownerA.UserID, OAuth: &authz.OAuthGrant{ID: uuid.New(), ClientName: "Client"}}
	denied := map[string]authz.Actor{"member": f.memberA, "other team's owner": f.ownerB, "platform admin": f.platformAdmin, "auditor": f.auditor, "API key": key,
		"OAuth client": oauth, "nobody": {}}
	for who, a := range denied {
		_, err := f.svc.List(f.ctx, a, f.slugA)
		wantStatus(t, who+" lists", err, http.StatusNotFound, "")
		_, err = f.svc.Create(f.ctx, a, f.slugA, CreateInput{})
		wantStatus(t, who+" makes", err, http.StatusNotFound, "")
		_, err = f.svc.Get(f.ctx, a, f.slugA, rep.ID)
		wantStatus(t, who+" reads", err, http.StatusNotFound, "")
		_, err = f.svc.Findings(f.ctx, a, f.slugA, rep.ID, SignalStale, 0, 10)
		wantStatus(t, who+" reads findings", err, http.StatusNotFound, "")
		_, err = f.svc.Cancel(f.ctx, a, f.slugA, rep.ID)
		wantStatus(t, who+" cancels", err, http.StatusNotFound, "")
		wantStatus(t, who+" deletes", f.svc.Delete(f.ctx, a, f.slugA, rep.ID), http.StatusNotFound, "")
	}
	for who, a := range map[string]authz.Actor{"editor": f.editorA, "admin": f.adminA, "owner": f.ownerA} {
		if _, err := f.svc.List(f.ctx, a, f.slugA); err != nil {
			t.Errorf("%s lists: %v", who, err)
		}
		if _, err := f.svc.Findings(f.ctx, a, f.slugA, rep.ID, SignalStale, 0, 10); err != nil {
			t.Errorf("%s reads findings: %v", who, err)
		}
	}
	// Another team's owner can't read this team's report by guessing its id under their own team either.
	_, err := f.svc.Get(f.ctx, f.ownerB, f.slugB, rep.ID)
	wantStatus(t, "team B reads team A's report under its own slug", err, http.StatusNotFound, "content_health_report_not_found")
	_, err = f.svc.Findings(f.ctx, f.ownerB, f.slugB, rep.ID, SignalStale, 0, 10)
	wantStatus(t, "team B reads team A's findings under its own slug", err, http.StatusNotFound, "content_health_report_not_found")
	wantStatus(t, "team B deletes team A's report", f.svc.Delete(f.ctx, f.ownerB, f.slugB, rep.ID), http.StatusNotFound, "content_health_report_not_found")
	if _, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID); err != nil {
		t.Errorf("the report was deleted by another team: %v", err)
	}
}

// Opt-in: off by default (the migration's row), refused to make while off, hidden while off, back when on. Only a platform
// admin changes the switch; staff can read it, nobody else can.
func TestSwitch(t *testing.T) {
	f := newFixture(t)
	rep := f.make(CreateInput{})
	f.exec(`UPDATE content_health_settings SET enabled = false`)
	l, err := f.svc.List(f.ctx, f.ownerA, f.slugA)
	if err != nil || l.Enabled || len(l.Reports) != 0 {
		t.Fatalf("list while off = %+v, %v; want disabled and empty", l, err)
	}
	_, err = f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	wantStatus(t, "create while off", err, http.StatusConflict, "content_health_off")
	_, err = f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID)
	wantStatus(t, "read while off", err, http.StatusNotFound, "not_found")
	_, err = f.svc.Findings(f.ctx, f.ownerA, f.slugA, rep.ID, SignalStale, 0, 10)
	wantStatus(t, "findings while off", err, http.StatusNotFound, "not_found")
	// An outsider is never told whether it is on.
	_, err = f.svc.Create(f.ctx, f.memberA, f.slugA, CreateInput{})
	wantStatus(t, "a member creating while off", err, http.StatusNotFound, "not_found")

	f.exec(`UPDATE content_health_settings SET enabled = true`)
	if _, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID); err != nil {
		t.Errorf("the stored report did not come back with the switch: %v", err)
	}

	// The migration's default is off.
	f.exec(`UPDATE content_health_settings SET enabled = false, revision = 1`)
	st, err := f.svc.Settings(f.ctx, f.auditor)
	if err != nil || st.Enabled {
		t.Fatalf("auditor reads %+v, %v", st, err)
	}
	if _, err := f.svc.Settings(f.ctx, f.ownerA); err == nil {
		t.Error("a team owner can read the platform switch")
	}
	if _, err := f.svc.SetEnabled(f.ctx, f.auditor, true, st.Revision); err == nil {
		t.Error("an auditor turned the feature on")
	}
	_, err = f.svc.SetEnabled(f.ctx, f.platformAdmin, true, st.Revision+7)
	wantStatus(t, "a stale revision", err, http.StatusPreconditionFailed, "revision_conflict")
	on, err := f.svc.SetEnabled(f.ctx, f.platformAdmin, true, st.Revision)
	if err != nil || !on.Enabled || on.Revision != st.Revision+1 {
		t.Fatalf("turn on = %+v, %v", on, err)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE action = 'platform.content_health' AND target_type = 'content_health_settings'`); n != 1 {
		t.Errorf("%d audit entries for the switch, want 1", n)
	}
}

// The request only queues: it validates, pauses, scopes to the team's own objects and audits IDs and thresholds.
func TestCreateRules(t *testing.T) {
	f := newFixture(t)
	mine := f.source(f.teamA, "Mine", "upload")
	theirs := f.source(f.teamB, "Theirs", "upload")
	shared := f.source(uuid.Nil, "Shared", "upload")
	kbB := f.id(`INSERT INTO knowledge_bases (team_id, name, embedding_profile_id) VALUES ($1, 'Theirs', $2) RETURNING id`, f.teamB, f.profile)
	none := uuid.New()

	for name, in := range map[string]CreateInput{
		"stale days too low": {StaleDays: 29}, "stale days too high": {StaleDays: 3651},
		"window too short": {CitationWindowDays: 13}, "window too long": {CitationWindowDays: 366},
	} {
		_, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, in)
		if e, ok := apperr.As(err); !ok || e.Status != http.StatusBadRequest {
			t.Errorf("%s = %v, want 400", name, err)
		}
	}
	_, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{SourceID: &mine, KBID: &kbB})
	wantStatus(t, "both scopes", err, http.StatusBadRequest, "invalid_scope")
	for name, id := range map[string]*uuid.UUID{"another team's source": &theirs, "a shared source": &shared, "a source that does not exist": &none} {
		_, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{SourceID: id})
		wantStatus(t, name, err, http.StatusNotFound, "content_health_scope_not_found")
	}
	_, err = f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{KBID: &kbB})
	wantStatus(t, "another team's knowledge base", err, http.StatusNotFound, "content_health_scope_not_found")
	if n := f.count(`SELECT count(*) FROM content_health_reports`); n != 0 {
		t.Fatalf("%d reports after refused requests", n)
	}

	rep, err := f.svc.Create(f.ctx, f.editorA, f.slugA, CreateInput{SourceID: &mine, StaleDays: 90})
	if err != nil || rep.Status != StatusQueued || rep.StaleDays != 90 || rep.CitationWindowDays != DefaultCitationWindowDays || rep.SourceID == nil {
		t.Fatalf("create = %+v, %v", rep, err)
	}
	// One at a time.
	_, err = f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	wantStatus(t, "a second while one is queued", err, http.StatusConflict, "content_health_active")
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatal(err)
	}
	// The pause between two reports.
	f.svc.Cooldown = time.Hour
	_, err = f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	wantStatus(t, "a second inside the pause", err, http.StatusTooManyRequests, "content_health_wait")
	if e, _ := apperr.As(err); e == nil || e.RetryAfter <= 0 || e.RetryAfter > time.Hour {
		t.Errorf("the pause does not say when to try again: %v", err)
	}
	// Deleting the report does not reset the pause.
	if err := f.svc.Delete(f.ctx, f.ownerA, f.slugA, rep.ID); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	wantStatus(t, "a report made right after deleting the last", err, http.StatusTooManyRequests, "content_health_wait")
	// The other team has its own pause.
	if _, err := f.svc.Create(f.ctx, f.ownerB, f.slugB, CreateInput{}); err != nil {
		t.Errorf("team B was held up by team A's pause: %v", err)
	}
	f.svc.Cooldown = -1
	if _, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{}); err != nil {
		t.Errorf("after the pause: %v", err)
	}

	// The audit entry has IDs and thresholds, nothing from the team's content.
	var raw []byte
	if err := f.pool.QueryRow(f.ctx, `SELECT metadata FROM audit_log WHERE action = 'content_health.generate' AND metadata ? 'sourceId'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if len(meta) != 3 || meta["sourceId"] != mine.String() || meta["staleDays"] != float64(90) || meta["citationWindowDays"] != float64(90) {
		t.Errorf("audit metadata = %v, want the source ID and the two thresholds only", meta)
	}
}

// An archived team can read its reports but not make, cancel or delete one.
func TestArchivedTeamIsReadOnly(t *testing.T) {
	f := newFixture(t)
	rep := f.make(CreateInput{})
	f.exec(`UPDATE teams SET status = 'archived' WHERE id = $1`, f.teamA)
	if _, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID); err != nil {
		t.Errorf("read: %v", err)
	}
	_, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	wantStatus(t, "create", err, http.StatusConflict, "team_archived")
	_, err = f.svc.Cancel(f.ctx, f.ownerA, f.slugA, rep.ID)
	wantStatus(t, "cancel", err, http.StatusConflict, "team_archived")
	wantStatus(t, "delete", f.svc.Delete(f.ctx, f.ownerA, f.slugA, rep.ID), http.StatusConflict, "team_archived")
}

// A report stores and shows what the signals found, with the live names of its documents; a snapshot copies no name.
func TestReportEndToEnd(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	d := f.addDoc(f.teamA, src, doc{title: "Parking policy", processed: at(time.Now().AddDate(-3, 0, 0))})
	rep := f.make(CreateInput{})
	if rep.Status != StatusCompleted || rep.AsOf == nil || rep.ExpiresAt == nil || len(rep.Signals) != 5 {
		t.Fatalf("report = %+v", rep)
	}
	var stale SignalView
	for _, s := range rep.Signals {
		if s.Signal == SignalStale {
			stale = s
		}
	}
	if stale.Found != 1 || stale.Listed != 1 || stale.State != StateMeasured {
		t.Fatalf("stale = %+v", stale)
	}
	page, err := f.svc.Findings(f.ctx, f.editorA, f.slugA, rep.ID, SignalStale, 0, 10)
	if err != nil || len(page.Items) != 1 || page.Items[0].Title != "Parking policy" || page.Items[0].SourceName != "Handbook" || page.Items[0].ChangedSince {
		t.Fatalf("findings = %+v, %v", page, err)
	}
	// The snapshot has no title or name; renaming shows at once.
	f.exec(`UPDATE documents SET title = 'Parking rules', updated_at = now() WHERE id = $1`, d)
	f.exec(`UPDATE data_sources SET name = 'Handbook 2' WHERE id = $1`, src)
	page, _ = f.svc.Findings(f.ctx, f.editorA, f.slugA, rep.ID, SignalStale, 0, 10)
	if page.Items[0].Title != "Parking rules" || page.Items[0].SourceName != "Handbook 2" || !page.Items[0].ChangedSince {
		t.Errorf("after a rename: %+v, want live names and changed since the report", page.Items[0])
	}
	if n := f.count(`SELECT count(*) FROM content_health_findings WHERE ref LIKE '%Parking%' OR code LIKE '%Parking%' OR detail LIKE '%Parking%'`); n != 0 {
		t.Error("a title was copied into the snapshot")
	}
	if _, err := f.svc.Findings(f.ctx, f.editorA, f.slugA, rep.ID, "pii", 0, 10); err == nil {
		t.Error("an unknown signal is accepted")
	}
	d2, err := f.svc.Detail(f.ctx, f.editorA, f.slugA, rep.ID)
	if err != nil || len(d2.Sources) != 1 || d2.Sources[0].Name != "Handbook 2" || d2.Sources[0].Documents != 1 || d2.Sources[0].LinkState != LinkNotApplicable {
		t.Errorf("detail = %+v, %v", d2, err)
	}
}

// Findings follow deletions: a removed document, source or team takes its findings (and a removed report its findings) with it,
// at once, and a page never returns a row whose document is gone.
func TestDeletionRemovesFindings(t *testing.T) {
	f := newFixture(t)
	srcA, srcB := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload")
	old := doc{processed: at(time.Now().AddDate(-3, 0, 0))}
	dA1, dA2, dB := f.addDoc(f.teamA, srcA, old), f.addDoc(f.teamA, srcA, old), f.addDoc(f.teamA, srcB, old)
	rep := f.make(CreateInput{})
	count := func() (listed int64, rows int) {
		page, err := f.svc.Findings(f.ctx, f.ownerA, f.slugA, rep.ID, SignalStale, 0, 100)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID)
		for _, s := range got.Signals {
			if s.Signal == SignalStale {
				listed = s.Listed
			}
		}
		return listed, len(page.Items)
	}
	if l, n := count(); l != 3 || n != 3 {
		t.Fatalf("listed %d, page %d; want 3 and 3", l, n)
	}
	f.exec(`DELETE FROM documents WHERE id = $1`, dA1)
	if l, n := count(); l != 2 || n != 2 {
		t.Fatalf("after deleting a document: listed %d, page %d; want 2 and 2", l, n)
	}
	if f.count(`SELECT count(*) FROM content_health_findings WHERE document_id = $1`, dA1) != 0 {
		t.Error("the deleted document's finding is still stored")
	}
	f.exec(`DELETE FROM data_sources WHERE id = $1`, srcB)
	if l, _ := count(); l != 1 {
		t.Fatalf("after deleting a source: listed %d, want 1", l)
	}
	if f.count(`SELECT count(*) FROM content_health_sources WHERE source_id = $1`, srcB) != 0 || f.count(`SELECT count(*) FROM content_health_findings WHERE document_id = $1`, dB) != 0 {
		t.Error("the deleted source is still in the report")
	}
	// A document that moved to another team's source is not shown under this report (a stale row can't join across teams).
	f.exec(`UPDATE documents SET source_id = $1, team_id = $2 WHERE id = $3`, f.source(f.teamB, "Elsewhere", "upload"), f.teamB, dA2)
	if _, n := count(); n != 0 {
		t.Errorf("a document of another team shows in this report: %d rows", n)
	}
	// Deleting the report removes everything it stored.
	if err := f.svc.Delete(f.ctx, f.ownerA, f.slugA, rep.ID); err != nil {
		t.Fatal(err)
	}
	if f.count(`SELECT (SELECT count(*) FROM content_health_findings) + (SELECT count(*) FROM content_health_sources)`) != 0 {
		t.Error("a deleted report left findings or coverage")
	}
	// A deleted team takes its reports.
	rep2 := f.make(CreateInput{})
	f.exec(`DELETE FROM teams WHERE id = $1`, f.teamA)
	if f.count(`SELECT count(*) FROM content_health_reports WHERE id = $1`, rep2.ID) != 0 {
		t.Error("a deleted team's report is still stored")
	}
	// A source or knowledge base chosen as the scope takes the report with it.
	src := f.source(f.teamB, "Scoped", "upload")
	scoped, err := f.svc.Create(f.ctx, f.ownerB, f.slugB, CreateInput{SourceID: &src})
	if err != nil {
		t.Fatal(err)
	}
	f.exec(`DELETE FROM data_sources WHERE id = $1`, src)
	if f.count(`SELECT count(*) FROM content_health_reports WHERE id = $1`, scoped.ID) != 0 {
		t.Error("a report about a deleted source is still stored")
	}
}

// Reports are bounded in number and age: the latest KeepReports, each RetentionDays after it ended; an expired report is gone
// even before the job removes it.
func TestRetention(t *testing.T) {
	f := newFixture(t)
	var first Report
	for i := range KeepReports + 2 {
		rep := f.make(CreateInput{})
		if i == 0 {
			first = rep
		}
	}
	// Making a report prunes the team's older ones as it goes: the 5 latest remain (the 7th is the newest).
	l, _ := f.svc.List(f.ctx, f.ownerA, f.slugA)
	if len(l.Reports) != KeepReports || f.count(`SELECT count(*) FROM content_health_reports WHERE team_id = $1`, f.teamA) != KeepReports {
		t.Fatalf("%d reports listed, %d stored; want %d", len(l.Reports), f.count(`SELECT count(*) FROM content_health_reports`), KeepReports)
	}
	if _, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, first.ID); err == nil {
		t.Error("the oldest report survived")
	}
	// Expiry hides the report at once and the job removes it.
	newest := l.Reports[0]
	f.exec(`UPDATE content_health_reports SET expires_at = now() - interval '1 second' WHERE id = $1`, newest.ID)
	_, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, newest.ID)
	wantStatus(t, "an expired report", err, http.StatusNotFound, "content_health_report_not_found")
	if err := f.svc.Prune(f.ctx); err != nil {
		t.Fatal(err)
	}
	if f.count(`SELECT count(*) FROM content_health_reports WHERE id = $1`, newest.ID) != 0 {
		t.Error("the prune job left an expired report")
	}
	if f.count(`SELECT count(*) FROM content_health_findings WHERE report_id = $1`, newest.ID) != 0 {
		t.Error("an expired report's findings remain")
	}
	// A report is kept RetentionDays after it ended.
	var days int
	if err := f.pool.QueryRow(f.ctx, `SELECT round(extract(epoch FROM max(expires_at - finished_at)) / 86400)::int FROM content_health_reports`).Scan(&days); err != nil || days != RetentionDays {
		t.Errorf("reports are kept %d days after they end (%v), want %d", days, err, RetentionDays)
	}
	// A report that never started, or whose worker died, is ended by the job.
	stuck, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	f.exec(`UPDATE content_health_reports SET created_at = now() - interval '2 hours' WHERE id = $1`, stuck.ID)
	if err := f.svc.Prune(f.ctx); err != nil {
		t.Fatal(err)
	}
	got, _ := f.svc.Get(f.ctx, f.ownerA, f.slugA, stuck.ID)
	if got.Status != StatusFailed || got.ErrorCode != ErrTimedOut {
		t.Errorf("a queued report nobody took: %s %s, want failed timed_out", got.Status, got.ErrorCode)
	}
	if _, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{}); err != nil {
		t.Errorf("a stuck report still blocks the team: %v", err)
	}
}

// Running a report reads and writes only its own tables: nothing of the team's content is changed, deleted, reclassified or
// re-queued, and no answer data is touched.
func TestReportChangesNothingElse(t *testing.T) {
	f := newFixture(t)
	web := f.source(f.teamA, "Site", "web")
	up := f.source(f.teamA, "Files", "upload")
	old := doc{processed: at(time.Now().AddDate(-3, 0, 0))}
	f.addDoc(f.teamA, web, old)
	f.addDoc(f.teamA, up, doc{status: "failed", errCode: "corrupt"})
	f.addDoc(f.teamA, up, doc{sha: "x"})
	f.addDoc(f.teamA, web, doc{sha: "x"})
	f.answers(f.teamA, f.agent(f.teamA), 60, time.Now().AddDate(0, 0, -3), "ui")
	state := func() string {
		var s string
		err := f.pool.QueryRow(f.ctx, `SELECT md5(concat_ws('|',
			(SELECT string_agg(d::text, ',' ORDER BY d.id) FROM documents d),
			(SELECT string_agg(s::text, ',' ORDER BY s.id) FROM data_sources s),
			(SELECT string_agg(c::text, ',' ORDER BY c.id) FROM chunks c),
			(SELECT string_agg(e::text, ',' ORDER BY e.id) FROM message_events e),
			(SELECT count(*)::text FROM web_crawls), (SELECT count(*)::text FROM web_frontier),
			(SELECT count(*)::text FROM river_job WHERE kind NOT LIKE 'content_health%'),
			(SELECT count(*)::text FROM deleted_files)))`).Scan(&s)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := state()
	f.make(CreateInput{})
	if after := state(); after != before {
		t.Error("making a report changed documents, sources, passages, answer events, crawls, jobs or files")
	}
}

// A signal that takes too long is unavailable (timed_out) and the others still run; the report is stored.
type slowSignal struct{}

func (slowSignal) Name() string { return "slow" }
func (slowSignal) Collect(ctx context.Context, _ *Env) (Result, error) {
	<-ctx.Done()
	return Result{}, ctx.Err()
}

func TestSlowSignalTimesOut(t *testing.T) {
	f := newFixture(t)
	f.svc.Signals = append([]Signal{slowSignal{}}, Registry()...)
	f.svc.SignalLimit = 400 * time.Millisecond
	rep := f.make(CreateInput{})
	if rep.Status != StatusCompleted || len(rep.Signals) != 6 {
		t.Fatalf("report = %s with %d signals, want completed with 6", rep.Status, len(rep.Signals))
	}
	if s := rep.Signals[0]; s.Signal != "slow" || s.State != StateUnavailable || s.Reason != ReasonTimedOut {
		t.Errorf("the slow signal = %+v, want unavailable (timed out)", s)
	}
	if s := rep.Signals[1]; s.Signal != SignalStale || s.State == "" {
		t.Errorf("the next signal did not run: %+v", s)
	}
}

// The number of findings stored is capped, and the true count is kept and shown.
func TestFindingsAreCapped(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Big", "upload")
	f.exec(`INSERT INTO documents (source_id, team_id, external_id, status, sha256, processed_at, created_at)
		SELECT $1, $2, 'bulk-' || g, 'ready', 'h' || g, now() - interval '5 years' - g * interval '1 minute', now() - interval '6 years' FROM generate_series(1, $3) g`,
		src, f.teamA, MaxFindingsPerSignal+25)
	rep := f.make(CreateInput{})
	var stale SignalView
	for _, s := range rep.Signals {
		if s.Signal == SignalStale {
			stale = s
		}
	}
	if stale.Found != MaxFindingsPerSignal+25 || stale.Listed != MaxFindingsPerSignal || !stale.Truncated {
		t.Fatalf("stale = found %d listed %d truncated %v; want %d, %d, true", stale.Found, stale.Listed, stale.Truncated, MaxFindingsPerSignal+25, MaxFindingsPerSignal)
	}
	// Pages are bounded and keyset-paged.
	var seen int
	var after int32
	for pages := 0; ; pages++ {
		p, err := f.svc.Findings(f.ctx, f.ownerA, f.slugA, rep.ID, SignalStale, after, 1_000_000)
		if err != nil {
			t.Fatal(err)
		}
		if len(p.Items) > PageSize {
			t.Fatalf("a page of %d findings, over the bound %d", len(p.Items), PageSize)
		}
		seen += len(p.Items)
		if p.After == 0 {
			break
		}
		after = p.After
	}
	if seen != MaxFindingsPerSignal {
		t.Errorf("paging saw %d findings, want %d", seen, MaxFindingsPerSignal)
	}
	// A scope over MaxSources fails with a coarse code.
	f.exec(`INSERT INTO data_sources (team_id, name, type, classification, embedding_profile_id)
		SELECT $1, 'bulk ' || g, 'upload', 'open', $2 FROM generate_series(1, $3) g`, f.teamA, f.profile, MaxSources)
	rep = f.make(CreateInput{})
	if rep.Status != StatusFailed || rep.ErrorCode != ErrTooManySources {
		t.Errorf("a team with %d sources: %s %s, want failed too_many_sources", MaxSources+1, rep.Status, rep.ErrorCode)
	}
}

// Cancel: a queued report is cancelled at once and never runs; one that is running stops at its next step and stores nothing;
// an ended one can't be cancelled.
type cancelSignal struct{ cancel func() }

func (cancelSignal) Name() string { return "canceller" }
func (c cancelSignal) Collect(context.Context, *Env) (Result, error) {
	c.cancel()
	return Result{State: StateMeasured, Findings: []Finding{{}}}, nil
}

func TestCancel(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})

	queued, err := f.svc.Create(f.ctx, f.editorA, f.slugA, CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	got, err := f.svc.Cancel(f.ctx, f.editorA, f.slugA, queued.ID)
	if err != nil || got.Status != StatusCancelled {
		t.Fatalf("cancel a queued report = %+v, %v", got, err)
	}
	if err := f.svc.Execute(f.ctx, queued.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ = f.svc.Get(f.ctx, f.editorA, f.slugA, queued.ID); got.Status != StatusCancelled || f.count(`SELECT count(*) FROM content_health_findings`) != 0 {
		t.Fatalf("a cancelled queued report ran: %+v", got)
	}
	_, err = f.svc.Cancel(f.ctx, f.editorA, f.slugA, queued.ID)
	wantStatus(t, "cancelling an ended report", err, http.StatusConflict, "content_health_ended")
	_, err = f.svc.Cancel(f.ctx, f.editorA, f.slugA, uuid.New())
	wantStatus(t, "cancelling a report that does not exist", err, http.StatusNotFound, "content_health_report_not_found")

	// Running: cancelled during its first signal, it stops before the next and stores nothing.
	running, err := f.svc.Create(f.ctx, f.editorA, f.slugA, CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	f.svc.Signals = []Signal{cancelSignal{cancel: func() {
		if _, err := f.svc.Cancel(f.ctx, f.editorA, f.slugA, running.ID); err != nil {
			t.Errorf("cancel while running: %v", err)
		}
	}}, staleSignal{}}
	if err := f.svc.Execute(f.ctx, running.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ = f.svc.Get(f.ctx, f.editorA, f.slugA, running.ID); got.Status != StatusCancelled || len(got.Signals) != 0 {
		t.Fatalf("a report cancelled while running: %+v", got)
	}
	if f.count(`SELECT count(*) FROM content_health_findings WHERE report_id = $1`, running.ID) != 0 || f.count(`SELECT count(*) FROM content_health_sources WHERE report_id = $1`, running.ID) != 0 {
		t.Error("a cancelled report stored findings")
	}
	// Delete refuses a report in progress.
	f.svc.Signals = nil
	live, _ := f.svc.Create(f.ctx, f.editorA, f.slugA, CreateInput{})
	wantStatus(t, "deleting a queued report", f.svc.Delete(f.ctx, f.editorA, f.slugA, live.ID), http.StatusConflict, "content_health_active")
}

// A report that was deleted while it ran stores nothing and does not fail.
type deleteSignal struct{ f *fixture }

func (deleteSignal) Name() string { return "deleter" }
func (d deleteSignal) Collect(context.Context, *Env) (Result, error) {
	d.f.exec(`DELETE FROM content_health_reports`)
	return Result{State: StateMeasured}, nil
}

func TestDeletedWhileRunning(t *testing.T) {
	f := newFixture(t)
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	f.svc.Signals = []Signal{deleteSignal{f}, staleSignal{}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatalf("a report deleted while it ran: %v", err)
	}
	if f.count(`SELECT count(*) FROM content_health_reports`) != 0 {
		t.Error("the deleted report came back")
	}
}

// Turning the feature off while a report waits ends it (failed: disabled) instead of running it.
func TestQueuedReportDoesNotRunWhileOff(t *testing.T) {
	f := newFixture(t)
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	f.exec(`UPDATE content_health_settings SET enabled = false`)
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatal(err)
	}
	var status, code string
	if err := f.pool.QueryRow(f.ctx, `SELECT status, error_code FROM content_health_reports WHERE id = $1`, rep.ID).Scan(&status, &code); err != nil {
		t.Fatal(err)
	}
	if status != StatusFailed || code != ErrDisabled {
		t.Errorf("a queued report with the switch off: %s %s, want failed disabled", status, code)
	}
}

// A cancel that arrives during the last signal, after the last check, still stores nothing: the report's end is claimed in the
// storing transaction, and a cancelled report can't be ended.
func TestCancelDuringTheLastSignalStoresNothing(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})
	rep, err := f.svc.Create(f.ctx, f.editorA, f.slugA, CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	f.svc.Signals = []Signal{staleSignal{}, cancelSignal{cancel: func() {
		if _, err := f.svc.Cancel(f.ctx, f.editorA, f.slugA, rep.ID); err != nil {
			t.Errorf("cancel: %v", err)
		}
	}}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := f.svc.Get(f.ctx, f.editorA, f.slugA, rep.ID)
	if got.Status != StatusCancelled || f.count(`SELECT count(*) FROM content_health_findings`) != 0 || f.count(`SELECT count(*) FROM content_health_sources`) != 0 {
		t.Fatalf("report = %s with %d findings: a cancelled report was ended and stored", got.Status, f.count(`SELECT count(*) FROM content_health_findings`))
	}
}

// Whatever a signal returns, at most MaxFindingsPerSignal are stored, and the report says it was cut.
func TestStoredFindingsNeverExceedTheCap(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	f.svc.Signals = []Signal{floodWith{src}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT count(*) FROM content_health_findings WHERE signal = 'flood'`); n != MaxFindingsPerSignal {
		t.Fatalf("%d findings stored, want the cap %d", n, MaxFindingsPerSignal)
	}
	got, _ := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID)
	if len(got.Signals) != 1 || !got.Signals[0].Truncated || got.Signals[0].Found != MaxFindingsPerSignal+500 {
		t.Fatalf("signal = %+v, want truncated with the true count", got.Signals)
	}
}

type floodWith struct{ src uuid.UUID }

func (floodWith) Name() string { return "flood" }
func (w floodWith) Collect(context.Context, *Env) (Result, error) {
	fs := make([]Finding, MaxFindingsPerSignal+500)
	for i := range fs {
		fs[i].SourceID = w.src
	}
	return Result{State: StateMeasured, Found: int64(len(fs)), Findings: fs}, nil
}
