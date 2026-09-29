// Citation checks in the chat pipeline (docs/systemone.md §3, ADR-0020):
// after the final answer, each claim and the source it cites go to the
// SystemOne model, which says whether the source supports, contradicts or
// says nothing about the claim. annotate marks the citations; enforce also
// removes confidently unsupported markers, and a strict agent whose claims
// are all unsupported refuses. Only counts are recorded (ADR-0010).

package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"unicode"

	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/systemone"
)

// maxClaimPairs bounds the claim–source pairs checked per answer; the
// rest stay unchecked.
const maxClaimPairs = 30

// CitationsRecord is the content-free record of an answer's citation check
// (message_events.citations). Counts are of claim–source pairs.
type CitationsRecord struct {
	Mode   string `json:"mode"`
	Claims int    `json:"claims"`
	Pairs  int    `json:"pairs"`
	// Checked pairs got a verdict: Verified + Unsupported + Contradicted.
	Checked      int `json:"checked"`
	Verified     int `json:"verified"`
	Unsupported  int `json:"unsupported"`
	Contradicted int `json:"contradicted"`
	Unchecked    int `json:"unchecked"`
	// LowConfidence counts verdicts below the auto-accept confidence: for
	// review, never acted on.
	LowConfidence int `json:"lowConfidence"`
	// Removed markers (enforce); Refused: enforce replaced the answer with
	// the refusal because no claim was supported.
	Removed int  `json:"removed"`
	Refused bool `json:"refused,omitempty"`
	// Uncited counts the answer's factual sentences without a citation (as
	// the model wrote it, before enforce): unsupported in evaluation scores.
	Uncited   int   `json:"uncited"`
	Requests  int   `json:"requests"`
	LatencyMs int64 `json:"latencyMs"`
}

// CitationsCheckedEvent is the SSE citations_checked event: sent after
// message_end in streaming modes, it replaces the answer's citations (and
// its text in enforce mode).
type CitationsCheckedEvent struct {
	MessageID string     `json:"messageId"`
	Text      string     `json:"text"`
	Citations []Citation `json:"citations"`
	Refused   bool       `json:"refused"`
	Verified  int        `json:"verified"`
	// Unsupported counts unsupported and contradicted pairs.
	Unsupported int `json:"unsupported"`
	Unchecked   int `json:"unchecked"`
	// Uncited are the factual sentences without a citation.
	Uncited []UncitedSentence `json:"uncited,omitempty"`
}

// When citations are checked.
const (
	checkNone   = iota
	checkBefore // before the answer is released (buffer mode, JSON responses)
	checkAfter  // after message_end (streaming)
)

// citationTiming decides whether and when this answer's citations are
// checked: complete answers of an agent that cites, small talk aside. An
// answer without citations is checked too: its factual sentences are
// uncited (verdicts.go).
func (ru *run) citationTiming(ans *Answer, withheld bool) int {
	switch {
	case ru.cite == nil, withheld, ans.Moderation != nil, ans.ErrorCode != "", ans.Refused, ru.cfg.CitationMode == CitationNone,
		ans.StopReason == string(llm.StopReasonAborted), ans.noContextReason == NoContextSmallTalk:
		return checkNone
	case ru.out.emit != nil && !ru.mod.Buffered():
		return checkAfter
	}
	return checkBefore
}

// citationMode is the effective mode: text already streamed through the
// OpenAI-compatible endpoint cannot change, so it is only annotated.
func (ru *run) citationMode(timing int) string {
	if timing == checkAfter && ru.channel == ChannelOpenAI {
		return systemone.CitationAnnotate
	}
	return ru.cite.Settings.Mode
}

// pairKey identifies a claim–source pair (identical pairs are asked once).
type pairKey struct {
	claim string
	n     int
}

