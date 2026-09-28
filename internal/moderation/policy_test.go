package moderation

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/authz"
)

func TestDefaultPolicies(t *testing.T) {
	pub := DefaultPolicy(authz.AudiencePublic)
	if !pub.FailClosed || pub.OutputMode != ModeBuffer || !pub.Active(StageInput) || !pub.Active(StageOutput) {
		t.Errorf("public = %+v", pub)
	}
	for _, c := range Categories {
		if r := pub.Categories[c]; r.Input != (Rule{ActionBlock, 0.5}) || r.Output != (Rule{ActionBlock, 0.5}) {
			t.Errorf("public %s = %+v", c, r)
		}
	}
	for _, a := range []string{authz.AudienceTeam, authz.AudienceAllAuthenticated} {
		p := DefaultPolicy(a)
		if p.FailClosed || p.OutputMode != ModeStreamRetract || p.Active(StageInput) || p.Active(StageOutput) {
			t.Errorf("%s = %+v", a, p)
		}
	}
	if len(pub.Validate(authz.AudiencePublic)) != 0 {
		t.Error("public defaults invalid")
	}
}

func TestPolicyValidation(t *testing.T) {
	p := DefaultPolicy(authz.AudiencePublic)
	p.FailClosed = false
	p.OutputMode = "later"
	p.Notice = ""
	p.Categories[Violence] = CategoryRules{Input: Rule{"warn", 0.5}, Output: Rule{ActionBlock, 1.2}}
	p.Categories["spam"] = CategoryRules{}
	var fields []string
	for _, pr := range p.Validate(authz.AudiencePublic) {
		fields = append(fields, pr.Field)
	}
	got := strings.Join(fields, ",")
	for _, f := range []string{"failClosed", "outputMode", "notice", "categories.violence.input.action", "categories.violence.output.threshold", "categories.spam"} {
		if !strings.Contains(got, f) {
			t.Errorf("missing %s in %s", f, got)
		}
	}
	team := DefaultPolicy(authz.AudienceTeam)
	if probs := team.Validate(authz.AudienceTeam); len(probs) != 0 {
		t.Errorf("team fail-open is allowed: %v", probs)
	}
}

// TestMergeIsStricterOnly: an override can lower thresholds, strengthen
// actions and buffer, but never weaken the platform policy.
func TestMergeIsStricterOnly(t *testing.T) {
	plat := DefaultPolicy(authz.AudienceTeam)
	plat.Categories[Violence] = CategoryRules{Input: Rule{ActionFlag, 0.6}, Output: Rule{ActionBlock, 0.5}}
	plat.Categories[Illicit] = CategoryRules{Input: Rule{ActionBlock, 0.4}, Output: Rule{ActionOff, 0.5}}
	o := Override{OutputMode: ModeBuffer, Categories: map[string]CategoryRules{
		Violence: {Input: Rule{ActionBlock, 0.8}, Output: Rule{ActionFlag, 0.9}}, // stronger input action; weaker output
		Illicit:  {Input: Rule{ActionOff, 0.1}, Output: Rule{ActionFlag, 0.3}},   // off keeps; output turned on
		SelfHarm: {Input: Rule{ActionBlock, 0.2}},                                // new rule
	}}
	m := plat.Merge(o)
	check := func(c, stage string, want Rule) {
		t.Helper()
		if got := m.Categories[c].stage(stage); got != want {
			t.Errorf("%s %s = %+v, want %+v", c, stage, got, want)
		}
	}
	check(Violence, StageInput, Rule{ActionBlock, 0.6})
	check(Violence, StageOutput, Rule{ActionBlock, 0.5})
	check(Illicit, StageInput, Rule{ActionBlock, 0.4})
	check(Illicit, StageOutput, Rule{ActionFlag, 0.3})
	check(SelfHarm, StageInput, Rule{ActionBlock, 0.2})
	if m.OutputMode != ModeBuffer {
		t.Error("buffer override ignored")
	}
	// A stream override never un-buffers.
	pub := DefaultPolicy(authz.AudiencePublic).Merge(Override{OutputMode: ModeStreamRetract})
	if pub.OutputMode != ModeBuffer {
		t.Error("override weakened buffering")
	}
	// The platform policy is not modified.
	if plat.Categories[Violence].Input.Action != ActionFlag || plat.OutputMode != ModeStreamRetract {
		t.Error("merge changed the platform policy")
	}
}

