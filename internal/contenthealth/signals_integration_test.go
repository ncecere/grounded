package contenthealth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

var asOf = time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

// "Not processed in a long time": a ready document last processed at least staleDays before asOf; exactly staleDays counts, a
// second newer does not; no date is unknown, never stale or fresh; other teams, shared sources and documents that are not
// ready are not judged.
func TestStaleBoundaryAndScope(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	cutoff := StaleCutoff(asOf, 365)
	exact := f.addDoc(f.teamA, src, doc{processed: at(cutoff)})
	justOver := f.addDoc(f.teamA, src, doc{processed: at(cutoff.Add(-time.Second))})
	justUnder := f.addDoc(f.teamA, src, doc{processed: at(cutoff.Add(time.Second))})
	noDate := f.addDoc(f.teamA, src, doc{noDate: true})
	failed := f.addDoc(f.teamA, src, doc{status: "failed", processed: at(cutoff.Add(-30 * 24 * time.Hour))})
	otherTeam := f.addDoc(f.teamB, f.source(f.teamB, "Theirs", "upload"), doc{processed: at(cutoff.Add(-time.Hour))})
	shared := f.addDoc(uuid.Nil, f.source(uuid.Nil, "Shared", "upload"), doc{processed: at(cutoff.Add(-time.Hour))})

	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	stale := res.signal(SignalStale)
	if stale.State != StateMeasured || stale.Found != 2 || stale.Truncated {
		t.Fatalf("stale = %+v, want measured with 2 found", stale)
	}
	got := ids(res.findings(SignalStale))
	if len(got) != 2 || got[0] != justOver || got[1] != exact { // oldest first
		t.Fatalf("stale documents = %v, want [%v %v]", got, justOver, exact)
	}
	for name, id := range map[string]uuid.UUID{"a second newer": justUnder, "no date": noDate, "failed": failed, "another team's": otherTeam, "a shared source's": shared} {
		if contains(got, id) {
			t.Errorf("%s document is listed as stale", name)
		}
	}
	if stale.Counts["ageUnknown"] != 1 || stale.Counts["ready"] != 4 {
		t.Errorf("counts = %v, want 1 with no date among 4 ready", stale.Counts)
	}
	if age := res.findings(SignalStale)[1].Value; age != 365 {
		t.Errorf("age of the exact document = %d days, want 365", age)
	}
	// A shorter threshold takes the newer ones too; the boundary moves with it.
	if n := f.collect(f.teamA, asOf, 30, 90, nil, nil).signal(SignalStale).Found; n != 3 {
		t.Errorf("30 days: %d stale, want 3 (a document's age is its own, not the source's)", n)
	}
}

