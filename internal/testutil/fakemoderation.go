// Moderation providers of the fake gateway (ADR-0019): POST /v1/moderations,
// POST /v1/systemone, guardrail chat models (Llama Guard, Granite Guardian,
// ShieldGemma) and the chat classifier prompt, all deterministic.
//
// A text scores 0.97 in a category when it contains the category's marker
// and 0.02 otherwise:
//
//	UNSAFE-VIOLENCE (or "hurt someone")  violence
//	UNSAFE-SELFHARM                      self_harm
//	UNSAFE-SEXUAL                        sexual
//	UNSAFE-MINORS                        sexual_minors
//	UNSAFE-HATE                          harassment_hate
//	UNSAFE-ILLICIT                       illicit
//	UNSAFE-PII                           personal_data
//	UNSAFE-INJECTION                     prompt_injection
//
// BORDERLINE-VIOLENCE and BORDERLINE-ILLICIT score FakeBorderlineScore, the
// kind of middling score an uncalibrated classifier gives benign questions.
//
// Output checks judge only the answer: the assistant message (guardrails),
// the ASSISTANT ANSWER block (classifier) or state.assistant_answer (System
// One).

package testutil

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Fake scores.
const (
	FakeUnsafeScore = 0.97
	FakeSafeScore   = 0.02
	// FakeBorderlineScore is above the default threshold (0.5) but below
	// the default block floor for uncalibrated providers (0.9).
	FakeBorderlineScore = 0.7
)

// fakeMarkers maps markers to categories.
var fakeMarkers = map[string]string{
	"UNSAFE-VIOLENCE": "violence", "HURT SOMEONE": "violence", "UNSAFE-SELFHARM": "self_harm",
	"UNSAFE-SEXUAL": "sexual", "UNSAFE-MINORS": "sexual_minors", "UNSAFE-HATE": "harassment_hate",
	"UNSAFE-ILLICIT": "illicit", "UNSAFE-PII": "personal_data", "UNSAFE-INJECTION": "prompt_injection",
}

var fakeCategories = []string{"violence", "self_harm", "sexual", "sexual_minors", "harassment_hate", "illicit", "personal_data", "prompt_injection"}

// FakeModerationScores are the fake's scores for a text.
func FakeModerationScores(text string) map[string]float64 {
	out := map[string]float64{}
	for _, c := range fakeCategories {
		out[c] = FakeSafeScore
	}
	up := strings.ToUpper(text)
	for marker, c := range map[string]string{"BORDERLINE-VIOLENCE": "violence", "BORDERLINE-ILLICIT": "illicit"} {
		if strings.Contains(up, marker) {
			out[c] = FakeBorderlineScore
		}
	}
	for marker, c := range fakeMarkers {
		if strings.Contains(up, marker) {
			out[c] = FakeUnsafeScore
		}
	}
	return out
}

// Guardrail families served by the fake (model ID -> family).
var fakeGuardModels = map[string]string{
	"fake-llama-guard": "llama_guard", "fake-granite-guardian": "granite_guardian", "fake-shieldgemma": "shieldgemma",
}

// FailModerationWith makes the moderation providers (moderations, System
// One, guardrail models and classifier prompts) answer status (0 restores).
func (p *FakeProxy) FailModerationWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.modFail = status
	p.modFailLater, p.modPassLeft = 0, 0
}

// FailModerationAfter lets the next n moderation calls answer and makes
// the ones after them answer status, for an outage in the middle of an
// answer; FailModerationWith(0) restores.
func (p *FakeProxy) FailModerationAfter(n, status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.modFailLater, p.modPassLeft = status, n
}

// SetModerationDelay delays every moderation answer by d.
func (p *FakeProxy) SetModerationDelay(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.modDelay = d
}

// ModerationRequests counts moderation calls so far.
func (p *FakeProxy) ModerationRequests() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.modCalls
}

