package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/testutil"
)

// fakeProvider builds an adapter for a model on the fake gateway.
func fakeProvider(t *testing.T, p *testutil.FakeProxy, kind, family, upstream string) Provider {
	t.Helper()
	m := dbgen.Model{Kind: catalog.KindModeration, UpstreamModel: upstream, ModerationProvider: &kind, Compat: json.RawMessage(`{}`)}
	if kind == catalog.ModerationSystemOne { // a SystemOne model (ADR-0020)
		m.Kind, m.ModerationProvider = catalog.KindSystemOne, nil
	}
	if family != "" {
		m.ModerationFamily = &family
	}
	prov, err := NewProvider(catalog.ModerationTarget{Model: m, Client: gateway.New(p.BaseURL(), p.APIKey, 5*time.Second)})
	if err != nil {
		t.Fatal(err)
	}
	return prov
}

func score(t *testing.T, r Result, c string) float64 {
	t.Helper()
	s := r.Scores[c]
	if !s.Supported {
		t.Fatalf("%s unsupported in %+v", c, r.Scores)
	}
	return s.Probability
}

// TestAdaptersAgainstFakeGateway runs every provider kind: the harmful
// sample and a marked answer score high, the benign sample low.
func TestAdaptersAgainstFakeGateway(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	cases := []struct {
		name, kind, family, model string
		calibrated                bool
		unsupported               []string
	}{
		{"moderations", catalog.ModerationEndpoint, "", "omni-moderation-latest", true, []string{PersonalData, PromptInjection}},
		{"llama guard", catalog.ModerationGuardrail, catalog.FamilyLlamaGuard, "fake-llama-guard", true, []string{PromptInjection}},
		{"granite", catalog.ModerationGuardrail, catalog.FamilyGraniteGuardian, "fake-granite-guardian", true, nil},
		{"shieldgemma", catalog.ModerationGuardrail, catalog.FamilyShieldGemma, "fake-shieldgemma", true, []string{SexualMinors, PersonalData, PromptInjection}},
		{"classifier", catalog.ModerationClassifier, "", "test-chat", false, nil},
		{"system one", catalog.ModerationSystemOne, "", "jev-latest", true, nil},
	}
	ctx := context.Background()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			prov := fakeProvider(t, p, tc.kind, tc.family, tc.model)
			bad, err := prov.Check(ctx, Input{Stage: StageInput, Text: defs.Samples.Harmful})
			if err != nil {
				t.Fatal(err)
			}
			if v := score(t, bad, Violence); v < 0.9 {
				t.Errorf("harmful violence = %v", v)
			}
			if bad.Calibrated != tc.calibrated {
				t.Errorf("calibrated = %v", bad.Calibrated)
			}
			for _, c := range tc.unsupported {
				if bad.Scores[c].Supported {
					t.Errorf("%s should be unsupported", c)
				}
			}
			good, err := prov.Check(ctx, Input{Stage: StageInput, Text: defs.Samples.Benign})
			if err != nil {
				t.Fatal(err)
			}
			if top, v := good.Top(); v > 0.1 {
				t.Errorf("benign top %s = %v", top, v)
			}
			// Output checks judge the answer, not the question.
			out, err := prov.Check(ctx, Input{Stage: StageOutput, Question: "What happened?", Text: "Here is UNSAFE-VIOLENCE content."})
			if err != nil {
				t.Fatal(err)
			}
			if v := score(t, out, Violence); v < 0.9 {
				t.Errorf("answer violence = %v", v)
			}
			q, err := prov.Check(ctx, Input{Stage: StageOutput, Question: "UNSAFE-VIOLENCE?", Text: "A calm answer."})
			if err != nil {
				t.Fatal(err)
			}
			if v := score(t, q, Violence); v > 0.1 {
				t.Errorf("question leaked into the output check: %v", v)
			}
		})
	}
}

func TestProviderBackpressureAndFailures(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	prov := fakeProvider(t, p, catalog.ModerationSystemOne, "", "jev-latest")
	for _, status := range []int{429, 529} {
		p.FailModerationWith(status)
		_, err := prov.Check(context.Background(), Input{Stage: StageInput, Text: "hi"})
		var ge *gateway.Error
		if !errors.As(err, &ge) || !ge.Backpressure() {
			t.Errorf("%d: err = %v, want backpressure", status, err)
		}
	}
	p.FailModerationWith(500)
	if _, err := fakeProvider(t, p, catalog.ModerationClassifier, "", "test-chat").Check(context.Background(), Input{Text: "hi"}); err == nil {
		t.Error("classifier ignored a 500")
	}
}

