package agents

import (
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/testutil"
)

// markerStates is each citation's per-marker verifications.
func markerStates(cites []Citation) map[int][]string {
	out := map[int][]string{}
	for _, c := range cites {
		for _, m := range c.Markers {
			out[c.N] = append(out[c.N], m.Verification)
		}
	}
	return out
}

// Each [n] gets the verdict of its own sentence: [2] verified in one
// sentence and unsupported in another, not the source's worst verdict on
// both (the v0.2 review).
func TestMarkerVerdicts(t *testing.T) {
	text := "You need an active account [2]. Orders can't be changed after submission [2]. Mark yourself as the recipient [1][2].\n\n" +
		"Sources: [1], [2]"
	claims := extractClaims(text)
	of := func(claim string, n int) systemone.Verdict {
		if n == 2 && strings.HasPrefix(claim, "Mark yourself") {
			return verdict(systemone.Unsupported, 0.96)
		}
		return verdict(systemone.Verified, 0.97)
	}
	v := lookupFor(claims, of)
	cites := markerVerdicts(annotateCitations([]Citation{{N: 1}, {N: 2}}, claims, v), text, claims, v)
	want := map[int][]string{
		1: {"verified", "unchecked"}, // the "Sources:" list isn't a claim
		2: {"verified", "verified", "unsupported", "unchecked"},
	}
	if got := markerStates(cites); !reflect.DeepEqual(got, want) {
		t.Fatalf("markers = %v, want %v", got, want)
	}
	// The citation's own verdict is still the worst, for the source card.
	if cites[1].Verification != systemone.Unsupported || *cites[1].Markers[0].Confidence != 0.97 || cites[1].Markers[3].Confidence != nil {
		t.Errorf("citation 2 = %+v", cites[1])
	}
}

// uncitedTexts is UncitedSentences as the sentences' text.
func uncitedTexts(text string) []string {
	var out []string
	runes := []rune(text)
	for _, u := range UncitedSentences(text) {
		out = append(out, string(runes[u.Start:u.End]))
	}
	return out
}

func TestUncitedSentences(t *testing.T) {
	cases := []struct {
		name, text string
		want       []string
	}{
		{"cited and uncited sentences", "Transcripts cost $10 each [1]. Log in with your campus password first. Orders take ten days [2].",
			[]string{"Log in with your campus password first."}},
		{"marker on its own line cites the sentence", "Transcripts are sent electronically.\n[1]", nil},
		{"questions, greetings and closings aren't claims", "Hi there! Would you like the mailing address? Hope this helps. " +
			"Let me know if you need anything else. Fees are $10 [1].", nil},
		{"saying what isn't covered", "The fee for a replacement diploma isn't mentioned in the sources. I couldn't find the processing time. " +
			"Email the office to ask [1].", nil},
		{"headings, bold lines, lead-ins and code", "## How to order a transcript\n\n**Official transcript steps**\n\nYou can order it as follows:\n\n" +
			"- Log in to the student portal [1]\n- Choose the delivery method in the form\n\n```\nnot a claim at all here\n```", []string{"Choose the delivery method in the form"}},
		{"short sentences", "Yes. It depends [1]. See below.", nil},
		{"table rows", "| Item | Fee |\n|---|---|\n| Official transcript | $10 [1] |\n| Rush delivery overnight | $25 |",
			[]string{"| Rush delivery overnight | $25"}},
		{"code points, not bytes", "Café hours are 9–5 on weekdays. Fees apply [1].", []string{"Café hours are 9–5 on weekdays."}},
		{"none", "", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := uncitedTexts(c.text); !reflect.DeepEqual(got, c.want) {
				t.Errorf("uncited = %q, want %q", got, c.want)
			}
		})
	}
}

// checkCitations against the fake SystemOne API: per-marker verdicts and the
// uncited sentences on the answer, and the uncited count in the record.
// An answer without citations still gets its uncited sentences counted.
func TestCheckCitationsMarkersAndUncited(t *testing.T) {
	proxy := testutil.NewFakeProxy(t)
	src := hits(2)
	src[1].Content = "UNSUPPORTED rush orders"
	newRun := func() *run {
		ru := enforceRun(true)
		ru.s = &Service{Log: slog.New(slog.DiscardHandler)}
		ru.cite.Settings.Mode, ru.cite.Settings.TimeoutMs = systemone.CitationAnnotate, 5000
		ru.cite.Client = systemone.NewClient(gateway.New(proxy.BaseURL(), proxy.APIKey, 5*time.Second), "jev", uuid.New(), uuid.New(), 4)
		return ru
	}
	var ans Answer
	ans.Text, ans.Citations = applyCitations("Fees are ten dollars per copy [1]. Rush orders UNSUPPORTED arrive the same day [2]. "+
		"Pick them up at the front desk. Fees are ten dollars per copy [1].", src, CitationSnippet)
	ru := newRun()
	ru.checkCitations(t.Context(), &ans, src, systemone.CitationAnnotate)
	if got, want := markerStates(ans.Citations), map[int][]string{1: {"verified", "verified"}, 2: {"unsupported"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("markers = %v, want %v", got, want)
	}
	if len(ans.Uncited) != 1 || string([]rune(ans.Text)[ans.Uncited[0].Start:ans.Uncited[0].End]) != "Pick them up at the front desk." {
		t.Errorf("uncited = %+v", ans.Uncited)
	}
	if rec := ru.citeRec; rec == nil || rec.Uncited != 1 || rec.Verified != 1 || rec.Unsupported != 1 {
		t.Errorf("record = %+v", rec)
	}

	// No citations at all: nothing to ask, but the sentences are uncited.
	ans = Answer{Text: "Fees are ten dollars per copy. Orders take ten business days.", Citations: []Citation{}}
	ru = newRun()
	ru.checkCitations(t.Context(), &ans, src, systemone.CitationAnnotate)
	if rec := ru.citeRec; rec == nil || rec.Uncited != 2 || rec.Checked != 0 || rec.Requests != 0 || len(ans.Uncited) != 2 {
		t.Errorf("no citations: record %+v, uncited %+v", ru.citeRec, ans.Uncited)
	}
	// An answer without sources isn't marked (the chat says so already), but is counted.
	ans = Answer{Text: "Fees are ten dollars per copy.", Citations: []Citation{}, NoContext: true}
	ru = newRun()
	ru.checkCitations(t.Context(), &ans, src, systemone.CitationAnnotate)
	if ru.citeRec == nil || ru.citeRec.Uncited != 1 || ans.Uncited != nil {
		t.Errorf("no context: record %+v, uncited %+v", ru.citeRec, ans.Uncited)
	}
}