// checkCitations checks the answer's claims against their sources and
// applies the mode to the answer. The check outlives a client that left
// (the verdicts are stored) and is bounded by the feature timeout.
func (ru *run) checkCitations(ctx context.Context, ans *Answer, sources []numberedHit, mode string) {
	plan := ru.cite
	byN := map[int]numberedHit{}
	for _, h := range sources {
		byN[h.N] = h
	}
	claims := extractClaims(ans.Text)
	uncited := len(uncitedSpans(ans.Text)) // as the model wrote it: enforce's removals are counted as unsupported
	index, pairs := claimPairs(claims, byN)
	if len(pairs) == 0 {
		if uncited > 0 { // nothing to ask, but sentences without a citation
			ru.citeRec = &CitationsRecord{Mode: mode, Claims: len(claims), Uncited: uncited}
			ans.Uncited = shownUncited(ans)
		}
		return
	}
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), plan.Settings.Timeout())
	defer cancel()
	verdicts, st := plan.Client.CheckClaims(cctx, pairs, plan.Settings.Timeout())
	rec := citationsRecord(mode, len(claims), verdicts, plan.Settings.AutoAccept)
	if rec.Unchecked > 0 {
		ru.s.Log.Warn("citation check requests failed; those citations stay unchecked", "agent", ru.agent.ID,
			"failed", rec.Unchecked, "of", len(pairs), "err", firstErr(verdicts))
	}
	rec.Requests, rec.LatencyMs, rec.Uncited = st.Requests, st.Latency.Milliseconds(), uncited
	v := verdictLookup{index: index, verdicts: verdicts}
	if mode == systemone.CitationEnforce {
		ru.enforceCitations(ans, claims, v, &rec)
	}
	if !rec.Refused {
		final := extractClaims(ans.Text)
		ans.Citations = markerVerdicts(annotateCitations(ans.Citations, final, v), ans.Text, final, v)
		ans.Uncited = shownUncited(ans)
	}
	ru.citeRec = &rec
}

// claimPairs are the distinct claim–source pairs to ask about (at most
// maxClaimPairs), with each pair's index.
func claimPairs(claims []claim, byN map[int]numberedHit) (map[pairKey]int, []systemone.ClaimPair) {
	index := map[pairKey]int{}
	var pairs []systemone.ClaimPair
	for _, c := range claims {
		for _, m := range c.Markers {
			k := pairKey{c.Text, m.N}
			h, ok := byN[m.N]
			if _, seen := index[k]; seen || !ok || len(pairs) >= maxClaimPairs {
				continue
			}
			index[k] = len(pairs)
			pairs = append(pairs, systemone.ClaimPair{Claim: c.Text, Source: sourceText(h)})
		}
	}
	return index, pairs
}

// shownUncited are the uncited sentences the chat marks: none for an answer
// without sources (the chat already says it isn't based on them).
func shownUncited(ans *Answer) []UncitedSentence {
	if ans.NoContext {
		return nil
	}
	return UncitedSentences(ans.Text)
}

func firstErr(vs []systemone.Verdict) error {
	for _, v := range vs {
		if v.Err != nil {
			return v.Err
		}
	}
	return nil
}

// sourceText is what the model reads for a cited source.
func sourceText(h numberedHit) string {
	if t := strings.TrimSpace(h.Title); t != "" {
		return t + "\n\n" + h.Content
	}
	return h.Content
}

func citationsRecord(mode string, claims int, vs []systemone.Verdict, autoAccept float64) CitationsRecord {
	rec := CitationsRecord{Mode: mode, Claims: claims, Pairs: len(vs)}
	for _, v := range vs {
		switch v.Verification {
		case systemone.Verified:
			rec.Verified++
		case systemone.Unsupported:
			rec.Unsupported++
		case systemone.Contradicted:
			rec.Contradicted++
		default:
			rec.Unchecked++
			continue
		}
		rec.Checked++
		if v.Confidence < autoAccept {
			rec.LowConfidence++
		}
	}
	return rec
}

// verdictLookup finds the verdict of a claim and source.
type verdictLookup struct {
	index    map[pairKey]int
	verdicts []systemone.Verdict
}

func (l verdictLookup) of(claim string, n int) (systemone.Verdict, bool) {
	i, ok := l.index[pairKey{claim, n}]
	if !ok {
		return systemone.Verdict{}, false
	}
	return l.verdicts[i], true
}

// negative reports a confident unsupported or contradicted verdict.
func negative(v systemone.Verdict, autoAccept float64) bool {
	return (v.Verification == systemone.Unsupported || v.Verification == systemone.Contradicted) && v.Confident(autoAccept)
}

// enforceCitations removes the markers of confidently unsupported or
// contradicted claims. When that leaves no marker on a checked claim and
// nothing was verified, a strict agent answers with the refusal instead.
// Markers that aren't on a checked claim (a citation list) are never
// removed, and don't keep an unsupported answer from being refused.
func (ru *run) enforceCitations(ans *Answer, claims []claim, v verdictLookup, rec *CitationsRecord) {
	drop := map[int]bool{} // marker start offsets
	claimed := map[int]bool{}
	for _, c := range claims {
		for _, m := range c.Markers {
			claimed[m.Start] = true
			if vd, ok := v.of(c.Text, m.N); ok && negative(vd, ru.cite.Settings.AutoAccept) {
				drop[m.Start] = true
			}
		}
	}
	if len(drop) == 0 {
		return
	}
	text, _ := removeMarkers(ans.Text, drop)
	rec.Removed = len(drop)
	if ru.cfg.StrictlyGrounded && len(claimed) == len(drop) && rec.Verified == 0 {
		rec.Refused = true
		ans.Text, ans.Refused, ans.Citations = ru.cfg.RefusalMessage, true, []Citation{}
		ru.citeChanged = true
		return
	}
	ans.Text = text
	ru.citeChanged = true
	cited := map[int]bool{}
	for _, m := range extractMarkers(text) {
		cited[m.N] = true
	}
	cites := []Citation{}
	for _, c := range ans.Citations {
		if cited[c.N] {
			cites = append(cites, c)
		}
	}
	ans.Citations = cites
}