// A web page shows when a crawl last confirmed it, when its crawl record is kept; without one the time is absent.
func TestStaleShowsLastConfirmation(t *testing.T) {
	f := newFixture(t)
	web := f.source(f.teamA, "Site", "web")
	crawl := f.id(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'completed', 'schedule', '{}', $3) RETURNING id`,
		web, f.teamA, asOf.AddDate(0, 0, -3))
	seen := f.addDoc(f.teamA, web, doc{processed: at(asOf.AddDate(-2, 0, 0))})
	f.exec(`UPDATE documents SET last_seen_crawl_id = $1 WHERE id = $2`, crawl, seen)
	unseen := f.addDoc(f.teamA, web, doc{processed: at(asOf.AddDate(-2, 0, 0))})
	fs := f.collect(f.teamA, asOf, 365, 90, nil, nil).findings(SignalStale)
	for _, fd := range fs {
		switch fd.DocumentID {
		case seen:
			if !fd.ConfirmedAt.Equal(asOf.AddDate(0, 0, -3)) {
				t.Errorf("confirmed at %v, want 3 days before", fd.ConfirmedAt)
			}
		case unseen:
			if !fd.ConfirmedAt.IsZero() {
				t.Errorf("an unconfirmed page shows a confirmation time %v", fd.ConfirmedAt)
			}
		}
	}
}

// Links: what the latest completed crawl recorded as failed is observed; a source with no usable record is unknown, and an
// upload source has no links. Skipped URLs are not failures. Nothing is fetched.
func TestLinksObservedUnknownAndNotApplicable(t *testing.T) {
	f := newFixture(t)
	never := f.source(f.teamA, "Never crawled", "web")
	observed := f.source(f.teamA, "Observed", "web")
	pageRefetch := f.source(f.teamA, "Page refetch", "web")
	noRecord := f.source(f.teamA, "No record", "web")
	upload := f.source(f.teamA, "Files", "upload")
	_ = never

	crawl := func(src uuid.UUID, status, trigger string, finished time.Time) uuid.UUID {
		return f.id(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at, truncated) VALUES ($1, $2, $3, $4, '{}', $5, ($3::text = 'completed' AND $4::text = 'manual')) RETURNING id`,
			src, f.teamA, status, trigger, finished)
	}
	url := func(c uuid.UUID, u, status, reason string, http int) {
		f.exec(`INSERT INTO web_frontier (crawl_id, url, depth, status, reason, http_status) VALUES ($1, $2, 0, $3, $4, $5)`, c, u, status, reason, http)
	}
	// Observed: an older completed crawl, then the latest completed one, then a later failed one (not used).
	old := crawl(observed, "completed", "schedule", asOf.AddDate(0, 0, -20))
	url(old, "https://example.edu/old-failure", "failed", "not_found", 404)
	latest := crawl(observed, "completed", "manual", asOf.AddDate(0, 0, -2))
	url(latest, "https://example.edu/gone", "failed", "not_found", 404)
	url(latest, "https://example.edu/server", "failed", "http_error", 503)
	url(latest, "https://example.edu/timeout", "failed", "Get \"https://example.edu/timeout\": context deadline exceeded", 0)
	url(latest, "https://example.edu/robots", "skipped", "robots_disallowed", 0)
	url(latest, "https://example.edu/fine", "done", "", 200)
	failedRun := crawl(observed, "failed", "schedule", asOf.AddDate(0, 0, -1))
	url(failedRun, "https://example.edu/not-used", "failed", "not_found", 404)
	// A single-page re-fetch is the latest completed crawl: the full crawl's record was discarded.
	refetch := crawl(pageRefetch, "completed", "page", asOf.AddDate(0, 0, -1))
	url(refetch, "https://example.edu/page", "done", "", 200)
	// A completed crawl whose record is gone.
	crawl(noRecord, "completed", "schedule", asOf.AddDate(0, 0, -1))

	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	links := res.signal(SignalBrokenLink)
	if links.State != StateMeasured || links.Found != 3 || links.Truncated {
		t.Fatalf("links = %+v, want 3 failures measured", links)
	}
	want := map[string]struct {
		code   string
		status int64
	}{"https://example.edu/gone": {LinkNotFound, 404}, "https://example.edu/server": {LinkHTTPError, 503}, "https://example.edu/timeout": {LinkNetworkError, 0}}
	for _, fd := range res.findings(SignalBrokenLink) {
		w, ok := want[fd.Ref]
		if !ok || fd.Code != w.code || fd.Value != w.status || fd.SourceID != observed || !fd.ObservedAt.Equal(asOf.AddDate(0, 0, -2)) {
			t.Errorf("finding %+v, want one of %v observed at the latest completed crawl", fd, want)
		}
		delete(want, fd.Ref)
	}
	if len(want) != 0 {
		t.Errorf("missing failures %v", want)
	}
	for name, c := range map[string]struct {
		src            uuid.UUID
		state, reason  string
		failedRecorded int32
	}{
		"observed": {observed, LinkObserved, "", 3}, "never crawled": {never, LinkUnknown, LinkNeverCrawled, 0},
		"page refetch": {pageRefetch, LinkUnknown, LinkPageRefetchLatest, 0}, "no record": {noRecord, LinkUnknown, LinkNoCrawlRecord, 0},
		"upload": {upload, LinkNotApplicable, "", 0},
	} {
		cov := res.coverage(c.src)
		if cov.LinkState != c.state || cov.LinkReason != c.reason || cov.LinkFailed != c.failedRecorded {
			t.Errorf("%s coverage = %s/%s/%d, want %s/%s/%d", name, cov.LinkState, cov.LinkReason, cov.LinkFailed, c.state, c.reason, c.failedRecorded)
		}
	}
	if !res.coverage(observed).LinkTruncated {
		t.Error("a truncated crawl's coverage does not say so")
	}
	if links.Counts["sourcesObserved"] != 1 || links.Counts["sourcesUnknown"] != 3 {
		t.Errorf("counts = %v, want 1 observed and 3 unknown web sources", links.Counts)
	}
}