func TestClassifierRetriesInvalidJSONOnce(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	prov := fakeProvider(t, p, catalog.ModerationClassifier, "", "test-chat")
	before := p.ModerationRequests()
	res, err := prov.Check(context.Background(), Input{Stage: StageInput, Text: "FAKE-INVALID-JSON UNSAFE-PII"})
	if err != nil {
		t.Fatal(err)
	}
	if n := p.ModerationRequests() - before; n != 2 {
		t.Errorf("requests = %d, want 2 (one retry)", n)
	}
	if score(t, res, PersonalData) < 0.9 {
		t.Errorf("scores = %+v", res.Scores)
	}
}

func TestParseClassifier(t *testing.T) {
	all := `"violence":0.9,"self_harm":0,"sexual":0,"sexual_minors":0,"harassment_hate":0,"illicit":0.2,"personal_data":0,"prompt_injection":0`
	for text, ok := range map[string]bool{
		"{" + all + "}":                                           true,
		"```json\n{" + all + "}\n```":                             true,
		"Sure: {" + all + `, "reason": "x"}` + ".":                true,  // extra keys ignored
		"{" + strings.Replace(all, `"illicit":0.2,`, "", 1) + "}": false, // missing
		"{" + strings.Replace(all, `0.9`, `1.5`, 1) + "}":         false, // out of range
		"{" + strings.Replace(all, `0.9`, `"high"`, 1) + "}":      false, // not a number
		"no json here": false,
		"{":            false,
	} {
		res, err := parseClassifier(text)
		if (err == nil) != ok {
			t.Errorf("%q: err = %v", text, err)
		}
		if ok && (res.Scores[Violence].Probability != 0.9 || res.Calibrated) {
			t.Errorf("%q: %+v", text, res)
		}
	}
}

func tokens(label string, lp float64, alts map[string]float64) []tokenProb {
	t := tokenProb{Token: label, Logprob: lp}
	for tok, l := range alts {
		t.Top = append(t.Top, struct {
			Token   string  `json:"token"`
			Logprob float64 `json:"logprob"`
		}{tok, l})
	}
	return []tokenProb{t}
}

