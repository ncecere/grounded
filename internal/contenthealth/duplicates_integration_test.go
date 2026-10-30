package contenthealth

import (
	"testing"

	"github.com/google/uuid"
)

func (f *fixture) dupGroups(rep Report, limit int) (pages [][]FindingView) {
	f.t.Helper()
	var after int32
	for range 100 {
		p, err := f.svc.Findings(f.ctx, f.ownerA, f.slugA, rep.ID, SignalDuplicate, after, limit)
		if err != nil {
			f.t.Fatal(err)
		}
		pages = append(pages, p.Items)
		if p.After == 0 {
			return pages
		}
		after = p.After
	}
	f.t.Fatal("paging did not end")
	return nil
}

// A duplicate group is two or more sources holding the same bytes, and a read says so only while that is still true: a lone
// survivor is not a duplicate, and the numbers are in groups (found when the report was made, listed now), never groups against
// rows.
func TestDuplicateGroupNeedsTwoSourcesAtRead(t *testing.T) {
	f := newFixture(t)
	a, b, c := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload"), f.source(f.teamA, "C", "upload")
	g1a, g1b := f.addDoc(f.teamA, a, doc{sha: "g1"}), f.addDoc(f.teamA, b, doc{sha: "g1"})
	g2a, g2b, g2c := f.addDoc(f.teamA, a, doc{sha: "g2"}), f.addDoc(f.teamA, b, doc{sha: "g2"}), f.addDoc(f.teamA, c, doc{sha: "g2"})
	rep := f.make(CreateInput{})
	state := func() (found, listed int64, docs map[uuid.UUID]bool) {
		got := mustGet(t, f, rep)
		s := signalOf(got, SignalDuplicate)
		docs = map[uuid.UUID]bool{}
		for _, page := range f.dupGroups(rep, 100) {
			for _, it := range page {
				docs[*it.DocumentID] = true
			}
		}
		return s.Found, s.Listed, docs
	}
	if found, listed, docs := state(); found != 2 || listed != 2 || len(docs) != 5 {
		t.Fatalf("before: found %d groups, listed %d groups, %d documents; want 2, 2, 5", found, listed, len(docs))
	}
	// One member deleted: group 1 is a lone survivor and disappears; group 2 still spans three sources.
	f.exec(`DELETE FROM documents WHERE id = $1`, g1b)
	found, listed, docs := state()
	if found != 2 || listed != 1 || docs[g1a] || !docs[g2a] || len(docs) != 3 {
		t.Fatalf("after deleting one member: found %d, listed %d, documents %v; want 2 found, 1 listed, the lone survivor %v not shown", found, listed, docs, g1a)
	}
	// A member retargeted (its file replaced, so its bytes differ): no longer the same file.
	f.exec(`UPDATE documents SET sha256 = 'changed' WHERE id = $1`, g2c)
	_, listed, docs = state()
	if listed != 1 || docs[g2c] || !docs[g2a] || !docs[g2b] {
		t.Fatalf("after one member's bytes changed: listed %d, documents %v; want the group of the two that still match", listed, docs)
	}
	// Two members left in the same source is not a duplicate across sources.
	f.exec(`UPDATE documents SET source_id = $1 WHERE id = $2`, a, g2b)
	if _, listed, docs = state(); listed != 0 || len(docs) != 0 {
		t.Fatalf("two copies in one source: listed %d, documents %v; want none (not across sources)", listed, docs)
	}
	// A source leaving the scope takes its members: group counts follow the live scope too.
	f.exec(`UPDATE documents SET source_id = $1 WHERE id = $2`, b, g2b)
	if _, listed, _ = state(); listed != 1 {
		t.Fatalf("back in two sources: listed %d, want 1", listed)
	}
	f.exec(`DELETE FROM data_sources WHERE id = $1`, a)
	if _, listed, docs = state(); listed != 0 || len(docs) != 0 {
		t.Fatalf("after deleting a source: listed %d, documents %v; want none, as the survivor is alone", listed, docs)
	}
	if signalOf(mustGet(t, f, rep), SignalDuplicate).Found != 2 {
		t.Error("the count when the report was made changed: it is as of the report")
	}
}

