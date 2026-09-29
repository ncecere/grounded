package agents

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/systemone"
)

// claimSummary is a claim as "verdict: text [sources]".
type claimSummary struct {
	Verdict string
	Text    string
	Sources []int
}

func summarize(claims []Claim) []claimSummary {
	out := []claimSummary{}
	for _, c := range claims {
		out = append(out, claimSummary{c.Verdict, c.Text, c.Sources})
	}
	return out
}

// byNumber answers every claim's source n with verdicts[n].
func byNumber(verdicts map[int]systemone.Verdict) func(string, int) systemone.Verdict {
	return func(_ string, n int) systemone.Verdict { return verdicts[n] }
}

// claimsOfText builds the claims of text with the verdicts of of.
func claimsOfText(text string, of func(string, int) systemone.Verdict) []Claim {
	claims := extractClaims(text)
	return buildClaims(text, claims, lookupFor(claims, of))
}

// A claim is one factual sentence with one verdict (v0.2.1, I9): supported
// when any source it cites supports it, not supported when none does, and
// uncited without a marker. Per-source outcomes are kept.
func TestBuildClaims(t *testing.T) {
	text := "Transcripts cost $10 each [1][2]. Orders take ten business days [2][3]. Log in with your campus account first. " +
		"Rush delivery costs $25 [1]."
	claims := claimsOfText(text, byNumber(map[int]systemone.Verdict{
		1: verdict(systemone.Unsupported, 0.9), 2: verdict(systemone.Verified, 0.95), 3: verdict(systemone.Contradicted, 0.7),
	}))
	want := []claimSummary{
		{ClaimSupported, "Transcripts cost $10 each.", []int{2}},
		{ClaimSupported, "Orders take ten business days.", []int{2}},
		{ClaimUncited, "Log in with your campus account first.", []int{}},
		{ClaimNotSupported, "Rush delivery costs $25.", []int{}},
	}
	if got := summarize(claims); !reflect.DeepEqual(got, want) {
		t.Fatalf("claims =\n%+v\nwant\n%+v", got, want)
	}
	for i, c := range claims {
		if c.Index != i {
			t.Errorf("claim %d has index %d", i, c.Index)
		}
	}
	// Per-source outcomes, with the occurrence of each marker: the second
	// [2] is in the second sentence, the second [1] in the last.
	first := claims[0].Checks
	if len(first) != 2 || first[0].N != 1 || first[0].Verification != systemone.Unsupported || *first[0].Occurrence != 0 ||
		first[1].N != 2 || first[1].Verification != systemone.Verified || *first[1].Occurrence != 0 {
		t.Errorf("checks of claim 0 = %s", mustJSON(first))
	}
	if second := claims[1].Checks; *second[0].Occurrence != 1 || second[1].Verification != systemone.Contradicted {
		t.Errorf("checks of claim 1 = %s", mustJSON(second))
	}
	if last := claims[3]; *last.Checks[0].Occurrence != 1 || *last.Confidence != 0.9 {
		t.Errorf("last claim = %s", mustJSON(last))
	}
	if claims[0].Confidence == nil || *claims[0].Confidence != 0.95 || claims[2].Checks != nil || claims[2].Confidence != nil {
		t.Errorf("confidence: %s", mustJSON(claims))
	}
	if n := CountClaims(claims); n != (ClaimCounts{Supported: 2, NotSupported: 1, Uncited: 1}) || n.Scored() != 4 {
		t.Errorf("counts = %+v", n)
	}
}

// Not supported takes the least confident negative verdict; a failed check
// with nothing supporting leaves the claim unchecked.
func TestClaimVerdictFolding(t *testing.T) {
	text := "Fees are due at registration [1][2]. Late fees apply after that [3][4]."
	claims := claimsOfText(text, byNumber(map[int]systemone.Verdict{
		1: verdict(systemone.Unsupported, 0.9), 2: verdict(systemone.Contradicted, 0.6),
		3: verdict(systemone.Unsupported, 0.99), 4: verdict(systemone.Unchecked, 0),
	}))
	if claims[0].Verdict != ClaimNotSupported || *claims[0].Confidence != 0.6 {
		t.Errorf("claim 0 = %s", mustJSON(claims[0]))
	}
	if claims[1].Verdict != ClaimUnchecked || claims[1].Confidence != nil || claims[1].Checks[1].Confidence != nil {
		t.Errorf("claim 1 = %s", mustJSON(claims[1]))
	}
	if n := CountClaims(claims); n.Scored() != 1 || n.Unchecked != 1 {
		t.Errorf("counts = %+v", n)
	}
}

// Headings, greetings, questions and sentences saying what the sources
// don't cover are not claims, cited or not; their markers aren't checked.
func TestClaimsAreFactualSentences(t *testing.T) {
	text := "## Ordering official transcripts [1]\n\nHi there! Would you like the mailing address [2]? " +
		"The sources don't mention the processing fee [2]. Transcripts cost $10 [1].\n\nHope this helps. Let me know if you need more."
	claims := claimsOfText(text, byNumber(map[int]systemone.Verdict{1: verdict(systemone.Verified, 0.9), 2: verdict(systemone.Verified, 0.9)}))
	want := []claimSummary{{ClaimSupported, "Transcripts cost $10.", []int{1}}}
	if got := summarize(claims); !reflect.DeepEqual(got, want) {
		t.Errorf("claims = %+v", got)
	}
	// A refusal has no claims.
	if got := claimsOfText("I couldn't find anything about that in the documents I have.", nil); len(got) != 0 {
		t.Errorf("refusal claims = %+v", got)
	}
}

