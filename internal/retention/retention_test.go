package retention

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/config"
)

func TestResolvePeriods(t *testing.T) {
	stored, err := ParseStored(json.RawMessage(`{"access_log": 30, "audit_log": null}`))
	if err != nil {
		t.Fatal(err)
	}
	env := config.Retention{Days: map[string]int{"audit_log": 400, "usage_events": 90}}
	p := Resolve(stored, env)
	if d, ok := p.Days(AccessLog); !ok || d != 30 || p[AccessLog].Source != SourcePlatform {
		t.Errorf("access log = %+v", p[AccessLog])
	}
	// An explicit keep overrides the environment default.
	if _, ok := p.Days(AuditLog); ok || !p[AuditLog].PlatformSet || *p[AuditLog].EnvDays != 400 {
		t.Errorf("audit = %+v", p[AuditLog])
	}
	if d, ok := p.Days(UsageEvents); !ok || d != 90 || p[UsageEvents].Source != SourceEnvironment {
		t.Errorf("usage = %+v", p[UsageEvents])
	}
	// Unset everywhere: keep.
	if _, ok := p.Days(AnalyticsEvents); ok {
		t.Error("analytics events have a period")
	}
	if _, ok := p[Conversations]; ok {
		t.Error("conversations have a platform period (they are per level)")
	}
	if _, err := ParseStored(json.RawMessage(`[1]`)); err == nil {
		t.Error("a non-object was accepted")
	}
}

func TestPeriodUpdate(t *testing.T) {
	s := Stored{"access_log": intPtr(5)}
	for _, tc := range []struct {
		u    PeriodUpdate
		fail bool
	}{
		{PeriodUpdate{Kind: AccessLog, Mode: ModeDefault}, false},
		{PeriodUpdate{Kind: AuditLog, Mode: ModeKeep}, false},
		{PeriodUpdate{Kind: DeletedFiles, Mode: ModeDays, Days: 0}, false},
		{PeriodUpdate{Kind: AuditLog, Mode: ModeDays, Days: 29}, true},
		{PeriodUpdate{Kind: AccessLog, Mode: ModeDays, Days: 36501}, true},
		{PeriodUpdate{Kind: AccessLog, Mode: "forever"}, true},
		{PeriodUpdate{Kind: AnonymousSessions, Mode: ModeKeep}, true},
	} {
		if err := tc.u.apply(s); (err != nil) != tc.fail {
			t.Errorf("%+v: err = %v", tc.u, err)
		}
	}
	if _, ok := s["access_log"]; ok {
		t.Error("default kept the platform value")
	}
	if v, ok := s["audit_log"]; !ok || v != nil {
		t.Error("keep not stored as null")
	}
	if v := s["deleted_files"]; v == nil || *v != 0 {
		t.Error("zero-day grace not stored")
	}
}

// Every kind has a rule, in run order, and periods are inlined as integers
// (the audit rule's LIKE pattern survives formatting).
func TestRulesCoverEveryKind(t *testing.T) {
	rules := Rules()
	if len(rules) != len(Kinds) {
		t.Fatalf("%d rules for %d kinds", len(rules), len(Kinds))
	}
	all := Periods{}
	for _, cp := range config.RetentionPeriods {
		all[Kind(cp.Kind)] = Period{Days: intPtr(7)}
	}
	for i, r := range rules {
		if r.Kind != Kinds[i] {
			t.Errorf("rule %d is %s, want %s", i, r.Kind, Kinds[i])
		}
		q, ok := r.candidates(all)
		if !ok || strings.Contains(q, "%!") || strings.Contains(q, "%d") {
			t.Errorf("%s: bad query %q", r.Kind, q)
		}
		if _, isPeriod := r.Kind.Period(); isPeriod {
			if !strings.Contains(q, "days => 7)") {
				t.Errorf("%s: period not inlined", r.Kind)
			}
			if _, ok := r.candidates(Periods{}); ok {
				t.Errorf("%s: runs without a period", r.Kind)
			}
		}
	}
	q, _ := rules[5].candidates(all)
	if !strings.Contains(q, `NOT LIKE 'legal\_hold.%' ESCAPE`) {
		t.Errorf("audit query = %s", q)
	}
}

func TestLevelOf(t *testing.T) {
	levels := []Level{{Key: "open", Rank: 0}, {Key: "sensitive", Rank: 1}, {Key: "restricted", Rank: 5}}
	rank := func(n int32) *int32 { return &n }
	for r, want := range map[int32]string{0: "open", 1: "sensitive", 3: "sensitive", 9: "restricted"} {
		if got := levelOf(levels, rank(r)); got == nil || got.Key != want {
			t.Errorf("rank %d = %v, want %s", r, got, want)
		}
	}
	if levelOf(levels, nil) != nil || levelOf(levels, rank(-1)) != nil {
		t.Error("level without a rank")
	}
}
