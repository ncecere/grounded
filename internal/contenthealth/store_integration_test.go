package contenthealth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/testutil"
)

// The signals are collected minutes before they are stored, so what they name can be deleted in between. These tests delete it at
// that moment and assert the report still ends (never left running), what was deleted is skipped, and the counts add up.

// midRun runs a function when its turn comes in a report, as a signal that finds nothing.
type midRun struct {
	name string
	fn   func()
}

func (m midRun) Name() string { return m.name }
func (m midRun) Collect(context.Context, *Env) (Result, error) {
	m.fn()
	return Result{State: StateMeasured}, nil
}

func (f *fixture) status(id uuid.UUID) (status, code string) {
	f.t.Helper()
	if err := f.pool.QueryRow(f.ctx, `SELECT status, error_code FROM content_health_reports WHERE id = $1`, id).Scan(&status, &code); err != nil {
		f.t.Fatal(err)
	}
	return status, code
}

func signalOf(r Report, name string) SignalView {
	for _, s := range r.Signals {
		if s.Signal == name {
			return s
		}
	}
	return SignalView{}
}

// A source and a document deleted between collecting and storing used to roll the whole store back on a foreign-key error
// (23503), leaving the report running until the hourly job marked it failed, wrongly timed out. Now they are skipped and the
// counts say how many.
func TestStoreSurvivesDeletionsBetweenCollectAndStore(t *testing.T) {
	f := newFixture(t)
	a, b := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload")
	old := doc{processed: at(time.Now().AddDate(-3, 0, 0))}
	oldSame := old
	oldSame.sha = "same-bytes"
	dA1, dA2 := f.addDoc(f.teamA, a, old), f.addDoc(f.teamA, a, oldSame)
	f.addDoc(f.teamA, b, oldSame)
	failedInB := f.addDoc(f.teamA, b, doc{status: "failed", errCode: "corrupt"})
	rep, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	f.svc.Signals = []Signal{staleSignal{}, duplicateSignal{}, failureSignal{}, midRun{"deleter", func() {
		f.exec(`DELETE FROM documents WHERE id = $1`, dA1)  // one document
		f.exec(`DELETE FROM data_sources WHERE id = $1`, b) // and one source, with its documents
	}}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatalf("a report whose source and document vanished while it ran: %v (before the fix: a foreign-key error)", err)
	}
	if st, code := f.status(rep.ID); st != StatusCompleted || code != "" {
		t.Fatalf("report is %s %q, want completed: it must not be left running", st, code)
	}
	got, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID)
	if err != nil {
		t.Fatal(err)
	}
	stale, dup, fail := signalOf(got, SignalStale), signalOf(got, SignalDuplicate), signalOf(got, SignalIngestionFailure)
	// Four stale documents were collected (dA1, dA2, dB, and not the failed one: three); two of them vanished.
	if stale.Found != 1 || stale.Listed != 1 || stale.Counts["vanished"] != 2 || stale.Truncated {
		t.Errorf("stale = %+v, want 1 found and 1 listed, 2 vanished", stale)
	}
	// The one group named dA2 and dB: with B gone it is a lone survivor, not a duplicate.
	if dup.Found != 0 || dup.Listed != 0 || dup.Counts["vanished"] != 1 {
		t.Errorf("duplicates = %+v, want the group dropped (1 vanished), 0 found and listed", dup)
	}
	if fail.Found != 0 || fail.Listed != 0 || fail.Counts["vanished"] != 1 {
		t.Errorf("failures = %+v, want the failed document of the deleted source dropped", fail)
	}
	d, err := f.svc.Detail(f.ctx, f.ownerA, f.slugA, rep.ID)
	if err != nil || len(d.Sources) != 1 || d.Sources[0].SourceID != a {
		t.Errorf("coverage = %+v, %v, want only the source that still exists", d.Sources, err)
	}
	if f.count(`SELECT count(*) FROM content_health_findings WHERE document_id IN ($1, $2)`, dA1, failedInB) != 0 {
		t.Error("a finding of a vanished document was stored")
	}
	if n := f.count(`SELECT count(*) FROM content_health_findings WHERE document_id = $1`, dA2); n != 1 {
		t.Errorf("%d stored findings for the surviving document, want 1 (the stale one)", n)
	}
}

