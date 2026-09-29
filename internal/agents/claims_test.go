package agents

import (
	"log/slog"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/testutil"
)

// claimsOf is extractClaims as (claim text -> cited numbers).
func claimsOf(text string) map[string][]int {
	out := map[string][]int{}
	for _, c := range extractClaims(text) {
		for _, m := range c.Markers {
			out[c.Text] = append(out[c.Text], m.N)
		}
	}
	return out
}

func TestExtractClaims(t *testing.T) {
	cases := []struct {
		name, text string
		want       map[string][]int
	}{
		{"sentences", "Transcripts cost $10.00 each [1]. They arrive in 3 days [2].",
			map[string][]int{"Transcripts cost $10.00 each.": {1}, "They arrive in 3 days.": {2}}},
		{"marker after the period", "Fees are due at registration.[1] Late fees apply after that. [2] Ask the office.",
			map[string][]int{"Fees are due at registration.": {1}, "Late fees apply after that.": {2}}},
		{"several markers", "You can order online or by mail [1][3].",
			map[string][]int{"You can order online or by mail.": {1, 3}}},
		{"abbreviations and initials", "Order by 5 p.m. on Friday, e.g. through MY.PORTAL [2]. Dr. Smith signs it [1].",
			map[string][]int{"Order by 5 p.m. on Friday, e.g. through MY.PORTAL.": {2}, "Dr. Smith signs it.": {1}}},
		{"markers on the next line", "Transcripts are sent electronically.\n[1][2]",
			map[string][]int{"Transcripts are sent electronically.": {1, 2}}},
		// A paragraph of markers alone is a citation list: not checked.
		{"marker paragraph", "Transcripts are sent electronically.\n\n[1][2]", map[string][]int{}},
		{"list with a lead-in", "You can order a transcript:\n\n- **Online** through MY.PORTAL [1]\n- By mail, with the form [2]\n\n1. Pay the fee [3]",
			map[string][]int{
				"You can order a transcript: Online through MY.PORTAL": {1},
				"You can order a transcript: By mail, with the form":   {2},
				"You can order a transcript: Pay the fee":              {3},
			}},
		{"bold line over a list", "**Visiting students**\n1. **Deadline** – 10 business days before classes. [3]",
			map[string][]int{"Visiting students: Deadline – 10 business days before classes.": {3}}},
		{"list item continuation", "- Diplomas are mailed\n  about 8 weeks after graduation [4].",
			map[string][]int{"Diplomas are mailed about 8 weeks after graduation.": {4}}},
		{"table", "| Item | Fee |\n|---|---|\n| Official transcript | $10 [1] |\n| Rush delivery | $25 [2] |",
			map[string][]int{"Item: Official transcript; Fee: $10": {1}, "Item: Rush delivery; Fee: $25": {2}}},
		{"heading and code", "## Deadlines [1]\n\n```\nnot a claim [2]\n```\nDrop by Friday [3]!",
			map[string][]int{"Drop by Friday!": {3}}}, // "Deadlines" is too short to check
		{"inline code is part of the claim", "The size is part of the type (e.g., `[3]int` and `[4]int` are distinct types) [2].",
			map[string][]int{"The size is part of the type (e.g., [3]int and [4]int are distinct types).": {2}}},
		{"indented code", "Index it like this:\n\n    a [2] = 1\n\nThen read it back [1].",
			map[string][]int{"Then read it back.": {1}}},
		{"question and quote", `Is it free? "No, it costs $10." [5]`,
			map[string][]int{`"No, it costs $10."`: {5}}},
		{"nothing before a marker", "[1] Transcripts cost $10.", map[string][]int{"Transcripts cost $10.": {1}}},
		{"too short to check", "[1] alone. Online [2]. It is $10 [3].", map[string][]int{"It is $10.": {3}}},
		{"no markers", "Nothing cited here.", map[string][]int{}},
		{"unicode spaces", "Order it through the Clearinghouse.\u202fThe site lets alumni order one [1].\u00a0It costs $10 [2].",
			map[string][]int{"The site lets alumni order one.": {1}, "It costs $10.": {2}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := claimsOf(c.text); !reflect.DeepEqual(got, c.want) {
				t.Errorf("claims =\n%#v\nwant\n%#v", got, c.want)
			}
		})
	}
}

func TestRemoveMarkers(t *testing.T) {
	text := "A is true [1][2]. B is false [3]. C [4]"
	drop := map[int]bool{}
	for _, m := range extractMarkers(text) {
		if m.N == 1 || m.N == 3 || m.N == 4 {
			drop[m.Start] = true
		}
	}
	got, kept := removeMarkers(text, drop)
	if got != "A is true [2]. B is false. C" || kept != 1 {
		t.Errorf("removeMarkers = %q (%d kept)", got, kept)
	}
}

