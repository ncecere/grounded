// The fake gateway's SystemOne API (ADR-0020): POST /v1/systemone,
// deterministic and driven by markers in the text.
//
// Moderation (state is the text, or {user_question, assistant_answer} for
// output checks): a noul question named after a category scores
// FakeUnsafeScore when the text carries the category's marker (see
// fakemoderation.go). The "severity" score is 3 with the marker SEVERE,
// FakeUnsafeSeverity with any UNSAFE- marker, and 0.1 otherwise.
//
// Passage judging (state {query, passage} per passage, or {query,
// passages: {p1, …}} batched with questions "p1_relevant", …): a passage
// scores relevant 0.9, evidence 0.85, contradicts 0.03 and injection 0.02,
// changed by markers in its title or text:
//
//	IRRELEVANT   relevant 0.05, evidence 0.05
//	INJECTION    injection 0.97
//	CONTRADICTS  contradicts 0.93
//	NOEVIDENCE   evidence 0.2
//	RANKLOW      relevant 0.5 (kept, ranked below the default)
//	RANKHIGH     relevant 0.99
//
// Citation checks (state {claim, section}, choice question "relation"):
// supports with confidence 0.97, changed by markers in the claim:
//
//	CONTRADICTED  contradicts, 0.95
//	WEAKCONTRA    contradicts, 0.5 (below the default auto-accept)
//	UNSUPPORTED   says_nothing, 0.95
//	LOWCONF       says_nothing, 0.5 (below the default auto-accept)
//
// and a claim starting with a citation-list label ("Citations:",
// "Sources:", "References:") says_nothing 0.95, as a real model judges a
// bare citation list.
//
// Scope checks (state {message, agent}): small_talk 0.96 when the message
// carries SMALLTALK or is only a greeting or thanks ("hi", "thanks!"),
// otherwise 0.02; in_scope 0.04 with the marker OFFTOPIC, otherwise 0.93.
//
// The answer cache's same-question check (state {question,
// cached_question}): same_question 0.95, or 0.05 when the question carries
// DIFFERENT.
//
// The gap report's same-subject check (state {question, other_question}):
// same_subject 0.95, or 0.05 when either question carries DIFFERENT.
//
// Other noul questions answer FakeSafeScore, other score questions 0 and
// choice questions their first option (sorted).

package testutil

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// FakeUnsafeSeverity is the fake severity of a text with an UNSAFE- marker.
const FakeUnsafeSeverity = 2.4

// FailJudgingWith makes passage-judging requests answer status (0
// restores).
func (p *FakeProxy) FailJudgingWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.judgeFail = status
}

// SetJudgingDelay delays every passage-judging answer by d.
func (p *FakeProxy) SetJudgingDelay(d time.Duration) { p.SetJudgingDelays(d) }

// SetJudgingDelays delays the passage-judging answers in turn: request n
// (counted from the fake's start) waits ds[n % len(ds)]. None: no delay.
func (p *FakeProxy) SetJudgingDelays(ds ...time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.judgeDelays = ds
}

// SetScopeDelay delays every scope-check answer by d.
func (p *FakeProxy) SetScopeDelay(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.scopeDelay = d
}

// wait pauses d unless the request goes away first (false).
func wait(r *http.Request, d time.Duration) bool {
	if d <= 0 {
		return true
	}
	select {
	case <-time.After(d):
		return true
	case <-r.Context().Done():
		return false
	}
}

// JudgingRequests counts passage-judging requests so far.
func (p *FakeProxy) JudgingRequests() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.judgeCalls
}

// admitJudging applies injected judging failures and delays.
func (p *FakeProxy) admitJudging(w http.ResponseWriter, r *http.Request) bool {
	p.mu.Lock()
	var delay time.Duration
	if len(p.judgeDelays) > 0 {
		delay = p.judgeDelays[p.judgeCalls%len(p.judgeDelays)]
	}
	p.judgeCalls++
	fail := p.judgeFail
	p.mu.Unlock()
	if !wait(r, delay) {
		return false
	}
	if fail != 0 {
		writeErr(w, fail, "judging failure (test)")
		return false
	}
	return true
}

type fakeQuestion struct {
	Type     string          `json:"type"`
	Criteria json.RawMessage `json:"criteria"`
}

type fakePassage struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