// Brackets in code are not markers: a sentence whose only "marker" is in
// code is uncited, and code blocks have no claims.
func TestClaimsIgnoreMarkersInCode(t *testing.T) {
	text := "Index the array with `a[1]` in the script.\n\n```\nfees [2] are listed here\n```\n\nThe fee is listed in the table [1]."
	claims := claimsOfText(text, byNumber(map[int]systemone.Verdict{1: verdict(systemone.Verified, 0.9), 2: verdict(systemone.Verified, 0.9)}))
	want := []claimSummary{
		{ClaimUncited, "Index the array with a[1] in the script.", []int{}},
		{ClaimSupported, "The fee is listed in the table.", []int{1}},
	}
	if got := summarize(claims); !reflect.DeepEqual(got, want) {
		t.Errorf("claims = %+v", got)
	}
}

// Offsets are code points of the answer text, and the text read back from
// a stored claim (no text) is the same.
func TestClaimOffsetsAndStoredText(t *testing.T) {
	text := "Café hours are 8–5 on weekdays [1]. The café is in Building\u00a02, room 104."
	claims := claimsOfText(text, byNumber(map[int]systemone.Verdict{1: verdict(systemone.Verified, 0.9)}))
	runes := []rune(text)
	if len(claims) != 2 || string(runes[claims[0].Start:claims[0].End]) != "Café hours are 8–5 on weekdays [1]." ||
		string(runes[claims[1].Start:claims[1].End]) != "The café is in Building\u00a02, room 104." {
		t.Fatalf("claims = %s", mustJSON(claims))
	}
	stored := storedClaims(claims)
	raw, _ := json.Marshal(stored)
	if strings.Contains(string(raw), "Café") || strings.Contains(string(raw), `"text"`) {
		t.Errorf("stored claims carry text: %s", raw)
	}
	var back []Claim
	_ = json.Unmarshal(raw, &back)
	if got := FillClaimText(text, back); !reflect.DeepEqual(got, claims) {
		t.Errorf("read back =\n%s\nwant\n%s", mustJSON(got), mustJSON(claims))
	}
}

// Enforce removes the marker of a confidently unsupported claim: the claim
// stays not supported (with its outcome, without an occurrence) rather than
// reading as uncited.
func TestClaimsAfterEnforce(t *testing.T) {
	text := "Fees are $10 [1][2]. Orders take 3 days [2]."
	of := func(claim string, n int) systemone.Verdict {
		if n == 1 {
			return verdict(systemone.Verified, 0.97)
		}
		return verdict(systemone.Unsupported, 0.95)
	}
	claims := extractClaims(text)
	v := lookupFor(claims, of)
	ans := &Answer{Text: text, Citations: []Citation{{N: 1}, {N: 2}}}
	rec := CitationsRecord{Verified: 1}
	enforceRun(false).enforceCitations(ans, claims, v, &rec)
	if ans.Text != "Fees are $10 [1]. Orders take 3 days." {
		t.Fatalf("enforced %q", ans.Text)
	}
	got := buildClaims(ans.Text, claims, v)
	want := []claimSummary{{ClaimSupported, "Fees are $10.", []int{1}}, {ClaimNotSupported, "Orders take 3 days.", []int{}}}
	if !reflect.DeepEqual(summarize(got), want) {
		t.Fatalf("claims = %+v", summarize(got))
	}
	if c := got[0].Checks[1]; c.N != 2 || c.Occurrence != nil || c.Verification != systemone.Unsupported {
		t.Errorf("removed marker's check = %s", mustJSON(c))
	}
	if c := got[1].Checks[0]; c.Occurrence != nil {
		t.Errorf("removed marker's occurrence = %s", mustJSON(c))
	}
}

// A list item under a lead-in and a table data row are claims of their own.
func TestClaimsOfListsAndTables(t *testing.T) {
	text := "You can order a transcript:\n\n- Online through the student portal [1]\n- By mail with the request form\n\n" +
		"| Item | Fee |\n|---|---|\n| Official transcript | $10 [2] |"
	claims := claimsOfText(text, byNumber(map[int]systemone.Verdict{1: verdict(systemone.Verified, 0.9), 2: verdict(systemone.Unsupported, 0.9)}))
	want := []claimSummary{
		{ClaimSupported, "Online through the student portal", []int{1}},
		{ClaimUncited, "By mail with the request form", []int{}},
		{ClaimNotSupported, "Official transcript · $10", []int{}},
	}
	if got := summarize(claims); !reflect.DeepEqual(got, want) {
		t.Errorf("claims = %+v", got)
	}
}

// Terms in a bulleted list are treated alike (the v0.2.1 walkthrough): none
// is an uncited claim, and a cited one is checked with the list's lead-in.
func TestClaimsOfListFragments(t *testing.T) {
	text := "3. **Follow the prompts**, where you confirm:\n   - Recipient (yourself)\n   - \u201cProcess As Is\u201d option\n" +
		"   - Purpose (e.g., certification/licensure)\n   - Delivery method (e.g., mail) [2]."
	claims := claimsOfText(text, byNumber(map[int]systemone.Verdict{2: verdict(systemone.Verified, 0.9)}))
	want := []claimSummary{{ClaimSupported, "Delivery method (e.g., mail).", []int{2}}}
	if got := summarize(claims); !reflect.DeepEqual(got, want) {
		t.Errorf("claims = %+v", got)
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