// A document that left the report's knowledge base between collecting and storing is skipped too: the scope is checked again.
func TestStoreSkipsSourcesThatLeftTheScope(t *testing.T) {
	f := newFixture(t)
	a, b := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload")
	kb := f.kb(f.teamA, time.Time{}, a, b)
	old := doc{processed: at(time.Now().AddDate(-3, 0, 0))}
	f.addDoc(f.teamA, a, old)
	f.addDoc(f.teamA, b, old)
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{KBID: &kb})
	f.svc.Signals = []Signal{staleSignal{}, midRun{"detach", func() { f.exec(`DELETE FROM kb_sources WHERE kb_id = $1 AND source_id = $2`, kb, b) }}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID)
	if s := signalOf(got, SignalStale); got.Status != StatusCompleted || s.Found != 1 || s.Listed != 1 || s.Counts["vanished"] != 1 {
		t.Fatalf("report %s, stale %+v, want completed, 1 found and listed, 1 vanished (left the knowledge base)", got.Status, s)
	}
	if f.count(`SELECT count(*) FROM content_health_sources WHERE report_id = $1 AND source_id = $2`, rep.ID, b) != 0 {
		t.Error("the source that left the scope is in the report's coverage")
	}
}

// What is checked is also locked: a deletion that arrives while the store runs waits for it, so no foreign-key error can happen
// even inside the window between the check and the insert. The finding is stored and then removed with its document.
func TestStoreLocksWhatItChecked(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "A", "upload")
	d := f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	done := make(chan error, 1)
	var deleted atomic.Bool
	f.svc.afterLock = func() {
		go func() {
			_, err := f.pool.Exec(f.ctx, `DELETE FROM data_sources WHERE id = $1`, src)
			deleted.Store(true)
			done <- err
		}()
		time.Sleep(500 * time.Millisecond) // the deletion has had every chance to run
		if deleted.Load() {
			t.Error("the source was deleted while the store held it: it was checked but not locked")
		}
	}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatalf("store: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if st, _ := f.status(rep.ID); st != StatusCompleted {
		t.Errorf("report is %s, want completed", st)
	}
	if f.count(`SELECT count(*) FROM content_health_findings WHERE document_id = $1`, d) != 0 {
		t.Error("the finding survived its document's deletion")
	}
}

// Whatever else goes wrong in the store is a real error: the report ends failed (internal) at once and the error is returned,
// not left running and not reported as success.
func TestStoreErrorFailsTheReportAndIsReturned(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "A", "upload")
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	f.svc.Signals = []Signal{badSignal{src}}
	err := f.svc.Execute(f.ctx, rep.ID)
	if err == nil {
		t.Fatal("a store that could not write reported success")
	}
	if st, code := f.status(rep.ID); st != StatusFailed || code != ErrInternal {
		t.Fatalf("report is %s %q, want failed internal (before the fix: left running until the hourly job, as timed_out)", st, code)
	}
	if f.count(`SELECT count(*) FROM content_health_findings`) != 0 || f.count(`SELECT count(*) FROM content_health_sources`) != 0 {
		t.Error("a failed store left rows behind")
	}
	if _, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{}); err != nil {
		t.Errorf("a failed report still blocks the team: %v", err)
	}
}

// badSignal returns a finding the table refuses (an address over its length check).
type badSignal struct{ src uuid.UUID }

func (badSignal) Name() string { return "bad" }
func (b badSignal) Collect(context.Context, *Env) (Result, error) {
	return Result{State: StateMeasured, Found: 1, Findings: []Finding{{SourceID: b.src, Ref: strings.Repeat("x", 3000)}}}, nil
}

// A report deleted, or its team deleted, while it ran ends nothing and does not fail.
func TestStoreAfterTeamOrReportDeleted(t *testing.T) {
	f := newFixture(t)
	f.source(f.teamB, "B", "upload")
	rep, _ := f.svc.Create(f.ctx, f.ownerB, f.slugB, CreateInput{})
	f.svc.Signals = []Signal{staleSignal{}, midRun{"team", func() { f.exec(`DELETE FROM teams WHERE id = $1`, f.teamB) }}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatalf("a report whose team was deleted while it ran: %v", err)
	}
	if f.count(`SELECT count(*) FROM content_health_reports WHERE id = $1`, rep.ID) != 0 {
		t.Error("the report of a deleted team is still stored")
	}
}

