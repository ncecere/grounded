package systemone

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestCheckClaimsVerdictMapping(t *testing.T) {
	srv := server(t, func(w http.ResponseWriter, body map[string]any) {
		state := body["state"].(map[string]any)
		q := body["questions"].(map[string]any)[QRelation].(map[string]any)
		if q["type"] != TypeChoice || len(q["criteria"].(map[string]any)) != 3 || state["section"] == nil {
			w.WriteHeader(400)
			return
		}
		claim := state["claim"].(string)
		a := map[string]any{"type": "choice", "choice": claim, "probabilities": map[string]float64{claim: 0.9}}
		switch claim {
		case "supports":
			a["confidence"] = 0.93
		case "contradicts":
			a["confidence"] = 0.99
		case "fail":
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "m", "answers": map[string]any{QRelation: a}})
	})
	cl := newTestClient(srv.URL, 2)
	pairs := []ClaimPair{{"supports", "s"}, {"contradicts", "s"}, {"says_nothing", "s"}, {"fail", "s"}}
	vs, st := cl.CheckClaims(context.Background(), pairs, time.Second)
	want := []struct {
		v    string
		conf float64
	}{{Verified, 0.93}, {Contradicted, 0.99}, {Unsupported, 0.9}, {Unchecked, 0}}
	for i, w := range want {
		if vs[i].Verification != w.v || vs[i].Confidence != w.conf {
			t.Errorf("pair %d: %+v, want %v %.2f", i, vs[i], w.v, w.conf)
		}
	}
	if st.Requests != 4 || vs[3].Err == nil {
		t.Errorf("stats %+v, err %v", st, vs[3].Err)
	}
	if !vs[0].Confident(0.8) || vs[2].Confident(0.95) || vs[3].Confident(0) {
		t.Error("Confident")
	}
}

func TestCheckStateTrimsTheSource(t *testing.T) {
	st := CheckState(ClaimPair{Claim: "c", Source: strings.Repeat("é", maxPassageRunes+10)})
	if st["claim"] != "c" || len([]rune(st["section"])) != maxPassageRunes {
		t.Errorf("state = %d runes", len([]rune(st["section"])))
	}
}

func TestRouteScope(t *testing.T) {
	s := DefaultScope()
	cases := []struct {
		small, in float64
		want      string
	}{
		{0.9, 0.05, ScopeSmallTalk}, // small talk wins over scope
		{0.1, 0.05, ScopeOutOfScope},
		{0.1, 0.9, ScopeInScope},
		{s.SmallTalk, 0.9, ScopeSmallTalk}, // at the threshold
		{0.1, s.InScope, ScopeInScope},     // at the threshold: in scope
	}
	for _, c := range cases {
		if got := RouteScope(c.small, c.in, s); got != c.want {
			t.Errorf("RouteScope(%v, %v) = %s, want %s", c.small, c.in, got, c.want)
		}
	}
}

func TestCheckScope(t *testing.T) {
	var got map[string]any
	srv := server(t, func(w http.ResponseWriter, body map[string]any) {
		got = body
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "m", "answers": map[string]any{
			QSmallTalk: map[string]any{"type": "noul", "noul": 0.1}, QInScope: map[string]any{"type": "noul", "noul": 0.02}}})
	})
	cl := newTestClient(srv.URL, 2)
	res := cl.CheckScope(context.Background(), ScopeState{Message: "m", Agent: ScopeAgent{Name: "Registrar", Subject: Summary("  Help   students ")}}, DefaultScope())
	if res.Err != nil || res.Decision != ScopeOutOfScope || res.InScope != 0.02 {
		t.Fatalf("result %+v", res)
	}
	agent := got["state"].(map[string]any)["agent"].(map[string]any)
	if agent["name"] != "Registrar" || agent["subject"] != "Help students" || len(got["questions"].(map[string]any)) != 2 {
		t.Errorf("request %v", got)
	}
	down := newTestClient(srv.URL+"/nowhere", 1).CheckScope(context.Background(), ScopeState{Message: "m"}, DefaultScope())
	if down.Decision != ScopeSkipped || down.Err == nil {
		t.Errorf("failed check: %+v", down)
	}
	if s := Summary(strings.Repeat("word ", 400)); len([]rune(s)) > maxSubjectRunes+2 || !strings.HasSuffix(s, "…") {
		t.Errorf("summary %d runes", len([]rune(s)))
	}
}

func TestCheckSettings(t *testing.T) {
	s := DefaultSettings()
	if s.Citations.Enabled || s.Scope.Enabled || s.Citations.Mode != CitationAnnotate || s.Citations.AutoAccept != 0.8 || len(s.Validate()) != 0 {
		t.Fatalf("defaults %+v", s)
	}
	// Settings saved before the checks existed get their defaults.
	old := DecodeSettings(json.RawMessage(`{"judging": {"enabled": true, "candidates": 5, "mode": "per_passage", "timeoutMs": 5000}}`))
	if old.Citations != DefaultCitations() || old.Scope != DefaultScope() || old.Judging.Candidates != 5 {
		t.Errorf("decoded %+v", old)
	}
	s.Citations = Citations{Mode: "loud", AutoAccept: 2, TimeoutMs: 10}
	s.Scope = Scope{SmallTalk: -1, InScope: 0.5, TimeoutMs: 100000}
	fields := map[string]bool{}
	for _, p := range s.Validate() {
		fields[p.Field] = true
	}
	for _, f := range []string{"citations.mode", "citations.autoAccept", "citations.timeoutMs", "scope.smallTalk", "scope.timeoutMs"} {
		if !fields[f] {
			t.Errorf("no problem for %s: %v", f, fields)
		}
	}
	if s.AnyEnabled() {
		t.Error("AnyEnabled with everything off")
	}

	c := DefaultCitations()
	if e := c.Effective(Override{Citations: OverrideOn, CitationMode: CitationEnforce}); !e.Enabled || e.Mode != CitationEnforce {
		t.Errorf("override on/enforce: %+v", e)
	}
	c.Enabled = true
	if e := c.Effective(Override{Citations: OverrideOff}); e.Enabled || e.Mode != CitationAnnotate {
		t.Errorf("override off: %+v", e)
	}
	if e := DefaultScope().Effective(Override{Scope: OverrideOn}); !e.Enabled {
		t.Error("scope override on")
	}
	bad := Override{Citations: "maybe", CitationMode: "loud", Scope: "x"}
	if len(bad.Validate()) != 3 || bad.IsZero() || !(Override{}).IsZero() {
		t.Errorf("override validation %v", bad.Validate())
	}
}