// A snapshot group can split into two different matching pairs after files are
// replaced. Both pairs are duplicates now, but they must never be displayed as
// one identical file. Without storing hashes or inventing new snapshot groups,
// the conservative old-report result is to withhold this ambiguous group.
func TestDuplicateSplitGroupIsNotShownAsOneIdenticalFile(t *testing.T) {
	f := newFixture(t)
	a, b := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload")
	a1, a2 := f.addDoc(f.teamA, a, doc{sha: "original"}), f.addDoc(f.teamA, a, doc{sha: "original"})
	b1, b2 := f.addDoc(f.teamA, b, doc{sha: "original"}), f.addDoc(f.teamA, b, doc{sha: "original"})
	rep := f.make(CreateInput{})
	f.exec(`UPDATE documents SET sha256 = 'replacement', updated_at = now() WHERE id = ANY($1::uuid[])`, []uuid.UUID{a1, b1})
	s := signalOf(mustGet(t, f, rep), SignalDuplicate)
	pages := f.dupGroups(rep, 1)
	if s.Found != 1 || s.Listed != 0 || len(pages) != 1 || len(pages[0]) != 0 {
		t.Fatalf("split snapshot group shown as one identical file: %+v, pages %+v; want 1 historically found, 0 coherently listed", s, pages)
	}
	// A new report may assign the two real groups. The old report's grouping
	// and historical count are never rewritten to make its current count fit.
	fresh := f.make(CreateInput{})
	if s := signalOf(fresh, SignalDuplicate); s.Found != 2 || s.Listed != 2 {
		t.Fatalf("fresh report: %+v; want two current identical-file groups", s)
	}
	seen := map[uuid.UUID]bool{}
	for _, page := range f.dupGroups(fresh, 1) {
		if len(page) != 2 {
			t.Fatalf("fresh whole-group page has %d rows; want 2", len(page))
		}
		ids := []uuid.UUID{*page[0].DocumentID, *page[1].DocumentID}
		for _, id := range ids {
			seen[id] = true
		}
		if n := f.count(`SELECT count(DISTINCT sha256) FROM documents WHERE id = ANY($1::uuid[])`, ids); n != 1 {
			t.Fatalf("fresh group mixes different bytes: %+v", ids)
		}
	}
	if s := signalOf(mustGet(t, f, rep), SignalDuplicate); s.Found != 1 {
		t.Error("making a fresh report rewrote the old historical group count")
	}
	if len(seen) != 4 || !seen[a1] || !seen[a2] || !seen[b1] || !seen[b2] {
		t.Error("fresh groups lost a changed or unchanged member")
	}
}

// Found and listed are in groups: a group of fifteen documents (ten listed) is one group found and one group listed.
func TestDuplicateFoundAndListedAreBothGroups(t *testing.T) {
	f := newFixture(t)
	a, b := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload")
	for range 14 {
		f.addDoc(f.teamA, a, doc{sha: "big"})
	}
	f.addDoc(f.teamA, b, doc{sha: "big"})
	rep := f.make(CreateInput{})
	s := signalOf(rep, SignalDuplicate)
	if s.Found != 1 || s.Listed != 1 || s.Truncated {
		t.Fatalf("duplicates = found %d listed %d truncated %v, want 1 group, 1 group, not truncated (before: listed counted the %d member rows)", s.Found, s.Listed, s.Truncated, MaxGroupMembers)
	}
}