// A final-signal cancel arriving after the last check still stores nothing; the claim of the end is what decides.
func TestCancelAfterTheLastSignalBeforeStoreStoresNothing(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "A", "upload")
	f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	f.svc.Signals = []Signal{staleSignal{}}
	// Collect, then cancel as a request does, then store: the cancel arrives after the last check.
	ctx := f.ctx
	started, err := f.svc.q.StartContentHealthReport(ctx, rep.ID)
	if err != nil {
		t.Fatal(err)
	}
	out, err := f.svc.collect(ctx, started, *started.AsOf)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Cancel(ctx, f.editorA, f.slugA, rep.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.store(ctx, started, out); err != nil {
		t.Fatalf("storing a cancelled report: %v", err)
	}
	if st, _ := f.status(rep.ID); st != StatusCancelled || f.count(`SELECT count(*) FROM content_health_findings`) != 0 {
		t.Errorf("report is %s with findings stored: a cancelled report must store nothing", st)
	}
}

// ---- the platform switch at the boundaries -----------------------------------------------------------------------------------

type offSignal struct{ f *fixture }

func (offSignal) Name() string { return "off" }
func (o offSignal) Collect(context.Context, *Env) (Result, error) {
	o.f.exec(`UPDATE content_health_settings SET enabled = false`)
	return Result{State: StateMeasured}, nil
}

type countingSignal struct{ calls *atomic.Int32 }

func (countingSignal) Name() string { return "counting" }
func (c countingSignal) Collect(context.Context, *Env) (Result, error) {
	c.calls.Add(1)
	return Result{State: StateMeasured}, nil
}

// Turning the feature off while a report runs stops the scan at the next signal: no further signal reads anything, and nothing is
// stored. The report ends failed (disabled).
func TestSwitchedOffMidRunStopsTheScan(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "A", "upload")
	f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	var later atomic.Int32
	f.svc.Signals = []Signal{staleSignal{}, offSignal{f}, countingSignal{&later}, staleSignal{}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatal(err)
	}
	if n := later.Load(); n != 0 {
		t.Errorf("%d signals ran after the feature was switched off", n)
	}
	if st, code := f.status(rep.ID); st != StatusFailed || code != ErrDisabled {
		t.Errorf("report is %s %q, want failed disabled", st, code)
	}
	if f.count(`SELECT count(*) FROM content_health_findings`)+f.count(`SELECT count(*) FROM content_health_sources`) != 0 {
		t.Error("a report switched off mid-run stored something")
	}
}

// Switched off during the last signal (after the last check): the store checks the switch again and stores nothing.
func TestSwitchedOffDuringTheLastSignalStoresNothing(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "A", "upload")
	f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})
	rep, _ := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	f.svc.Signals = []Signal{staleSignal{}, offSignal{f}}
	if err := f.svc.Execute(f.ctx, rep.ID); err != nil {
		t.Fatal(err)
	}
	if st, code := f.status(rep.ID); st != StatusFailed || code != ErrDisabled {
		t.Errorf("report is %s %q, want failed disabled", st, code)
	}
	if f.count(`SELECT count(*) FROM content_health_findings`)+f.count(`SELECT count(*) FROM content_health_sources`) != 0 {
		t.Error("a report switched off before its store stored something")
	}
}