func verdict(v string, conf float64) systemone.Verdict {
	return systemone.Verdict{Verification: v, Confidence: conf}
}

func TestAggregateVerdicts(t *testing.T) {
	cases := []struct {
		in   []systemone.Verdict
		want string
		conf float64
	}{
		{[]systemone.Verdict{verdict(systemone.Verified, 0.9), verdict(systemone.Verified, 0.8)}, systemone.Verified, 0.8},
		{[]systemone.Verdict{verdict(systemone.Verified, 0.9), verdict(systemone.Unsupported, 0.6), verdict(systemone.Unsupported, 0.7)}, systemone.Unsupported, 0.7},
		{[]systemone.Verdict{verdict(systemone.Unsupported, 0.9), verdict(systemone.Contradicted, 0.5)}, systemone.Contradicted, 0.5},
		{[]systemone.Verdict{verdict(systemone.Unchecked, 0)}, systemone.Unchecked, -1},
		{nil, systemone.Unchecked, -1},
	}
	for i, c := range cases {
		got, conf := aggregateVerdicts(c.in)
		if got != c.want || (conf == nil) != (c.conf < 0) || (conf != nil && *conf != c.conf) {
			t.Errorf("case %d: %s %v, want %s %v", i, got, conf, c.want, c.conf)
		}
	}
}

// enforceRun is a run with citation checks in enforce mode.
func enforceRun(strict bool) *run {
	return &run{cfg: Config{StrictlyGrounded: strict, RefusalMessage: "No."},
		cite: &systemone.CitationPlan{Settings: systemone.Citations{Mode: systemone.CitationEnforce, AutoAccept: 0.8}}}
}

// lookupFor answers each claim with the verdict named in it.
func lookupFor(claims []claim, of func(text string, n int) systemone.Verdict) verdictLookup {
	l := verdictLookup{index: map[pairKey]int{}}
	for _, c := range claims {
		for _, m := range c.Markers {
			k := pairKey{c.Text, m.N}
			if _, ok := l.index[k]; !ok {
				l.index[k] = len(l.verdicts)
				l.verdicts = append(l.verdicts, of(c.Text, m.N))
			}
		}
	}
	return l
}

func TestEnforceCitations(t *testing.T) {
	cites := []Citation{{N: 1}, {N: 2}, {N: 3}}
	byClaim := func(text string, n int) systemone.Verdict {
		switch {
		case n == 2:
			return verdict(systemone.Contradicted, 0.95)
		case n == 3:
			return verdict(systemone.Unsupported, 0.5) // low confidence: kept
		}
		return verdict(systemone.Verified, 0.97)
	}
	text := "Fees are $10 [1][2]. Orders take 3 days [3]."
	ans := &Answer{Text: text, Citations: cites}
	claims := extractClaims(text)
	rec := CitationsRecord{Verified: 1}
	ru := enforceRun(true)
	ru.enforceCitations(ans, claims, lookupFor(claims, byClaim), &rec)
	if ans.Text != "Fees are $10 [1]. Orders take 3 days [3]." || rec.Removed != 1 || ans.Refused {
		t.Fatalf("enforced %q, removed %d", ans.Text, rec.Removed)
	}
	if got := []int{ans.Citations[0].N, ans.Citations[1].N}; len(ans.Citations) != 2 || !reflect.DeepEqual(got, []int{1, 3}) {
		t.Errorf("citations %+v", ans.Citations)
	}
	ann := annotateCitations(ans.Citations, extractClaims(ans.Text), lookupFor(claims, byClaim))
	if ann[0].Verification != systemone.Verified || ann[1].Verification != systemone.Unsupported || *ann[1].Confidence != 0.5 {
		t.Errorf("annotated %+v", ann)
	}

	// Nothing supported, every marker confidently wrong: a strict agent refuses.
	none := func(string, int) systemone.Verdict { return verdict(systemone.Unsupported, 0.9) }
	ans = &Answer{Text: text, Citations: cites}
	rec = CitationsRecord{}
	enforceRun(true).enforceCitations(ans, claims, lookupFor(claims, none), &rec)
	if !rec.Refused || !ans.Refused || ans.Text != "No." || len(ans.Citations) != 0 {
		t.Errorf("strict: %+v %+v", ans, rec)
	}
	// Not strict: the markers go, the answer stays.
	ans = &Answer{Text: text, Citations: cites}
	rec = CitationsRecord{}
	enforceRun(false).enforceCitations(ans, claims, lookupFor(claims, none), &rec)
	if rec.Refused || ans.Text != "Fees are $10. Orders take 3 days." || len(ans.Citations) != 0 {
		t.Errorf("not strict: %q %+v", ans.Text, ans.Citations)
	}
}