func TestParseLlamaGuard(t *testing.T) {
	res, err := parseLlamaGuard(chatReply{Text: "unsafe\nS1,S10"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Calibrated || res.Scores[Violence].Probability != 1 || res.Scores[HarassmentHate].Probability != 1 ||
		res.Scores[SelfHarm].Probability != 0 || res.Scores[PromptInjection].Supported {
		t.Errorf("unsafe S1,S10 = %+v", res)
	}
	res, _ = parseLlamaGuard(chatReply{Text: " safe \n"})
	if top, v := res.Top(); v != 0 {
		t.Errorf("safe: %s = %v", top, v)
	}
	// Unknown codes are ignored; spaces and case are tolerated.
	res, _ = parseLlamaGuard(chatReply{Text: "unsafe\n s11 , S99"})
	if res.Scores[SelfHarm].Probability != 1 || res.Scores[Violence].Probability != 0 {
		t.Errorf("s11 = %+v", res.Scores)
	}
	// Log-probabilities make it calibrated.
	res, _ = parseLlamaGuard(chatReply{Text: "unsafe\nS2", Tokens: tokens("unsafe", math.Log(0.8), map[string]float64{"unsafe": math.Log(0.8), "safe": math.Log(0.2)})})
	if !res.Calibrated || math.Abs(res.Scores[Illicit].Probability-0.8) > 1e-9 {
		t.Errorf("logprobs = %+v", res)
	}
	res, _ = parseLlamaGuard(chatReply{Text: "safe", Tokens: tokens("Ġsafe", math.Log(0.9), map[string]float64{"Ġsafe": math.Log(0.9), "Ġunsafe": math.Log(0.1)})})
	if math.Abs(res.Scores[Violence].Probability-0.1) > 1e-9 {
		t.Errorf("safe with logprobs = %+v", res.Scores)
	}
	if _, err := parseLlamaGuard(chatReply{Text: "I cannot help"}); err == nil {
		t.Error("garbage accepted")
	}
}

func TestParseGraniteAndShieldGemma(t *testing.T) {
	for text, want := range map[string]float64{"Yes": 1, "No": 0, "<score> yes </score>": 1, "<think>maybe yes</think>\n<score> no </score>": 0, "yes.": 1} {
		p, cal, err := parseGranite(chatReply{Text: text})
		if err != nil || p != want || cal {
			t.Errorf("granite %q = %v %v %v", text, p, cal, err)
		}
	}
	if _, _, err := parseGranite(chatReply{Text: "<score> maybe </score>"}); err == nil {
		t.Error("granite accepted maybe")
	}
	p, cal, _ := parseGranite(chatReply{Text: "<score> yes </score>", Tokens: append([]tokenProb{{Token: "<score>"}},
		tokens(" yes", math.Log(0.7), map[string]float64{" yes": math.Log(0.7), " no": math.Log(0.3)})...)})
	if !cal || math.Abs(p-0.7) > 1e-9 {
		t.Errorf("granite logprobs = %v %v", p, cal)
	}
	p, cal, _ = parseShieldGemma(chatReply{Text: "Yes", Tokens: tokens("Yes", math.Log(0.6), map[string]float64{"Yes": math.Log(0.6), "No": math.Log(0.3)})})
	if !cal || math.Abs(p-0.6/0.9) > 1e-9 {
		t.Errorf("shieldgemma P(yes) = %v, want softmax over Yes/No", p)
	}
	if p, cal, err := parseShieldGemma(chatReply{Text: "No, because"}); err != nil || p != 0 || cal {
		t.Errorf("shieldgemma no = %v %v %v", p, cal, err)
	}
	if _, _, err := parseShieldGemma(chatReply{Text: ""}); err == nil {
		t.Error("empty accepted")
	}
}

func TestParseModerationsAndSystemOnePath(t *testing.T) {
	v := 0.4
	res, err := parseModerations(map[string]bool{"violence": true}, map[string]*float64{"violence": &v, "illicit/violent": ptr(0.9)})
	if err != nil || res.Scores[Violence].Probability != 0.9 || res.Scores[Illicit].Probability != 0.9 || !res.Calibrated || res.Scores[PersonalData].Supported {
		t.Errorf("scores = %+v %v", res, err)
	}
	// Flags only: 0/1, not calibrated; older endpoints without illicit.
	res, _ = parseModerations(map[string]bool{"sexual": true, "hate": false}, nil)
	if res.Calibrated || res.Scores[Sexual].Probability != 1 || res.Scores[Illicit].Supported {
		t.Errorf("flags = %+v", res)
	}
	if _, err := parseModerations(nil, nil); err == nil {
		t.Error("empty result accepted")
	}
	if systemone.Path("https://api.example.edu") != "/v1/systemone" || systemone.Path("https://judge.example.edu/v1/") != "/systemone" {
		t.Error("systemone path")
	}
}

func ptr(f float64) *float64 { return &f }

func TestSystemOneRejectsMissingAnswers(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"model":"jev","answers":{"violence":{"type":"noul","noul":0.1}}}`))
	}))
	defer srv.Close()
	prov := &systemOne{cl: systemone.NewClient(gateway.New(srv.URL, "", time.Second), "jev-latest", uuid.Nil, uuid.New(), 0)}
	if _, err := prov.Check(context.Background(), Input{Text: "x"}); err == nil {
		t.Error("missing answers accepted")
	}
}

func TestLogprobsFallBackWhenRejected(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["logprobs"] == true {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error":{"message":"logprobs not supported"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"unsafe\nS1"}}]}`))
	}))
	defer srv.Close()
	c := chatCaller{cl: gateway.New(srv.URL, "", time.Second), model: "lg", logprobs: true}
	res, err := (&llamaGuard{chat: c}).Check(context.Background(), Input{Text: "x"})
	if err != nil || calls != 2 || res.Calibrated || res.Scores[Violence].Probability != 1 {
		t.Errorf("res = %+v err = %v calls = %d", res, err, calls)
	}
}
