package contenthealth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// observedWeb adds a web source whose latest completed crawl failed on the URLs, and an old document of it (so the stale signal has
// a finding too, which must not depend on the crawl).
func (f *fixture) observedWeb(name string, urls ...string) (src, crawl, stale uuid.UUID) {
	f.t.Helper()
	src = f.source(f.teamA, name, "web")
	crawl = f.id(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'completed', 'schedule', '{}', now() - interval '2 hours') RETURNING id`, src, f.teamA)
	for _, u := range urls {
		f.exec(`INSERT INTO web_frontier (crawl_id, url, depth, status, reason, http_status) VALUES ($1, $2, 0, 'failed', 'not_found', 404)`, crawl, u)
	}
	stale = f.addDoc(f.teamA, src, doc{processed: at(time.Now().AddDate(-3, 0, 0))})
	return src, crawl, stale
}

func (f *fixture) refs(rep Report, signal string) []string {
	f.t.Helper()
	page, err := f.svc.Findings(f.ctx, f.ownerA, f.slugA, rep.ID, signal, 0, 100)
	if err != nil {
		f.t.Fatal(err)
	}
	var out []string
	for _, it := range page.Items {
		out = append(out, it.Ref)
	}
	return out
}

func (f *fixture) detail(rep Report) Detail {
	f.t.Helper()
	d, err := f.svc.Detail(f.ctx, f.ownerA, f.slugA, rep.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	return d
}

// A failed address is stored without credentials, query or fragment, and once: tokens and passwords in a crawled URL never reach the
// report. (Before, the address was stored exactly as the crawler saw it.) The path can still hold something sensitive, which the
// documentation says; an address that cannot be made safe is counted, not stored.
func TestFailedAddressesAreStoredWithoutCredentialsQueryOrFragment(t *testing.T) {
	f := newFixture(t)
	f.observedWeb("Site",
		"https://user:s3cret@example.edu/a/b?token=abc123#frag",
		"https://example.edu/a/b?session=zzz",
		"https://example.edu/c#top",
		"https://example.edu/plain",
		"https://example.edu/q?",
		"not a url?secret=1",
	)
	rep := f.make(CreateInput{})
	want := map[string]bool{"https://example.edu/a/b": true, "https://example.edu/c": true, "https://example.edu/plain": true, "https://example.edu/q": true}
	got := f.refs(rep, SignalBrokenLink)
	if len(got) != len(want) {
		t.Fatalf("addresses = %v, want %v (each once, without query, fragment or credentials)", got, want)
	}
	for _, r := range got {
		if !want[r] {
			t.Errorf("address %q was stored, want one of %v", r, want)
		}
	}
	if n := f.count(`SELECT count(*) FROM content_health_findings WHERE ref ~ '[?#@]' OR ref ILIKE '%s3cret%' OR ref ILIKE '%token%' OR ref ILIKE '%session%' OR ref ILIKE '%secret%'`); n != 0 {
		t.Errorf("%d stored addresses still carry a credential, query or fragment", n)
	}
	s := signalOf(rep, SignalBrokenLink)
	if s.Found != 5 || s.Listed != 4 || s.Counts["addressesNotKept"] != 1 || s.Truncated {
		t.Errorf("links = %+v, want 5 failed addresses, 4 kept and 1 counted as not kept", s)
	}
}

func TestSanitizeURL(t *testing.T) {
	for raw, want := range map[string]string{
		"https://example.edu/a":                       "https://example.edu/a",
		"https://u:p@example.edu/a?x=1#y":             "https://example.edu/a",
		"http://example.edu":                          "http://example.edu",
		"https://example.edu:8443/a%20b?q":            "https://example.edu:8443/a%20b",
		"https://example.edu/a?":                      "https://example.edu/a",
		"https://tok@example.edu/":                    "https://example.edu/",
		"ftp://example.edu/a":                         "",
		"mailto:someone@example.edu":                  "",
		"not a url?x=1":                               "",
		"//example.edu/a":                             "",
		"https://exa mple.edu/a":                      "",
		"https://example.edu/a?next=https://x@y/z#f2": "https://example.edu/a",
	} {
		got, ok := sanitizeURL(raw)
		if (want == "") == ok || got != want {
			t.Errorf("sanitizeURL(%q) = %q, %v; want %q", raw, got, ok, want)
		}
	}
}

// A report's addresses are an observation of one crawl of one configuration of one source. They are hidden once that no longer
// holds: the source's configuration or classification changed, or a newer completed crawl replaced the observation. The report's
// other findings, and the as-of counts, stay.
func TestAddressesAreHiddenOnceTheObservationNoLongerHolds(t *testing.T) {
	type mutation struct {
		name      string
		change    func(f *fixture, src uuid.UUID)
		hidden    bool
		linkState string
	}
	for _, m := range []mutation{
		{"nothing changed", func(*fixture, uuid.UUID) {}, false, "current"},
		{"the source is retargeted", func(f *fixture, src uuid.UUID) {
			f.exec(`UPDATE data_sources SET config = '{"startUrl":"https://other.example.edu/"}', revision = revision + 1 WHERE id = $1`, src)
		}, true, "source_changed"},
		{"the source is renamed (a revision change)", func(f *fixture, src uuid.UUID) {
			f.exec(`UPDATE data_sources SET name = 'Renamed', revision = revision + 1 WHERE id = $1`, src)
		}, true, "source_changed"},
		{"the classification changes, nothing else", func(f *fixture, src uuid.UUID) {
			f.exec(`UPDATE data_sources SET classification = 'sensitive' WHERE id = $1`, src)
		}, true, "source_changed"},
		{"a newer completed crawl", func(f *fixture, src uuid.UUID) {
			f.exec(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'completed', 'manual', '{}', now() + interval '1 minute')`, src, f.teamA)
		}, true, "crawl_changed"},
		{"a newer single-page re-fetch, which discards the record", func(f *fixture, src uuid.UUID) {
			f.exec(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'completed', 'page', '{}', now() + interval '1 minute')`, src, f.teamA)
		}, true, "crawl_changed"},
		{"a newer crawl that failed does not replace the observation", func(f *fixture, src uuid.UUID) {
			f.exec(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'failed', 'manual', '{}', now() + interval '1 minute')`, src, f.teamA)
		}, false, "current"},
		{"a crawl in progress does not replace it either", func(f *fixture, src uuid.UUID) {
			f.exec(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config) VALUES ($1, $2, 'running', 'manual', '{}')`, src, f.teamA)
		}, false, "current"},
	} {
		t.Run(m.name, func(t *testing.T) {
			f := newFixture(t)
			src, _, stale := f.observedWeb("Site", "https://example.edu/gone")
			rep := f.make(CreateInput{})
			if got := f.refs(rep, SignalBrokenLink); len(got) != 1 {
				t.Fatalf("before the change: %v, want the address", got)
			}
			m.change(f, src)
			got := f.refs(rep, SignalBrokenLink)
			if m.hidden && len(got) != 0 {
				t.Errorf("addresses after %s: %v, want none", m.name, got)
			}
			if !m.hidden && len(got) != 1 {
				t.Errorf("addresses after %s: %v, want the address still", m.name, got)
			}
			links := signalOf(mustGet(t, f, rep), SignalBrokenLink)
			wantListed := int64(1)
			if m.hidden {
				wantListed = 0
			}
			// The count when the report was made stays; what still holds is shown beside it, never as healthy.
			if links.Found != 1 || links.Listed != wantListed {
				t.Errorf("links = found %d listed %d, want 1 and %d", links.Found, links.Listed, wantListed)
			}
			if c := f.detail(rep).Sources; len(c) != 1 || c[0].LinkRefs != m.linkState || c[0].LinkFailed != 1 {
				t.Errorf("coverage = %+v, want link refs %q and the crawl's own count", c, m.linkState)
			}
			// What does not depend on the crawl is untouched.
			if got := f.refs(rep, SignalStale); len(got) != 1 {
				t.Errorf("stale findings after %s: %v, want %v still listed", m.name, got, stale)
			}
		})
	}
}

func mustGet(t *testing.T, f *fixture, rep Report) Report {
	t.Helper()
	r, err := f.svc.Get(f.ctx, f.ownerA, f.slugA, rep.ID)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// A report chosen by knowledge base follows that knowledge base as it is now: a source taken out of it disappears from every
// signal and from the coverage, and comes back if it is put back. (The as-of counts of the signal cards are numbers only.)
func TestSourceLeavingTheScopeKnowledgeBaseDisappearsFromTheReport(t *testing.T) {
	f := newFixture(t)
	kept, _, _ := f.observedWeb("Kept", "https://example.edu/kept")
	left, _, leftStale := f.observedWeb("Left", "https://example.edu/left")
	other := f.source(f.teamA, "Elsewhere", "upload")
	otherStale := f.addDoc(f.teamA, other, doc{processed: at(time.Now().AddDate(-3, 0, 0))}) // never in the scope
	kb := f.kb(f.teamA, time.Time{}, kept, left)
	rep := f.make(CreateInput{KBID: &kb})
	listed := func(signal string) []string {
		page, err := f.svc.Findings(f.ctx, f.ownerA, f.slugA, rep.ID, signal, 0, 100)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, it := range page.Items {
			out = append(out, it.SourceName)
		}
		return out
	}
	if got := listed(SignalStale); len(got) != 2 {
		t.Fatalf("stale before = %v, want the two sources of the knowledge base (not %v)", got, otherStale)
	}
	f.exec(`DELETE FROM kb_sources WHERE kb_id = $1 AND source_id = $2`, kb, left)
	if got := listed(SignalStale); len(got) != 1 || got[0] != "Kept" {
		t.Errorf("stale after detaching a source = %v, want only the one still in the knowledge base (not %v)", got, leftStale)
	}
	if got := listed(SignalBrokenLink); len(got) != 1 || got[0] != "Kept" {
		t.Errorf("links after detaching = %v, want only the source still in the knowledge base", got)
	}
	d := f.detail(rep)
	if len(d.Sources) != 1 || d.Sources[0].SourceID != kept || d.Sources[0].Name != "Kept" {
		t.Errorf("coverage after detaching = %+v, want only the source still in the knowledge base: a removed scope must not show through the report", d.Sources)
	}
	if s := signalOf(d.Report, SignalStale); s.Found != 2 || s.Listed != 1 {
		t.Errorf("stale = found %d listed %d, want 2 when the report was made and 1 now", s.Found, s.Listed)
	}
	if n := f.count(`SELECT count(*) FROM content_health_sources WHERE report_id = $1`, rep.ID); n != 2 {
		t.Errorf("the snapshot holds %d coverage rows, want 2: hiding is a read-time rule, nothing is rewritten", n)
	}
	// Put back, it is the scope again.
	f.exec(`INSERT INTO kb_sources (kb_id, source_id) VALUES ($1, $2)`, kb, left)
	if got := listed(SignalStale); len(got) != 2 {
		t.Errorf("stale after re-attaching = %v, want both", got)
	}
	// Deleting the source takes it with its findings, as before.
	f.exec(`DELETE FROM kb_sources WHERE source_id = $1`, kept)
	f.exec(`DELETE FROM data_sources WHERE id = $1`, kept)
	if got := listed(SignalStale); len(got) != 1 || got[0] != "Left" {
		t.Errorf("stale after deleting a source = %v, want only the other", got)
	}
}

// A web page a crawl saw again after the stale threshold is old by processing date but recently confirmed: it is listed, flagged,
// and counted, never presented as simply neglected.
func TestStaleCountsPagesARecentCrawlConfirmed(t *testing.T) {
	f := newFixture(t)
	web := f.source(f.teamA, "Site", "web")
	crawl := f.id(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config, finished_at) VALUES ($1, $2, 'completed', 'schedule', '{}', $3) RETURNING id`, web, f.teamA, asOf.AddDate(0, 0, -3))
	confirmed := f.addDoc(f.teamA, web, doc{processed: at(asOf.AddDate(-2, 0, 0))})
	f.addDoc(f.teamA, web, doc{processed: at(asOf.AddDate(-2, 0, 0))}) // never confirmed
	f.exec(`UPDATE documents SET last_seen_crawl_id = $1 WHERE id = $2`, crawl, confirmed)
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	if s := res.signal(SignalStale); s.Found != 2 || s.Counts["recentlyConfirmed"] != 1 {
		t.Fatalf("stale = %+v, want 2 found and 1 recently confirmed by a crawl", s)
	}
}