// While the feature is off an editor, admin or owner can still cancel what is being made and delete what is kept; a member, every
// kind of key, platform staff, an outsider and an archived team's editor cannot. Making a report and reading one stay closed, and
// the list shows stubs: no signal, count or finding.
func TestCancelAndDeleteWorkWhileOffForTheSamePeopleOnly(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})
	ended := f.make(CreateInput{})
	queued, err := f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE content_health_settings SET enabled = false`)

	key := authz.Actor{UserID: f.ownerA.UserID, Key: &authz.KeyGrant{ID: uuid.New(), TeamID: f.teamA, Scopes: []string{"query", "ingest", "manage"}}}
	oauth := authz.Actor{UserID: f.ownerA.UserID, OAuth: &authz.OAuthGrant{ID: uuid.New(), ClientName: "Client"}}
	for who, a := range map[string]authz.Actor{"member": f.memberA, "other team's owner": f.ownerB, "platform admin": f.platformAdmin, "auditor": f.auditor,
		"API key": key, "OAuth client": oauth, "nobody": {}} {
		_, err := f.svc.Cancel(f.ctx, a, f.slugA, queued.ID)
		wantStatus(t, who+" cancels while off", err, http.StatusNotFound, "")
		wantStatus(t, who+" deletes while off", f.svc.Delete(f.ctx, a, f.slugA, ended.ID), http.StatusNotFound, "")
		_, err = f.svc.List(f.ctx, a, f.slugA)
		wantStatus(t, who+" lists while off", err, http.StatusNotFound, "")
	}
	if st, _ := f.status(queued.ID); st != StatusQueued || f.count(`SELECT count(*) FROM content_health_reports WHERE id = $1`, ended.ID) != 1 {
		t.Fatal("someone who may not act changed a report while the feature was off")
	}
	// Reads and creation stay closed to the team too.
	_, err = f.svc.Create(f.ctx, f.ownerA, f.slugA, CreateInput{})
	wantStatus(t, "create while off", err, http.StatusConflict, "content_health_off")
	_, err = f.svc.Get(f.ctx, f.ownerA, f.slugA, ended.ID)
	wantStatus(t, "read while off", err, http.StatusNotFound, "not_found")
	_, err = f.svc.Findings(f.ctx, f.ownerA, f.slugA, ended.ID, SignalStale, 0, 10)
	wantStatus(t, "findings while off", err, http.StatusNotFound, "not_found")
	l, err := f.svc.List(f.ctx, f.editorA, f.slugA)
	if err != nil || l.Enabled || len(l.Reports) != 2 {
		t.Fatalf("list while off = %+v, %v; want 2 stubs", l, err)
	}
	for _, r := range l.Reports {
		if len(r.Signals) != 0 {
			t.Errorf("a stub carries %d signals: what a report found must stay hidden while off", len(r.Signals))
		}
	}
	// An archived team stays read-only, off or on.
	f.exec(`UPDATE teams SET status = 'archived' WHERE id = $1`, f.teamA)
	_, err = f.svc.Cancel(f.ctx, f.ownerA, f.slugA, queued.ID)
	wantStatus(t, "archived team cancels", err, http.StatusConflict, "team_archived")
	wantStatus(t, "archived team deletes", f.svc.Delete(f.ctx, f.ownerA, f.slugA, ended.ID), http.StatusConflict, "team_archived")
	f.exec(`UPDATE teams SET status = 'active' WHERE id = $1`, f.teamA)

	// The team's editors can stop and remove what is kept, audited as always.
	got, err := f.svc.Cancel(f.ctx, f.editorA, f.slugA, queued.ID)
	if err != nil || got.Status != StatusCancelled || len(got.Signals) != 0 {
		t.Fatalf("cancel while off = %+v, %v; want a cancelled stub", got, err)
	}
	if err := f.svc.Delete(f.ctx, f.adminA, f.slugA, ended.ID); err != nil {
		t.Fatalf("delete while off: %v", err)
	}
	if f.count(`SELECT count(*) FROM content_health_findings`) != 0 {
		t.Error("deleting a report while off left its findings")
	}
	for _, action := range []string{"content_health.cancel", "content_health.delete"} {
		if n := f.count(`SELECT count(*) FROM audit_log WHERE action = $1`, action); n != 1 {
			t.Errorf("%d audit entries for %s, want 1", n, action)
		}
	}
	if err := f.svc.Delete(f.ctx, f.editorA, f.slugA, queued.ID); err != nil {
		t.Errorf("delete of a cancelled report while off: %v", err)
	}
}

// ---- timeouts ---------------------------------------------------------------------------------------------------------------

// slowLinks reads the crawl records as the real signal does, and then does not finish in time.
type slowLinks struct{ linkSignal }

func (s slowLinks) Collect(ctx context.Context, env *Env) (Result, error) {
	if _, err := s.linkSignal.Collect(ctx, env); err != nil {
		return Result{}, err
	}
	<-ctx.Done()
	return Result{}, ctx.Err()
}

// A signal that wrote coverage and then timed out must not leave it behind: the source must not read "observed" under a signal
// that says "timed out".
func TestTimedOutSignalDoesNotLeaveObservedCoverage(t *testing.T) {
	f := newFixture(t)
	web := f.source(f.teamA, "Site", "web")
	crawl := f.id(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'completed', 'schedule', '{}', $3) RETURNING id`, web, f.teamA, asOf.AddDate(0, 0, -1))
	f.exec(`INSERT INTO web_frontier (crawl_id, url, depth, status, reason, http_status) VALUES ($1, 'https://example.edu/gone', 0, 'failed', 'not_found', 404)`, crawl)
	up := f.source(f.teamA, "Files", "upload")
	f.svc.Signals = []Signal{slowLinks{}}
	f.svc.SignalLimit = 400 * time.Millisecond
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	if s := res.signal(SignalBrokenLink); s.State != StateUnavailable || s.Reason != ReasonTimedOut {
		t.Fatalf("links = %+v, want unavailable (timed out)", s)
	}
	cov := res.coverage(web)
	if cov.LinkState == LinkObserved || cov.LinkFailed != 0 || cov.LinkCrawlAt != nil || cov.LinkState != LinkUnknown || cov.LinkReason != LinkSignalTimedOut {
		t.Errorf("coverage after a timed-out signal = %+v, want unknown (signal timed out), nothing observed", cov)
	}
	if c := res.coverage(up); c.LinkState != LinkNotApplicable {
		t.Errorf("an upload source's links = %s, want not applicable whatever happens", c.LinkState)
	}
}