func TestEvaluate(t *testing.T) {
	p := DefaultPolicy(authz.AudienceTeam)
	p.Categories[Violence] = CategoryRules{Input: Rule{ActionBlock, 0.5}}
	p.Categories[Illicit] = CategoryRules{Input: Rule{ActionFlag, 0.3}}
	p.Categories[PersonalData] = CategoryRules{Input: Rule{ActionBlock, 0.1}}
	r := newResult("test", true)
	r.set(Violence, 0.4)
	r.set(Illicit, 0.35)
	d := p.Evaluate(StageInput, r)
	if d.Outcome != DecisionFlag || d.Blocked || d.TopCategory != Illicit || len(d.Categories) != 1 {
		t.Errorf("flag = %+v", d)
	}
	r.set(Violence, 0.95)
	d = p.Evaluate(StageInput, r)
	if d.Outcome != DecisionBlock || !d.Blocked || d.TopCategory != Violence || d.Score != 0.95 || strings.Join(d.Categories, ",") != "violence,illicit" {
		t.Errorf("block = %+v", d)
	}
	// Unsupported categories cannot trigger (personal_data was never set).
	if d.Result.Scores[PersonalData].Supported {
		t.Fatal("setup")
	}
	// Output rules are separate.
	if d := p.Evaluate(StageOutput, r); d.Outcome != DecisionPass || d.TopCategory != "" {
		t.Errorf("output = %+v", d)
	}
	rec, _ := json.Marshal(d.Record())
	if !strings.Contains(string(rec), `"decision":"block"`) || !strings.Contains(string(rec), `"topCategory":"violence"`) {
		t.Errorf("record = %s", rec)
	}
}

func TestOverrideJSON(t *testing.T) {
	var o Override
	if err := json.Unmarshal([]byte(`"off"`), &o); err != nil || !o.IsZero() {
		t.Errorf("off = %+v %v", o, err)
	}
	if err := json.Unmarshal([]byte(`"on"`), &o); err == nil {
		t.Error("on accepted")
	}
	if err := json.Unmarshal([]byte(`{"categories":{"violence":{"input":{"action":"block","threshold":0.3}}},"outputMode":"buffer"}`), &o); err != nil || o.IsZero() {
		t.Fatalf("object = %+v %v", o, err)
	}
	n := o.Normalize()
	if n.Categories[Violence].Output.Action != ActionOff || n.Categories[Violence].Input.Threshold != 0.3 {
		t.Errorf("normalized = %+v", n)
	}
	// Rules that change nothing are dropped, so equal overrides compare equal.
	z := Override{Categories: map[string]CategoryRules{Sexual: {}}}.Normalize()
	if len(z.Categories) != 0 || !z.IsZero() {
		t.Errorf("empty rule kept: %+v", z)
	}
	if probs := (Override{OutputMode: ModeStreamRetract, Categories: map[string]CategoryRules{"x": {}}}).Validate(); len(probs) != 2 {
		t.Errorf("problems = %v", probs)
	}
}

func TestDecodePolicyOverDefaults(t *testing.T) {
	p := DecodePolicy(authz.AudiencePublic, json.RawMessage(`{"categories":{"violence":{"input":{"action":"flag","threshold":0.7},"output":{"action":"block","threshold":0.5}},"bogus":{}},"outputMode":"stream_retract","failClosed":true}`))
	if p.Categories[Violence].Input.Action != ActionFlag || p.OutputMode != ModeStreamRetract || p.Notice != DefaultNotice ||
		p.Categories[Sexual].Input.Action != ActionBlock || len(p.Categories) != len(Categories) {
		t.Errorf("decoded = %+v", p)
	}
}