func TestCitationsRecordCounts(t *testing.T) {
	rec := citationsRecord(systemone.CitationAnnotate, 3, []systemone.Verdict{
		verdict(systemone.Verified, 0.9), verdict(systemone.Unsupported, 0.4), verdict(systemone.Contradicted, 0.99),
		verdict(systemone.Unchecked, 0)}, 0.8)
	want := CitationsRecord{Mode: "annotate", Claims: 3, Pairs: 4, Checked: 3, Verified: 1, Unsupported: 1, Contradicted: 1,
		Unchecked: 1, LowConfidence: 1}
	if !reflect.DeepEqual(rec, want) {
		t.Errorf("record %+v", rec)
	}
}

func TestCitationTiming(t *testing.T) {
	ru := &run{cite: &systemone.CitationPlan{Settings: systemone.Citations{Mode: systemone.CitationEnforce}},
		out: &streamer{emit: func(Event) {}}, channel: ChannelOpenAI}
	ok := &Answer{Citations: []Citation{{N: 1}}, StopReason: "stop"}
	if got := ru.citationTiming(ok, false); got != checkAfter || ru.citationMode(got) != systemone.CitationAnnotate {
		t.Errorf("streamed openai: %d %s", got, ru.citationMode(got))
	}
	ru.channel = ChannelUI
	if ru.citationMode(checkAfter) != systemone.CitationEnforce {
		t.Error("streamed UI keeps enforce")
	}
	ru.out.emit = nil // a JSON response
	if got := ru.citationTiming(ok, false); got != checkBefore {
		t.Errorf("json: %d", got)
	}
	// An answer without citations is checked too: its factual sentences are uncited.
	if got := ru.citationTiming(&Answer{StopReason: "stop"}, false); got != checkBefore {
		t.Errorf("no citations: %d", got)
	}
	for _, a := range []*Answer{
		{StopReason: "stop", noContextReason: NoContextSmallTalk},
		{Citations: ok.Citations, Refused: true},
		{Citations: ok.Citations, ErrorCode: ErrCodeModelUnavailable},
		{Citations: ok.Citations, StopReason: string(llm.StopReasonAborted)},
	} {
		if ru.citationTiming(a, false) != checkNone {
			t.Errorf("checked %+v", a)
		}
	}
	if ru.citationTiming(ok, true) != checkNone || (&run{}).citationTiming(ok, false) != checkNone {
		t.Error("withheld or off")
	}
	ru.cfg.CitationMode = CitationNone
	if ru.citationTiming(&Answer{StopReason: "stop"}, false) != checkNone {
		t.Error("an agent that doesn't cite is not checked")
	}
}

// Citation lists and claims too short to say anything are not checked
// (they get no verdict), but their markers and citations stay.
func TestCitationListsAreNotChecked(t *testing.T) {
	cases := []struct {
		name, text string
		want       map[string][]int
	}{
		{"trailing list line", "It costs $10 [1].\n\nCitations: [1], [2], [5]", map[string][]int{"It costs $10.": {1}}},
		{"list in the same paragraph", "It costs $10 [1]. Sources: [1][2]", map[string][]int{"It costs $10.": {1}}},
		{"bold label", "It costs $10 [1].\n\n**References:** [1], [2]", map[string][]int{"It costs $10.": {1}}},
		{"see label", "It costs $10 [1]. See: [2]", map[string][]int{"It costs $10.": {1}}},
		{"markers alone", "It costs $10 [1].\n\n[1], [2], [5]", map[string][]int{"It costs $10.": {1}}},
		{"list under a label", "It costs $10 [1].\n\nSources:\n- [1] The registrar's fee schedule for this year\n- Go FAQ [2]",
			map[string][]int{"It costs $10.": {1}}},
		{"list under a heading", "It costs $10 [1].\n\n## References\n\n1. The registrar's fee schedule for this year [1]",
			map[string][]int{"It costs $10.": {1}}},
		{"a label inside a sentence is prose", "The sources: fees are $10 per copy [1].",
			map[string][]int{"The sources: fees are $10 per copy.": {1}}},
		{"no letters", "It costs $10 [1]. 10 / 20 [2].", map[string][]int{"It costs $10.": {1}}},
		{"evidence", evidenceAnswer, map[string][]int{
			"In Go, arrays and slices behave differently.":                                                                         {1},
			"Arrays have a fixed length.":                                                                                          {2},
			"The size is part of the type (e.g., [3]int and [4]int are distinct types).":                                           {2},
			"Arrays are values: assigning one array to another copies all the elements.":                                           {1, 2},
			"A slice describes a section of an underlying array.":                                                                  {2},
			"For C-like behavior with arrays, you can pass a pointer to the array, but using slices is considered more idiomatic.": {5},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := claimsOf(c.text); !reflect.DeepEqual(got, c.want) {
				t.Errorf("claims =\n%#v\nwant\n%#v", got, c.want)
			}
		})
	}
}