// slowQuery runs a real long statement on the server.
type slowQuery struct{ f *fixture }

func (slowQuery) Name() string { return "sleeper" }
func (s slowQuery) Collect(ctx context.Context, _ *Env) (Result, error) {
	_, err := s.f.pool.Exec(ctx, `SELECT pg_sleep(61)`)
	return Result{}, err
}

// The 45 s limit is the context deadline of the report's own queries, not a server statement_timeout; the driver cancels the
// statement on the server when it passes. A real pg_sleep shows it: the signal is unavailable (timed out) at the limit, and the
// backend is no longer running the statement afterwards.
func TestSignalLimitCancelsTheRunningStatementOnTheServer(t *testing.T) {
	f := newFixture(t)
	f.svc.Signals = []Signal{slowQuery{f}}
	f.svc.SignalLimit = 600 * time.Millisecond
	start := time.Now()
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	if took := time.Since(start); took > 20*time.Second {
		t.Fatalf("the report took %v: the statement ran to its end", took)
	}
	if s := res.signal("sleeper"); s.State != StateUnavailable || s.Reason != ReasonTimedOut {
		t.Fatalf("sleeper = %+v, want unavailable (timed out)", s)
	}
	deadline := time.Now().Add(testutil.Scale(10 * time.Second))
	for {
		n := f.count(`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND query LIKE '%pg_sleep(61)%' AND pid <> pg_backend_pid()`)
		if n == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d backends still run the statement after the limit: it was abandoned by the client, not cancelled", n)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// ---- no network, no model -----------------------------------------------------------------------------------------------------

type countingTransport struct{ n atomic.Int32 }

func (c *countingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	c.n.Add(1)
	return nil, errors.New("content health must make no HTTP request")
}

// Evidence (not proof) that a whole report, from a request to its stored findings, makes no HTTP request and calls no model: the
// default HTTP transport is replaced by one that counts and refuses, and the model connection points at a server that counts.
// A dial that bypassed the default transport (a package with its own client) would not be seen here; the import test and the code
// review cover that.
func TestReportMakesNoHTTPRequestsAndCallsNoModel(t *testing.T) {
	f := newFixture(t)
	var modelHits atomic.Int32
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { modelHits.Add(1); http.Error(w, "no", http.StatusTeapot) }))
	defer model.Close()
	f.exec(`UPDATE model_connections SET base_url = $1`, model.URL+"/v1")
	web, up := f.source(f.teamA, "Site", "web"), f.source(f.teamA, "Files", "upload")
	crawl := f.id(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'completed', 'schedule', '{}', now()) RETURNING id`, web, f.teamA)
	f.exec(`INSERT INTO web_frontier (crawl_id, url, depth, status, reason, http_status) VALUES ($1, 'https://example.edu/gone', 0, 'failed', 'not_found', 404)`, crawl)
	old := doc{processed: at(time.Now().AddDate(-3, 0, 0)), sha: "x"}
	f.addDoc(f.teamA, web, old)
	f.addDoc(f.teamA, up, old)
	f.answers(f.teamA, f.served(f.teamA, web, up), 60, time.Now().AddDate(0, 0, -3), "ui")

	ct := &countingTransport{}
	prev := http.DefaultTransport
	http.DefaultTransport = ct
	t.Cleanup(func() { http.DefaultTransport = prev })
	rep := f.make(CreateInput{})
	http.DefaultTransport = prev
	if rep.Status != StatusCompleted || signalOf(rep, SignalBrokenLink).Found != 1 || signalOf(rep, SignalDuplicate).Found != 1 {
		t.Fatalf("report = %+v, want a real report with a link failure and a duplicate", rep)
	}
	if n := ct.n.Load(); n != 0 {
		t.Errorf("%d HTTP requests through the default transport while making a report", n)
	}
	if n := modelHits.Load(); n != 0 {
		t.Errorf("%d requests to the model connection while making a report", n)
	}
}