type fakeS1State struct {
	Claim    *string                `json:"claim"`
	Message  *string                `json:"message"`
	Agent    json.RawMessage        `json:"agent"`
	Answer   *string                `json:"assistant_answer"`
	Query    *string                `json:"query"`
	Passage  *fakePassage           `json:"passage"`
	Passages map[string]fakePassage `json:"passages"`
	Question *string                `json:"question"`
	Cached   *string                `json:"cached_question"`
	Other    *string                `json:"other_question"`
}

func (p *FakeProxy) systemOne(w http.ResponseWriter, r *http.Request) {
	var in struct {
		State     json.RawMessage         `json:"state"`
		Model     string                  `json:"model"`
		Questions map[string]fakeQuestion `json:"questions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Model == "" || len(in.Questions) == 0 || len(in.State) == 0 {
		writeErr(w, 422, "state, model and questions are required")
		return
	}
	p.log(r, in.Model)
	var st fakeS1State
	var text string
	if json.Unmarshal(in.State, &text) != nil {
		_ = json.Unmarshal(in.State, &st)
		text = string(in.State)
		if st.Answer != nil {
			text = *st.Answer
		}
	}
	if !p.admitSystemOne(w, r, st) {
		return
	}
	answers := map[string]any{}
	for id, q := range in.Questions {
		answers[id] = fakeS1Answer(id, q, text, st)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-fake-1.0", "answers": answers,
		"usage": map[string]int{"input_tokens": len(strings.Fields(string(in.State))) + 100, "output_tokens": 0}})
}

func fakeS1Answer(id string, q fakeQuestion, text string, st fakeS1State) map[string]any {
	switch q.Type {
	case "score":
		var levels []string
		_ = json.Unmarshal(q.Criteria, &levels)
		v := 0.0
		if id == "severity" {
			v = fakeSeverity(text)
		}
		v = min(v, float64(max(len(levels)-1, 0)))
		legend, probs := map[string]string{}, map[string]float64{}
		for i, l := range levels {
			legend[strconv.Itoa(i)], probs[strconv.Itoa(i)] = l, 0
		}
		probs[strconv.Itoa(int(v+0.5))] = 1
		return map[string]any{"type": "score", "score": v, "legend": legend, "probabilities": probs, "confidence": 0.9}
	case "choice":
		if st.Claim != nil {
			return fakeCitationAnswer(*st.Claim)
		}
		var opts map[string]any
		_ = json.Unmarshal(q.Criteria, &opts)
		keys := make([]string, 0, len(opts))
		for k := range opts {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		probs := map[string]float64{}
		for i, k := range keys {
			probs[k] = map[bool]float64{true: 1, false: 0}[i == 0]
		}
		choice := ""
		if len(keys) > 0 {
			choice = keys[0]
		}
		return map[string]any{"type": "choice", "choice": choice, "probabilities": probs, "confidence": 1}
	}
	return map[string]any{"type": "noul", "noul": fakeNoul(id, text, st)}
}

func fakeSeverity(text string) float64 {
	up := strings.ToUpper(text)
	switch {
	case strings.Contains(up, "SEVERE"):
		return 3
	case strings.Contains(up, "UNSAFE-") || strings.Contains(up, "HURT SOMEONE"):
		return FakeUnsafeSeverity
	}
	return 0.1
}

// fakeNoul answers a noul question: a judging question about a passage, a
// moderation category, or FakeSafeScore.
func fakeNoul(id, text string, st fakeS1State) float64 {
	if st.Message != nil && st.Agent != nil {
		return fakeScope(id, *st.Message)
	}
	if st.Question != nil && st.Cached != nil {
		if strings.Contains(strings.ToUpper(*st.Question), "DIFFERENT") {
			return 0.05
		}
		return 0.95
	}
	if st.Question != nil && st.Other != nil {
		if strings.Contains(strings.ToUpper(*st.Question+*st.Other), "DIFFERENT") {
			return 0.05
		}
		return 0.95
	}
	if st.Query != nil {
		passage, question := st.Passage, id
		if st.Passages != nil {
			if i := strings.LastIndex(id, "_"); i > 0 {
				if ps, ok := st.Passages[id[:i]]; ok {
					passage, question = &ps, id[i+1:]
				}
			}
		}
		if passage != nil {
			if v, ok := FakeJudgment(passage.Title + "\n" + passage.Text)[question]; ok {
				return v
			}
		}
	}
	if v, ok := FakeModerationScores(text)[id]; ok {
		return v
	}
	return FakeSafeScore
}

// FakeJudgment returns the fake's four judging answers for a passage.
func FakeJudgment(passage string) map[string]float64 {
	out := map[string]float64{"relevant": 0.9, "evidence": 0.85, "contradicts": 0.03, "injection": 0.02}
	up := strings.ToUpper(passage)
	marks := []struct {
		marker, question string
		v                float64
	}{
		{"IRRELEVANT", "relevant", 0.05}, {"IRRELEVANT", "evidence", 0.05}, {"INJECTION", "injection", 0.97},
		{"CONTRADICTS", "contradicts", 0.93}, {"NOEVIDENCE", "evidence", 0.2},
		{"RANKLOW", "relevant", 0.5}, {"RANKHIGH", "relevant", 0.99},
	}
	for _, m := range marks {
		if strings.Contains(up, m.marker) {
			out[m.question] = m.v
		}
	}
	return out
}

// admitSystemOne counts the request by feature and applies injected
// failures and delays.
func (p *FakeProxy) admitSystemOne(w http.ResponseWriter, r *http.Request, st fakeS1State) bool {
	switch {
	case st.Query != nil && (st.Passage != nil || st.Passages != nil):
		return p.admitJudging(w, r)
	case st.Claim != nil:
		return p.admitCitations(w, r)
	case st.Message != nil && st.Agent != nil:
		p.mu.Lock()
		p.scopeCalls++
		fail, delay := p.scopeFail, p.scopeDelay
		p.mu.Unlock()
		if !wait(r, delay) {
			return false
		}
		if fail != 0 {
			writeErr(w, fail, "scope failure (test)")
			return false
		}
		return true
	}
	return p.admitModeration(w, r)
}

// CitationRequests counts citation-check requests so far.
func (p *FakeProxy) CitationRequests() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.citeCalls
}

// ScopeRequests counts scope-check requests so far.
func (p *FakeProxy) ScopeRequests() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.scopeCalls
}

// SetCitationDelay delays every citation-check answer by d.
func (p *FakeProxy) SetCitationDelay(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.citeDelay = d
}

// FailScopeWith makes scope-check requests answer status (0 restores).
func (p *FakeProxy) FailScopeWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.scopeFail = status
}

func (p *FakeProxy) admitCitations(w http.ResponseWriter, r *http.Request) bool {
	p.mu.Lock()
	p.citeCalls++
	delay := p.citeDelay
	p.mu.Unlock()
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return false
		}
	}
	return true
}

// fakeCitationAnswer is the relation answer for a claim (see markers above).
func fakeCitationAnswer(claim string) map[string]any {
	up := strings.ToUpper(claim)
	choice, conf := "supports", 0.97
	switch {
	case strings.Contains(up, "WEAKCONTRA"):
		choice, conf = "contradicts", 0.5
	case strings.Contains(up, "CONTRADICTED"):
		choice, conf = "contradicts", 0.95
	case strings.Contains(up, "UNSUPPORTED"):
		choice, conf = "says_nothing", 0.95
	case strings.Contains(up, "LOWCONF"):
		choice, conf = "says_nothing", 0.5
	case strings.HasPrefix(up, "CITATIONS:"), strings.HasPrefix(up, "SOURCES:"), strings.HasPrefix(up, "REFERENCES:"):
		choice, conf = "says_nothing", 0.95
	}
	probs := map[string]float64{"supports": 0, "contradicts": 0, "says_nothing": 0}
	probs[choice] = conf
	for k := range probs {
		if k != choice {
			probs[k] = (1 - conf) / 2
		}
	}
	return map[string]any{"type": "choice", "choice": choice, "probabilities": probs, "confidence": conf}
}

// fakeGreetings are messages the fake scope check calls small talk.
var fakeGreetings = map[string]bool{"hi": true, "hello": true, "hey": true, "thanks": true, "thank you": true, "good morning": true}

// fakeScope answers the scope questions about a message.
func fakeScope(id, message string) float64 {
	up := strings.ToUpper(message)
	bare := strings.Trim(strings.ToLower(strings.TrimSpace(message)), "!.? ")
	switch id {
	case "small_talk":
		if strings.Contains(up, "SMALLTALK") || fakeGreetings[bare] {
			return 0.96
		}
		return 0.02
	case "in_scope":
		if strings.Contains(up, "OFFTOPIC") {
			return 0.04
		}
		return 0.93
	}
	return FakeSafeScore
}