// extractMarkers returns every marker of text (in a claim or not).
func extractMarkers(text string) []claimMarker {
	var out []claimMarker
	for _, m := range findMarkers(text) {
		for _, n := range markerNums(m.Inner) {
			out = append(out, claimMarker{N: n, Start: m.Start, End: m.End, At: m.At})
		}
	}
	return out
}

// markerNums parses the numbers inside a marker ("1", "1, 2").
func markerNums(inner string) []int {
	var out []int
	for _, part := range strings.Split(strings.ReplaceAll(inner, "\uff0c", ","), ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(part)); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// removeMarkers drops the markers starting at the given offsets (the text
// is normalised: one number per marker). A dropped marker's leading space
// moves to a kept marker right after it (" [1][2]" without [1] reads
// " [2]"). kept counts the markers left.
func removeMarkers(text string, drop map[int]bool) (string, int) {
	var b strings.Builder
	last, kept, carry := 0, 0, ""
	for _, m := range extractMarkers(text) {
		if m.Start < last {
			continue // another number of the same group
		}
		if m.Start > last {
			carry = "" // text in between: nothing to carry over
		}
		b.WriteString(text[last:m.Start])
		marker := text[m.Start:m.End]
		lead := marker[:len(marker)-len(strings.TrimLeftFunc(marker, unicode.IsSpace))]
		if drop[m.Start] {
			if carry == "" {
				carry = lead
			}
		} else {
			kept++
			if lead == "" {
				b.WriteString(carry)
			}
			b.WriteString(marker)
			carry = ""
		}
		last = m.End
	}
	b.WriteString(text[last:])
	return strings.TrimRightFunc(b.String(), unicode.IsSpace), kept
}

// annotateCitations sets each citation's verification from the verdicts of
// the claims citing it: contradicted if any claim is contradicted, else
// unsupported if any is, else verified if any is, else unchecked.
func annotateCitations(cites []Citation, claims []claim, v verdictLookup) []Citation {
	byN := map[int][]systemone.Verdict{}
	for _, c := range claims {
		for _, m := range c.Markers {
			if vd, ok := v.of(c.Text, m.N); ok {
				byN[m.N] = append(byN[m.N], vd)
			}
		}
	}
	out := make([]Citation, len(cites))
	for i, c := range cites {
		c.Verification, c.Confidence = aggregateVerdicts(byN[c.N])
		out[i] = c
	}
	return out
}

// aggregateVerdicts folds a citation's verdicts: the worst verdict wins,
// with the most confident negative or the least confident verification.
func aggregateVerdicts(vs []systemone.Verdict) (string, *float64) {
	for _, worst := range []string{systemone.Contradicted, systemone.Unsupported, systemone.Verified} {
		conf, found := 0.0, false
		for _, v := range vs {
			if v.Verification != worst {
				continue
			}
			switch {
			case !found:
				conf = v.Confidence
			case worst == systemone.Verified:
				conf = min(conf, v.Confidence)
			default:
				conf = max(conf, v.Confidence)
			}
			found = true
		}
		if found {
			return worst, &conf
		}
	}
	return systemone.Unchecked, nil
}

// citationsJSON is the message_events.citations value (nil when nothing
// was checked).
func (ru *run) citationsJSON() json.RawMessage {
	if ru.citeRec == nil {
		return nil
	}
	b, _ := json.Marshal(ru.citeRec)
	return b
}

// citationsChecked is the SSE event for a checked answer.
func (ru *run) citationsChecked(ans Answer) Event {
	ev := CitationsCheckedEvent{MessageID: ans.MessageID.String(), Text: ans.Text, Citations: ans.Citations, Refused: ans.Refused,
		Uncited: ans.Uncited}
	if r := ru.citeRec; r != nil {
		ev.Verified, ev.Unsupported, ev.Unchecked = r.Verified, r.Unsupported+r.Contradicted, r.Unchecked
	}
	return Event{"citations_checked", ev}
}