func TestClassifierPromptIsVersioned(t *testing.T) {
	pr := ClassifierPrompt()
	for _, want := range []string{"grounded-moderation-classifier v1", `"prompt_injection": 0.0`, "- personal_data: "} {
		if !strings.Contains(pr, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
	if DefinitionsVersion() != "v1" {
		t.Error("version")
	}
}

// TestSupportAndSeverity: the support action (self_harm only) wins over a
// block and replaces the text; a severity score at the threshold blocks;
// agents can only lower the severity threshold (docs/systemone.md §1).
func TestSupportAndSeverity(t *testing.T) {
	p := DefaultPolicy("team")
	p.Categories[SelfHarm] = CategoryRules{Input: Rule{ActionSupport, 0.5}, Output: Rule{ActionBlock, 0.5}}
	p.Categories[Violence] = CategoryRules{Input: Rule{ActionBlock, 0.5}, Output: Rule{ActionOff, 0.5}}
	res := newResult("system_one", true)
	res.set(SelfHarm, 0.9)
	res.set(Violence, 0.95)
	d := p.Evaluate(StageInput, res)
	if d.Outcome != DecisionSupport || !d.Blocked || d.TopCategory != SelfHarm {
		t.Errorf("support = %+v", d)
	}
	if d := p.Evaluate(StageOutput, res); d.Outcome != DecisionBlock {
		t.Errorf("output self-harm block = %+v", d)
	}
	if probs := p.Validate("team"); len(probs) != 0 {
		t.Errorf("valid policy: %v", probs)
	}
	bad := DefaultPolicy("team")
	bad.Categories[Violence] = CategoryRules{Input: Rule{ActionSupport, 0.5}, Output: Rule{ActionOff, 0.5}}
	two := 5.0
	bad.SeverityBlock, bad.SupportMessage = &two, ""
	if probs := bad.Validate("team"); len(probs) != 3 {
		t.Errorf("problems = %v", probs)
	}

	// Severity: blocks at the threshold even when no category triggers.
	sev := DefaultPolicy("team")
	thr := 2.0
	sev.SeverityBlock = &thr
	if !sev.Active(StageInput) || !sev.Active(StageOutput) {
		t.Error("a severity threshold moderates both stages")
	}
	low := newResult("system_one", true)
	s := 2.4
	low.Severity = &s
	if d := sev.Evaluate(StageInput, low); d.Outcome != DecisionBlock || !d.SeverityBlocked || d.Record().Severity == nil || *d.Record().Severity != 2.4 {
		t.Errorf("severity block = %+v %+v", d, d.Record())
	}
	s = 1.2
	if d := sev.Evaluate(StageInput, low); d.Outcome != DecisionPass {
		t.Errorf("mild = %+v", d)
	}
	lower, higher := 1.0, 3.0
	if m := sev.Merge(Override{SeverityBlock: &lower}); *m.SeverityBlock != 1 {
		t.Errorf("agent lowers = %v", *m.SeverityBlock)
	}
	if m := sev.Merge(Override{SeverityBlock: &higher}); *m.SeverityBlock != 2 {
		t.Errorf("agent cannot raise = %v", *m.SeverityBlock)
	}
	if m := DefaultPolicy("team").Merge(Override{SeverityBlock: &lower}); m.SeverityBlock == nil || *m.SeverityBlock != 1 {
		t.Error("agent turns severity on")
	}
	// An agent may turn a platform block into support, never the reverse.
	o := Override{Categories: map[string]CategoryRules{SelfHarm: {Input: Rule{ActionBlock, 0.9}, Output: Rule{ActionSupport, 0.4}}}}
	m := p.Merge(o)
	if m.Categories[SelfHarm].Input.Action != ActionSupport || m.Categories[SelfHarm].Output != (Rule{ActionSupport, 0.4}) {
		t.Errorf("merged = %+v", m.Categories[SelfHarm])
	}
	// The stored form keeps the support message and threshold.
	raw, _ := json.Marshal(sev)
	if back := DecodePolicy("team", raw); back.SeverityBlock == nil || back.SupportMessage != DefaultSupportMessage {
		t.Errorf("decoded = %+v", back)
	}
}
