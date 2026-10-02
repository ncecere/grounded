package systemone

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/gateway"
)

// server answers every question: noul 0.8, score 1.5, choice the first
// option given in want.
func server(t *testing.T, handle func(w http.ResponseWriter, body map[string]any)) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/systemone" || r.Header.Get("Authorization") != "Bearer k" {
			w.WriteHeader(404)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		handle(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func answerAll(w http.ResponseWriter, body map[string]any) {
	answers := map[string]any{}
	for id, q := range body["questions"].(map[string]any) {
		switch q.(map[string]any)["type"] {
		case "noul":
			answers[id] = map[string]any{"type": "noul", "noul": 0.8}
		case "score":
			answers[id] = map[string]any{"type": "score", "score": 1.5, "probabilities": map[string]float64{"1": 0.5, "2": 0.5}, "confidence": 0.5}
		case "choice":
			answers[id] = map[string]any{"type": "choice", "choice": "a", "probabilities": map[string]float64{"a": 1}, "confidence": 1}
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1", "answers": answers, "usage": map[string]int{"input_tokens": 42}})
}

func newTestClient(url string, n int) *Client {
	return NewClient(gateway.New(url, "k", 5*time.Second), "jev-latest", uuid.New(), uuid.New(), n)
}

func TestAskSendsTypedQuestionsAndMeters(t *testing.T) {
	var got map[string]any
	srv := server(t, func(w http.ResponseWriter, body map[string]any) { got = body; answerAll(w, body) })
	cl := newTestClient(srv.URL, 2)
	m := &Meter{}
	qs := map[string]Question{
		"yes":   Noul("Is it urgent?", "Time-sensitive", ""),
		"level": Score("How angry?", "Calm", "Annoyed", "Furious"),
		"team":  Choice("Which team?", map[string]string{"a": "billing", "b": "tech"}),
	}
	res, err := cl.Ask(WithMeter(context.Background(), m), Call{Feature: FeatureJudging}, map[string]string{"query": "q"}, qs)
	if err != nil {
		t.Fatal(err)
	}
	if got["model"] != "jev-latest" || got["state"].(map[string]any)["query"] != "q" {
		t.Errorf("request = %v", got)
	}
	yes := got["questions"].(map[string]any)["yes"].(map[string]any)
	if yes["type"] != "noul" || yes["criteria"].(map[string]any)["true"] != "Time-sensitive" {
		t.Errorf("noul question = %v", yes)
	}
	if lv := got["questions"].(map[string]any)["level"].(map[string]any)["criteria"].([]any); len(lv) != 3 {
		t.Errorf("score levels = %v", lv)
	}
	if res.Noul("yes") != 0.8 || res.Score("level") != 1.5 || res.Answers["team"].Choice != "a" {
		t.Errorf("answers = %+v", res.Answers)
	}
	e := m.Entries()
	if len(e) != 1 || e[0].Feature != FeatureJudging || e[0].InputTokens != 42 || e[0].Requests != 1 || e[0].ModelID != cl.ModelID {
		t.Errorf("meter = %+v", e)
	}
}

func TestValidateRejectsBadAnswers(t *testing.T) {
	qs := map[string]Question{"a": Noul("?", "", ""), "s": Score("?", "x", "y")}
	one, two, bad := 1.0000001, 0.5, 1.7
	cases := map[string]Response{
		"missing":    {Answers: map[string]Answer{"a": {Type: "noul", Noul: &two}}},
		"wrong type": {Answers: map[string]Answer{"a": {Type: "score", Score: &two}, "s": {Type: "score", Score: &two}}},
		"range":      {Answers: map[string]Answer{"a": {Type: "noul", Noul: &bad}, "s": {Type: "score", Score: &two}}},
		"score":      {Answers: map[string]Answer{"a": {Type: "noul", Noul: &two}, "s": {Type: "score", Score: &bad}}},
		"none":       {},
	}
	for name, res := range cases {
		if err := Validate(qs, &res); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	ok := Response{Answers: map[string]Answer{"a": {Type: "noul", Noul: &one}, "s": {Type: "score", Score: &two}}}
	if err := Validate(qs, &ok); err != nil || ok.Noul("a") != 1 {
		t.Errorf("rounding not clamped: %v %v", err, ok.Noul("a"))
	}
	c := map[string]Question{"c": Choice("?", map[string]string{"x": ""})}
	if err := Validate(c, &Response{Answers: map[string]Answer{"c": {Type: "choice", Choice: "z"}}}); err == nil {
		t.Error("unknown option accepted")
	}
}

func TestBackpressureAndTimeout(t *testing.T) {
	var calls atomic.Int32
	srv := server(t, func(w http.ResponseWriter, body map[string]any) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "3")
			w.WriteHeader(529)
			return
		}
		time.Sleep(300 * time.Millisecond)
		answerAll(w, body)
	})
	var backoff time.Duration
	cl := newTestClient(srv.URL, 1)
	cl.GW.Limiter = limiterFunc(func(d time.Duration) { backoff = d })
	qs := map[string]Question{"a": Noul("?", "", "")}
	_, err := cl.Ask(context.Background(), Call{}, "x", qs)
	var ge *gateway.Error
	if !errors.As(err, &ge) || !ge.Backpressure() || backoff != 3*time.Second {
		t.Fatalf("529 = %v, backoff %v", err, backoff)
	}
	_, err = cl.Ask(context.Background(), Call{Timeout: 50 * time.Millisecond}, "x", qs)
	if !IsTimeout(err) {
		t.Errorf("slow answer = %v, want a timeout", err)
	}
}

type limiterFunc func(time.Duration)

func (f limiterFunc) Wait(context.Context) error                 { return nil }
func (f limiterFunc) Backoff(_ context.Context, d time.Duration) { f(d) }

func TestConcurrencyCapPerConnection(t *testing.T) {
	var cur, peak atomic.Int32
	srv := server(t, func(w http.ResponseWriter, body map[string]any) {
		n := cur.Add(1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		time.Sleep(40 * time.Millisecond)
		cur.Add(-1)
		answerAll(w, body)
	})
	conn := uuid.New()
	a := NewClient(gateway.New(srv.URL, "k", time.Second), "m", uuid.New(), conn, 2)
	b := NewClient(gateway.New(srv.URL, "k", time.Second), "m", uuid.New(), conn, 2) // same connection, same cap
	var wg sync.WaitGroup
	for i := range 8 {
		cl := a
		if i%2 == 1 {
			cl = b
		}
		wg.Go(func() {
			if _, err := cl.Ask(context.Background(), Call{}, "x", map[string]Question{"a": Noul("?", "", "")}); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if p := peak.Load(); p != 2 {
		t.Errorf("peak concurrency = %d, want 2", p)
	}
	// Waiting for a slot is bounded by the caller's context.
	hold, _ := a.slots.acquire(context.Background(), Interactive)
	hold2, _ := a.slots.acquire(context.Background(), Interactive)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := a.Ask(ctx, Call{}, "x", map[string]Question{"a": Noul("?", "", "")}); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("full cap = %v", err)
	}
	hold()
	hold2()
}

func TestRouteTable(t *testing.T) {
	d := DefaultThresholds
	cases := []struct {
		s             Scores
		route, reason string
	}{
		{Scores{Relevant: 0.9, Evidence: 0.9, Injection: 0.95, Contradicts: 0.9}, RouteDropped, ReasonInjection},
		{Scores{Relevant: 0.44, Evidence: 0.9, Contradicts: 0.9}, RouteDropped, ReasonIrrelevant},
		{Scores{Relevant: 0.5, Evidence: 0.2, Contradicts: 0.7}, RouteConflicting, ""},
		{Scores{Relevant: 0.45, Evidence: 0.55}, RouteEvidence, ""},
		{Scores{Relevant: 0.9, Evidence: 0.29}, RouteDropped, ReasonNotUsable},
		{Scores{Relevant: 0.9, Evidence: 0.9, Injection: 0.69}, RouteEvidence, ""},
	}
	for i, c := range cases {
		if r, why := Route(c.s, d); r != c.route || why != c.reason {
			t.Errorf("%d: %+v routed %s/%s, want %s/%s", i, c.s, r, why, c.route, c.reason)
		}
	}
}

func TestRankKeepsSkippedAtTheirPosition(t *testing.T) {
	js := []Judgment{
		{Scores: Scores{Relevant: 0.5}, Route: RouteEvidence},
		{Skipped: true, Route: RouteEvidence},
		{Scores: Scores{Relevant: 0.9}, Route: RouteEvidence},
		{Scores: Scores{Relevant: 0.99}, Route: RouteDropped},
		{Scores: Scores{Relevant: 0.7}, Route: RouteConflicting},
	}
	if got := Rank(js, func(j Judgment) bool { return j.Route == RouteEvidence }); !equal(got, []int{2, 1, 0}) {
		t.Errorf("evidence order = %v", got)
	}
	if got := Rank(js, Kept); !equal(got, []int{2, 1, 4, 0}) {
		t.Errorf("kept order = %v", got)
	}
}

func equal(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestJudgeModes(t *testing.T) {
	var requests atomic.Int32
	srv := server(t, func(w http.ResponseWriter, body map[string]any) {
		requests.Add(1)
		answers := map[string]any{}
		for id := range body["questions"].(map[string]any) {
			v := 0.9
			if strings.HasPrefix(id, "p2_") && strings.HasSuffix(id, "relevant") || id == "relevant" && strings.Contains(body["state"].(map[string]any)["passage"].(map[string]any)["text"].(string), "off topic") {
				v = 0.1
			}
			if strings.HasSuffix(id, QInjection) || strings.HasSuffix(id, QContradicts) {
				v = 0.05
			}
			answers[id] = map[string]any{"type": "noul", "noul": v}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1", "answers": answers})
	})
	cl := newTestClient(srv.URL, 4)
	ps := []Passage{{Title: "A", Text: "about fees"}, {Title: "B", Text: "off topic"}, {Title: "C", Text: "more fees"}}
	o := JudgeOptions{Mode: ModePerPassage, Timeout: time.Second, Thresholds: DefaultThresholds}
	js, st := cl.Judge(context.Background(), "fees?", ps, o)
	if st.Requests != 3 || requests.Load() != 3 || js[1].Route != RouteDropped || js[1].Reason != ReasonIrrelevant || js[0].Route != RouteEvidence {
		t.Fatalf("per passage = %+v %+v", js, st)
	}
	o.Mode = ModeBatched
	js, st = cl.Judge(context.Background(), "fees?", ps, o)
	if st.Requests != 1 || requests.Load() != 4 || js[1].Route != RouteDropped || js[2].Route != RouteEvidence {
		t.Fatalf("batched = %+v %+v", js, st)
	}
	state, qs := BatchedRequest("q", ps)
	if len(qs) != 12 || !strings.Contains(qs["p3_evidence"].Instructions, "`passages.p3`") || len(state.(map[string]any)["passages"].(map[string]Passage)) != 3 {
		t.Errorf("batched request = %v %v", state, qs)
	}
	// Fail-open: a failed request marks its passages skipped, kept as evidence.
	srv.Close()
	js, _ = cl.Judge(context.Background(), "fees?", ps, o)
	if !js[0].Skipped || js[0].Route != RouteEvidence || js[0].Err == nil {
		t.Errorf("failed judging = %+v", js[0])
	}
}

func TestSettingsValidateAndOverride(t *testing.T) {
	s := DefaultSettings()
	if len(s.Validate()) != 0 || s.Judging.Enabled || s.Judging.Candidates != DefaultCandidates || s.Judging.Mode != ModePerPassage {
		t.Fatalf("defaults = %+v %v", s, s.Validate())
	}
	s.Judging.Candidates, s.Judging.Mode, s.Judging.TimeoutMs, s.Judging.Thresholds.Evidence = 0, "x", 10, 1.2
	if p := s.Validate(); len(p) != 4 {
		t.Errorf("problems = %v", p)
	}
	d := DecodeSettings(json.RawMessage(`{"judging":{"enabled":true,"candidates":8}}`))
	if !d.Judging.Enabled || d.Judging.Candidates != 8 || d.Judging.TimeoutMs != DefaultTimeoutMs || d.Judging.Thresholds != DefaultThresholds {
		t.Errorf("decoded = %+v", d)
	}
	ten := 10
	j := d.Judging.Effective(Override{Judging: OverrideOff, Candidates: &ten})
	if j.Enabled || j.Candidates != 10 {
		t.Errorf("off override = %+v", j)
	}
	if j := DefaultSettings().Judging.Effective(Override{Judging: OverrideOn}); !j.Enabled || j.Candidates != DefaultCandidates {
		t.Errorf("on override = %+v", j)
	}
	fifty1 := 51
	if p := (Override{Judging: "maybe", Candidates: &fifty1}).Validate(); len(p) != 2 {
		t.Errorf("override problems = %v", p)
	}
	if !(Override{}).IsZero() || (Override{Judging: OverrideOn}).IsZero() {
		t.Error("IsZero")
	}
}