// Links are unavailable (not "none broken") when no web source has a record, and not applicable without a web source.
func TestLinksNeverShownAsHealthyWhenUnknown(t *testing.T) {
	f := newFixture(t)
	upload := f.source(f.teamA, "Files", "upload")
	f.addDoc(f.teamA, upload, doc{})
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalBrokenLink); s.State != StateNotApplicable || s.Reason != ReasonNoWebSources {
		t.Errorf("uploads only: %+v, want not applicable (no web sources)", s)
	}
	f.source(f.teamA, "Site", "web")
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalBrokenLink); s.State != StateUnavailable || s.Reason != ReasonNoCrawlRecord || s.Found != 0 {
		t.Errorf("a web source never crawled: %+v, want unavailable (no crawl record), not zero", s)
	}
}

// Duplicates: identical raw hashes in at least two sources of the scope. Not within one source, not across teams, not with a
// shared source; a group lists some members and says its true size.
func TestDuplicatesScopes(t *testing.T) {
	f := newFixture(t)
	a, b, c := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload"), f.source(f.teamA, "C", "web")
	theirs, shared := f.source(f.teamB, "Theirs", "upload"), f.source(uuid.Nil, "Shared", "upload")
	kb := f.id(`INSERT INTO knowledge_bases (team_id, name, embedding_profile_id) VALUES ($1, 'KB', $2) RETURNING id`, f.teamA, f.profile)
	f.exec(`INSERT INTO kb_sources (kb_id, source_id) VALUES ($1, $2), ($1, $3)`, kb, a, b)

	inA := f.addDoc(f.teamA, a, doc{sha: "same"})
	inB := f.addDoc(f.teamA, b, doc{sha: "same"})
	f.addDoc(f.teamB, theirs, doc{sha: "same"})  // another team: never compared
	f.addDoc(uuid.Nil, shared, doc{sha: "same"}) // a shared source: never compared
	f.addDoc(f.teamA, a, doc{sha: "within"})
	f.addDoc(f.teamA, a, doc{sha: "within"}) // twice in one source: not across sources
	f.addDoc(f.teamA, a, doc{sha: "alone"})
	f.addDoc(f.teamB, theirs, doc{sha: "only-in-b-and-theirs"})
	f.addDoc(f.teamA, c, doc{sha: "failed-copy", status: "failed"})
	f.addDoc(f.teamA, a, doc{sha: "failed-copy"})
	f.addDoc(f.teamA, a, doc{noHash: true}) // no hash: counted, not compared
	f.addDoc(f.teamA, b, doc{noHash: true})

	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	dup := res.signal(SignalDuplicate)
	if dup.State != StateMeasured || dup.Found != 1 || dup.Counts["withoutHash"] != 2 {
		t.Fatalf("duplicates = %+v, want 1 group and 2 documents without a hash", dup)
	}
	got := ids(res.findings(SignalDuplicate))
	if len(got) != 2 || !contains(got, inA) || !contains(got, inB) {
		t.Fatalf("group members = %v, want the two of this team's %v and %v", got, inA, inB)
	}
	for _, fd := range res.findings(SignalDuplicate) {
		if fd.GroupNo != 1 || fd.GroupSize != 2 {
			t.Errorf("group %d of size %d, want group 1 of 2", fd.GroupNo, fd.GroupSize)
		}
	}
	// A scope of one source cannot hold a duplicate across sources.
	if s := f.collect(f.teamA, asOf, 365, 90, &a, nil).signal(SignalDuplicate); s.State != StateNotApplicable || s.Reason != ReasonOneSource {
		t.Errorf("one source in scope: %+v, want not applicable", s)
	}
	// A knowledge base's scope compares its own sources.
	if s := f.collect(f.teamA, asOf, 365, 90, nil, &kb).signal(SignalDuplicate); s.State != StateMeasured || s.Found != 1 {
		t.Errorf("knowledge base scope: %+v, want the group in A and B", s)
	}
	// A scope where the copies are not both inside finds nothing (a measured zero: the sources were compared).
	f.exec(`DELETE FROM kb_sources WHERE source_id = $1`, b)
	f.exec(`INSERT INTO kb_sources (kb_id, source_id) VALUES ($1, $2)`, kb, c)
	if s := f.collect(f.teamA, asOf, 365, 90, nil, &kb).signal(SignalDuplicate); s.State != StateMeasured || s.Found != 0 {
		t.Errorf("a scope holding only one copy: %+v, want measured with none", s)
	}
}