// RequestLog returns the "METHOD /path model" log so far.
func (p *FakeProxy) RequestLog() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.Requests...)
}

// admitModeration applies injected failures and delays; false means the
// response was written.
func (p *FakeProxy) admitModeration(w http.ResponseWriter, r *http.Request) bool {
	p.mu.Lock()
	p.modCalls++
	fail, delay := p.modFail, p.modDelay
	if p.modFailLater != 0 {
		if p.modPassLeft > 0 {
			p.modPassLeft--
		} else {
			fail = p.modFailLater
		}
	}
	p.mu.Unlock()
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return false
		}
	}
	if fail != 0 {
		writeErr(w, fail, "moderation failure (test)")
		return false
	}
	return true
}

var fakeOpenAIModeration = map[string]string{
	"violence": "violence", "self-harm": "self_harm", "sexual": "sexual", "sexual/minors": "sexual_minors",
	"harassment": "harassment_hate", "hate": "harassment_hate", "illicit": "illicit",
}

func (p *FakeProxy) moderations(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Model string `json:"model"`
		Input string `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	p.log(r, in.Model)
	if !p.admitModeration(w, r) {
		return
	}
	scores := FakeModerationScores(in.Input)
	flags, cs, flagged := map[string]bool{}, map[string]float64{}, false
	for name, c := range fakeOpenAIModeration {
		cs[name], flags[name] = scores[c], scores[c] >= 0.5
		flagged = flagged || flags[name]
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"id": "modr-fake", "model": in.Model,
		"results": []map[string]any{{"flagged": flagged, "categories": flags, "category_scores": cs}}})
}

// moderationChat answers guardrail models and classifier prompts. ok is
// false for ordinary chat requests.
func (p *FakeProxy) moderationChat(w http.ResponseWriter, r *http.Request, in *fakeChatRequest) (ok bool) {
	family := fakeGuardModels[in.Model]
	classifier := false
	for _, m := range in.Messages {
		if m.Role == "system" && strings.Contains(fakeText(m.Content), "grounded-moderation-classifier") {
			classifier = true
		}
	}
	if family == "" && !classifier {
		return false
	}
	if !p.admitModeration(w, r) {
		return true
	}
	var text string
	var tokens []fakeToken
	switch {
	case classifier:
		text = fakeClassifierReply(in)
	case family == "llama_guard":
		text, tokens = fakeLlamaGuard(in)
	case family == "granite_guardian":
		text, tokens = fakeYesNo(in, fakeGraniteCategories(in), "<score> %s </score>", " yes", " no")
	default:
		text, tokens = fakeYesNo(in, fakeShieldCategories(in), "%s", "Yes", "No")
	}
	msg := map[string]any{"role": "assistant", "content": text}
	choice := map[string]any{"index": 0, "message": msg, "finish_reason": "stop"}
	if in.Logprobs && tokens != nil {
		choice["logprobs"] = map[string]any{"content": tokens}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": fakeCompletionID, "object": "chat.completion", "model": in.Model,
		"choices": []any{choice}, "usage": map[string]int{"prompt_tokens": 50, "completion_tokens": 5, "total_tokens": 55}})
	return true
}

// judgedText is the text a guardrail judges: the last message.
func judgedText(in *fakeChatRequest) string {
	if len(in.Messages) == 0 {
		return ""
	}
	return fakeText(in.Messages[len(in.Messages)-1].Content)
}

type fakeTop struct {
	Token   string  `json:"token"`
	Logprob float64 `json:"logprob"`
}

type fakeToken struct {
	Token   string    `json:"token"`
	Logprob float64   `json:"logprob"`
	Top     []fakeTop `json:"top_logprobs"`
}

// labelToken is a token choosing between pos and neg with P(pos) = p.
func labelToken(pos, neg string, p float64) fakeToken {
	chosen, lp := neg, math.Log(1-p)
	if p >= 0.5 {
		chosen, lp = pos, math.Log(p)
	}
	return fakeToken{Token: chosen, Logprob: lp, Top: []fakeTop{{pos, math.Log(p)}, {neg, math.Log(1 - p)}}}
}

var fakeLlamaCodes = map[string]string{
	"violence": "S1", "illicit": "S2", "sexual_minors": "S4", "personal_data": "S7",
	"harassment_hate": "S10", "self_harm": "S11", "sexual": "S12",
}

func fakeLlamaGuard(in *fakeChatRequest) (string, []fakeToken) {
	scores := FakeModerationScores(judgedText(in))
	var codes []string
	for c, code := range fakeLlamaCodes {
		if scores[c] >= 0.5 {
			codes = append(codes, code)
		}
	}
	if len(codes) == 0 {
		return "safe", []fakeToken{labelToken("unsafe", "safe", FakeSafeScore)}
	}
	sort.Slice(codes, func(i, j int) bool {
		return len(codes[i]) < len(codes[j]) || (len(codes[i]) == len(codes[j]) && codes[i] < codes[j])
	})
	return "unsafe\n" + strings.Join(codes, ","), []fakeToken{labelToken("unsafe", "safe", FakeUnsafeScore), {Token: "\n"}}
}

// templateKwarg reads chat_template_kwargs[key].
func templateKwarg(in *fakeChatRequest, key string) any {
	return in.ChatTemplateKwargs[key]
}

var fakeGraniteBuiltIn = map[string]string{
	"violence": "violence", "sexual_content": "sexual", "unethical_behavior": "illicit", "jailbreak": "prompt_injection",
}

func fakeGraniteCategories(in *fakeChatRequest) []string {
	cfg, _ := templateKwarg(in, "guardian_config").(map[string]any)
	if id, _ := cfg["criteria_id"].(string); id != "" {
		return []string{fakeGraniteBuiltIn[id]}
	}
	name, _ := cfg["risk_name"].(string)
	return []string{name}
}

func fakeShieldCategories(in *fakeChatRequest) []string {
	g, _ := templateKwarg(in, "guideline").(string)
	switch {
	case strings.Contains(g, "Dangerous Content"):
		return []string{"violence", "self_harm", "illicit"}
	case strings.Contains(g, "Harassment"), strings.Contains(g, "Hate Speech"):
		return []string{"harassment_hate"}
	case strings.Contains(g, "Sexually Explicit"):
		return []string{"sexual"}
	}
	return nil
}

// fakeYesNo answers yes when any of the categories scores high.
func fakeYesNo(in *fakeChatRequest, cats []string, format, yes, no string) (string, []fakeToken) {
	scores := FakeModerationScores(judgedText(in))
	p := FakeSafeScore
	for _, c := range cats {
		p = max(p, scores[c])
	}
	word := strings.TrimSpace(no)
	if p >= 0.5 {
		word = strings.TrimSpace(yes)
	}
	var tokens []fakeToken
	if strings.HasPrefix(format, "<score>") {
		tokens = append(tokens, fakeToken{Token: "<score>"})
	}
	tokens = append(tokens, labelToken(yes, no, p))
	return fmt.Sprintf(format, word), tokens
}

// fakeClassifierReply scores the judged block of a classifier prompt (the
// first user message; a retry appends a reminder after it).
func fakeClassifierReply(in *fakeChatRequest) string {
	text := ""
	for _, m := range in.Messages {
		if m.Role == "user" {
			text = fakeText(m.Content)
			break
		}
	}
	if _, ans, ok := strings.Cut(text, "ASSISTANT ANSWER:"); ok {
		text = ans
	}
	if strings.Contains(text, "FAKE-INVALID-JSON") && len(in.Messages) <= 2 {
		return "I think this is fine."
	}
	b, _ := json.Marshal(FakeModerationScores(text))
	return "```json\n" + string(b) + "\n```"
}