// A citation list neither loses markers nor prevents or causes a refusal
// in enforce mode.
func TestEnforceKeepsCitationList(t *testing.T) {
	text := "Fees are $10 [1]. Orders take 3 days [2].\n\nCitations: [1], [2]"
	cites := []Citation{{N: 1}, {N: 2}}
	claims := extractClaims(text)
	byN := func(_ string, n int) systemone.Verdict {
		if n == 2 {
			return verdict(systemone.Unsupported, 0.95)
		}
		return verdict(systemone.Verified, 0.97)
	}
	ans := &Answer{Text: text, Citations: cites}
	rec := CitationsRecord{Verified: 1}
	enforceRun(true).enforceCitations(ans, claims, lookupFor(claims, byN), &rec)
	if ans.Refused || rec.Removed != 1 || ans.Text != "Fees are $10 [1]. Orders take 3 days.\n\nCitations: [1], [2]" || len(ans.Citations) != 2 {
		t.Errorf("enforced %q %+v %+v", ans.Text, rec, ans.Citations)
	}

	// Nothing supported: the list's markers don't keep a strict agent from refusing.
	none := func(string, int) systemone.Verdict { return verdict(systemone.Unsupported, 0.95) }
	ans = &Answer{Text: text, Citations: cites}
	rec = CitationsRecord{}
	enforceRun(true).enforceCitations(ans, claims, lookupFor(claims, none), &rec)
	if !ans.Refused || !rec.Refused || rec.Removed != 2 {
		t.Errorf("strict: %q %+v", ans.Text, rec)
	}
	// Everything supported: the list is left alone.
	all := func(string, int) systemone.Verdict { return verdict(systemone.Verified, 0.97) }
	ans = &Answer{Text: text, Citations: cites}
	rec = CitationsRecord{Verified: 2}
	enforceRun(true).enforceCitations(ans, claims, lookupFor(claims, all), &rec)
	if ans.Text != text || rec.Removed != 0 || ans.Refused {
		t.Errorf("all supported: %q %+v", ans.Text, rec)
	}
}

// The evidence answer through the citation check against the fake
// SystemOne API: only real sentences are checked, every one verifies, and
// the citations are 1, 2 and 5 (no 3 from the inline code), verified, in
// both modes.
func TestCheckCitationsEvidence(t *testing.T) {
	proxy := testutil.NewFakeProxy(t)
	src := hits(5)
	for _, mode := range []string{systemone.CitationAnnotate, systemone.CitationEnforce} {
		ru := enforceRun(true)
		ru.s = &Service{Log: slog.New(slog.DiscardHandler)}
		ru.cite.Settings.Mode, ru.cite.Settings.TimeoutMs = mode, 5000
		ru.cite.Client = systemone.NewClient(gateway.New(proxy.BaseURL(), proxy.APIKey, 5*time.Second), "jev", uuid.New(), uuid.New(), 4)
		var ans Answer
		ans.Text, ans.Citations = applyCitations(evidenceAnswer, src, CitationSnippet)
		ru.checkCitations(t.Context(), &ans, src, mode)
		rec := ru.citeRec
		if rec == nil || rec.Claims != 6 || rec.Pairs != 7 || rec.Verified != 7 || rec.Unsupported != 0 || rec.Removed != 0 || rec.Refused {
			t.Fatalf("%s: record %+v", mode, rec)
		}
		if ans.Text != evidenceAnswer || ans.Refused {
			t.Errorf("%s: text %q", mode, ans.Text)
		}
		var got []string
		for _, c := range ans.Citations {
			got = append(got, strconv.Itoa(c.N)+" "+c.Verification)
		}
		if want := []string{"1 verified", "2 verified", "5 verified"}; !reflect.DeepEqual(got, want) {
			t.Errorf("%s: citations %v, want %v", mode, got, want)
		}
	}
	// Before the fix, "Citations: , ," was a claim, which the fake (like a
	// real model) finds unsupported.
	if v := proxyVerdict(t, proxy, "Citations: , ,"); v.Verification != systemone.Unsupported {
		t.Errorf("fake verdict for a citation list = %+v", v)
	}
}

func proxyVerdict(t *testing.T, proxy *testutil.FakeProxy, claim string) systemone.Verdict {
	t.Helper()
	cl := systemone.NewClient(gateway.New(proxy.BaseURL(), proxy.APIKey, 5*time.Second), "jev", uuid.New(), uuid.New(), 1)
	vs, _ := cl.CheckClaims(t.Context(), []systemone.ClaimPair{{Claim: claim, Source: "Arrays are values."}}, 5*time.Second)
	return vs[0]
}