// A group lists at most MaxGroupMembers documents, from each source in turn, and says how many it really has.
func TestDuplicateGroupListsSomeMembersAndTheTrueSize(t *testing.T) {
	f := newFixture(t)
	a, b := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload")
	for range 14 {
		f.addDoc(f.teamA, a, doc{sha: "big"})
	}
	f.addDoc(f.teamA, b, doc{sha: "big"})
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	fs := res.findings(SignalDuplicate)
	if len(fs) != MaxGroupMembers {
		t.Fatalf("%d members listed, want %d", len(fs), MaxGroupMembers)
	}
	bySource := map[uuid.UUID]int{}
	for _, fd := range fs {
		bySource[fd.SourceID]++
		if fd.GroupSize != 15 {
			t.Errorf("group size %d, want the true 15", fd.GroupSize)
		}
	}
	if bySource[b] != 1 {
		t.Errorf("the other source is listed %d times, want once: a group must show its different sources", bySource[b])
	}
}

// Failures: the classes of Admin → Parsing & OCR, and documents not finished after a day. The parser's message is not kept.
func TestIngestionFailureClasses(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	old := asOf.Add(-25 * time.Hour)
	want := map[uuid.UUID][2]string{
		f.addDoc(f.teamA, src, doc{status: "failed", errCode: "corrupt"}):                                  {"damaged", "corrupt"},
		f.addDoc(f.teamA, src, doc{status: "failed", errCode: "ocr_unavailable"}):                          {"ocr_error", "ocr_unavailable"},
		f.addDoc(f.teamA, src, doc{status: "failed", errCode: "parse_error"}):                              {"other", "parse_error"},
		f.addDoc(f.teamA, src, doc{status: "skipped", errCode: "needs_ocr"}):                               {"needs_ocr", "needs_ocr"},
		f.addDoc(f.teamA, src, doc{status: "ready", errCode: "needs_ocr"}):                                 {"needs_ocr", "needs_ocr"},
		f.addDoc(f.teamA, src, doc{status: "pending", updated: old}):                                       {"not_finished", ""},
		f.addDoc(f.teamA, src, doc{status: "processing", updated: old, waiting: at(asOf.Add(-time.Hour))}): {"not_finished", ""},
	}
	fine := f.addDoc(f.teamA, src, doc{})
	recent := f.addDoc(f.teamA, src, doc{status: "queued", updated: asOf.Add(-time.Hour)})
	waitingForLimit := f.addDoc(f.teamA, src, doc{status: "pending", updated: old, waiting: at(asOf.Add(6 * time.Hour))})
	otherTeam := f.addDoc(f.teamB, f.source(f.teamB, "Theirs", "upload"), doc{status: "failed", errCode: "corrupt"})
	f.exec(`UPDATE documents SET error_message = 'secret parser text' WHERE status = 'failed'`)

	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	s := res.signal(SignalIngestionFailure)
	if s.State != StateMeasured || s.Found != int64(len(want)) {
		t.Fatalf("failures = %+v, want %d", s, len(want))
	}
	for _, fd := range res.findings(SignalIngestionFailure) {
		w, ok := want[fd.DocumentID]
		if !ok || fd.Code != w[0] || fd.Detail != w[1] {
			t.Errorf("finding %+v, want %v", fd, w)
		}
		delete(want, fd.DocumentID)
	}
	if len(want) != 0 {
		t.Errorf("missing %v", want)
	}
	for name, id := range map[string]uuid.UUID{"a ready document": fine, "a recent queued one": recent, "one waiting for a daily limit": waitingForLimit, "another team's": otherTeam} {
		if contains(ids(res.findings(SignalIngestionFailure)), id) {
			t.Errorf("%s is listed as a failure", name)
		}
	}
}

// With nothing to measure, every signal says so instead of showing a healthy zero.
func TestNothingToMeasureIsNotHealthy(t *testing.T) {
	f := newFixture(t)
	empty := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	for _, s := range empty.out.signals {
		if s.State != StateNotApplicable || s.Reason != ReasonNoDocuments && s.Reason != ReasonNoWebSources && s.Reason != ReasonOneSource {
			t.Errorf("%s with no sources = %+v, want not applicable", s.Signal, s)
		}
	}
	f.source(f.teamA, "Empty", "upload")
	for _, s := range f.collect(f.teamA, asOf, 365, 90, nil, nil).out.signals {
		if s.State == StateMeasured {
			t.Errorf("%s over a source with no documents is measured (%+v): zero would read as healthy", s.Signal, s)
		}
	}
}