// Duplicates page in whole groups: a group is never split between two pages, the limit counts rows but yields at least one group,
// and the pages together list every group once. Capped groups (MaxDuplicateGroups) are the signal's unit of truncation.
func TestDuplicatePagesHoldWholeGroups(t *testing.T) {
	f := newFixture(t)
	a, b := f.source(f.teamA, "A", "upload"), f.source(f.teamA, "B", "upload")
	for g := range 12 { // 12 groups of 3 documents each
		sha := "grp-" + string(rune('a'+g))
		f.addDoc(f.teamA, a, doc{sha: sha})
		f.addDoc(f.teamA, a, doc{sha: sha})
		f.addDoc(f.teamA, b, doc{sha: sha})
	}
	rep := f.make(CreateInput{})
	if s := signalOf(rep, SignalDuplicate); s.Found != 12 || s.Listed != 12 {
		t.Fatalf("duplicates = %+v, want 12 groups", s)
	}
	for _, limit := range []int{10, 1, 3, 100} {
		seen := map[int32]int{}
		pages := f.dupGroups(rep, limit)
		for i, p := range pages {
			if len(p) == 0 {
				t.Fatalf("limit %d: page %d is empty", limit, i)
			}
			inPage := map[int32]int{}
			for _, it := range p {
				inPage[it.GroupNo]++
				seen[it.GroupNo]++
			}
			for g, n := range inPage {
				if n != 3 {
					t.Errorf("limit %d: page %d holds %d of group %d's 3 documents: a group was split", limit, i, n, g)
				}
			}
			if rows := len(p); rows > max(limit, 3) {
				t.Errorf("limit %d: a page of %d rows", limit, rows)
			}
		}
		if len(seen) != 12 {
			t.Errorf("limit %d: pages hold %d groups, want 12", limit, len(seen))
		}
	}
	if pages := f.dupGroups(rep, 10); len(pages) != 4 || len(pages[0]) != 9 {
		t.Errorf("limit 10 gives %d pages, the first of %d rows; want 4 pages of three whole groups (9 rows)", len(pages), len(pages[0]))
	}
	// The cap is in groups: more groups than MaxDuplicateGroups are truncated, the true count kept.
	f2 := newFixture(t)
	x, y := f2.source(f2.teamA, "X", "upload"), f2.source(f2.teamA, "Y", "upload")
	f2.exec(`INSERT INTO documents (source_id, team_id, external_id, status, sha256, processed_at, created_at)
		SELECT s, $1, 'd-' || g || '-' || s, 'ready', 'h' || g, now(), now() FROM generate_series(1, $2) g, unnest(ARRAY[$3::uuid, $4::uuid]) s`, f2.teamA, MaxDuplicateGroups+7, x, y)
	big := f2.make(CreateInput{})
	if s := signalOf(big, SignalDuplicate); s.Found != MaxDuplicateGroups+7 || s.Listed != MaxDuplicateGroups || !s.Truncated {
		t.Errorf("duplicates = %+v, want %d groups found, %d listed, truncated", s, MaxDuplicateGroups+7, MaxDuplicateGroups)
	}
}

// reconcile is the store's rule for what vanished, on its own: groups are dropped when they no longer span two sources, the
// survivors are numbered again, and the counts follow.
func TestReconcileDuplicateGroups(t *testing.T) {
	s1, s2, s3 := uuid.New(), uuid.New(), uuid.New()
	d := func(g int32, src uuid.UUID) Finding {
		return Finding{GroupNo: g, SourceID: src, DocumentID: uuid.New()}
	}
	out := &outcome{
		signals:  []storedSignal{{Signal: SignalDuplicate, State: StateMeasured, Found: 3, Counts: map[string]int64{"withoutHash": 2}}},
		findings: map[string][]Finding{SignalDuplicate: {d(1, s1), d(1, s2), d(2, s1), d(2, s3), d(3, s2), d(3, s3)}},
		coverage: []*Coverage{{SourceID: s1}, {SourceID: s2}, {SourceID: s3}},
	}
	live := liveSet{sources: map[uuid.UUID]bool{s1: true, s2: true}, docs: map[uuid.UUID]uuid.UUID{}}
	for _, f := range out.findings[SignalDuplicate] {
		live.docs[f.DocumentID] = f.SourceID
	}
	sigs, fs, cov := reconcile(out, live)
	// s3 is gone: group 2 and 3 each lose a member, leaving one source.
	got := sigs[0]
	if got.Found != 1 || got.Counts["vanished"] != 2 || got.Counts["withoutHash"] != 2 || got.Truncated {
		t.Errorf("signal = %+v, want 1 group left, 2 vanished, the other counts kept", got)
	}
	if len(fs[SignalDuplicate]) != 2 || fs[SignalDuplicate][0].GroupNo != 1 {
		t.Errorf("findings = %+v, want group 1's two members", fs[SignalDuplicate])
	}
	if len(cov) != 2 {
		t.Errorf("coverage = %d, want the two live sources", len(cov))
	}
	if out.signals[0].Found != 3 || out.signals[0].Counts["vanished"] != 0 {
		t.Error("reconcile changed the collected outcome")
	}
}
