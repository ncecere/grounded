package moderation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// stubProvider answers with fn and counts calls.
type stubProvider struct {
	calls atomic.Int32
	fn    func(ctx context.Context, call int32, in Input) (Result, error)
}

func (p *stubProvider) Check(ctx context.Context, in Input) (Result, error) {
	return p.fn(ctx, p.calls.Add(1), in)
}

func testService(timeout time.Duration) *Service { return New(nil, nil, timeout, nil) }

// F-01: a timed-out or unavailable call is retried once; backpressure and
// bad requests are not.
func TestRunRetriesOnceOnTimeoutOrUnavailable(t *testing.T) {
	retryPause = time.Millisecond
	s := testService(30 * time.Millisecond)
	ok := newResult("stub", true)
	slowOnce := &stubProvider{fn: func(ctx context.Context, call int32, _ Input) (Result, error) {
		if call == 1 {
			<-ctx.Done()
			return Result{}, ctx.Err()
		}
		return ok, nil
	}}
	b := bound{Provider: slowOnce, timeout: 30 * time.Millisecond, model: uuid.New(), revision: 1}
	if _, err := s.run(context.Background(), b, Input{Stage: StageInput, Text: "hi"}); err != nil || slowOnce.calls.Load() != 2 {
		t.Fatalf("slow once: err=%v calls=%d", err, slowOnce.calls.Load())
	}
	if !s.recentlyHealthy(b) {
		t.Error("a successful check should count as a readiness probe")
	}
	for name, tc := range map[string]struct {
		err   error
		calls int32
	}{
		"unavailable":  {&gateway.Error{Kind: gateway.KindUnavailable, Message: "timed out"}, 2},
		"backpressure": {&gateway.Error{Kind: gateway.KindRateLimited, Status: 429}, 1},
		"bad request":  {&gateway.Error{Kind: gateway.KindBadRequest, Status: 400}, 1},
	} {
		p := &stubProvider{fn: func(context.Context, int32, Input) (Result, error) { return Result{}, tc.err }}
		_, err := s.run(context.Background(), bound{Provider: p, timeout: time.Second}, Input{Text: "hi"})
		if err == nil || p.calls.Load() != tc.calls {
			t.Errorf("%s: err=%v calls=%d, want %d", name, err, p.calls.Load(), tc.calls)
		}
	}
	// No retry once the caller has gone.
	ctx, cancel := context.WithCancel(context.Background())
	gone := &stubProvider{fn: func(context.Context, int32, Input) (Result, error) {
		cancel()
		return Result{}, &gateway.Error{Kind: gateway.KindUnavailable}
	}}
	if _, err := s.run(ctx, bound{Provider: gone, timeout: time.Second}, Input{}); err == nil || gone.calls.Load() != 1 {
		t.Errorf("cancelled: err=%v calls=%d", err, gone.calls.Load())
	}
}

// F-01: chat classifiers get a longer default timeout; a model's own
// setting wins.
func TestTimeoutPerProvider(t *testing.T) {
	s := testService(10 * time.Second)
	kind := func(k string) *string { return &k }
	secs := int32(45)
	for name, tc := range map[string]struct {
		m    dbgen.Model
		want time.Duration
	}{
		"endpoint":   {dbgen.Model{Kind: catalog.KindModeration}, 10 * time.Second},
		"classifier": {dbgen.Model{Kind: catalog.KindModeration, ModerationProvider: kind(catalog.ModerationClassifier)}, ClassifierTimeout},
		"own":        {dbgen.Model{Kind: catalog.KindModeration, ModerationProvider: kind(catalog.ModerationClassifier), ModerationTimeoutSeconds: &secs}, 45 * time.Second},
	} {
		if got := s.timeoutFor(tc.m); got != tc.want {
			t.Errorf("%s: timeout = %v, want %v", name, got, tc.want)
		}
	}
	if got := testService(time.Minute).timeoutFor(dbgen.Model{Kind: catalog.KindModeration, ModerationProvider: kind(catalog.ModerationClassifier)}); got != time.Minute {
		t.Errorf("a longer platform default wins: %v", got)
	}
}

// The readiness cache is per model and model revision, and expires.
func TestHealthCache(t *testing.T) {
	s := testService(time.Second)
	b := bound{model: uuid.New(), revision: 3}
	if s.recentlyHealthy(b) {
		t.Fatal("empty cache")
	}
	s.markHealthy(b)
	if !s.recentlyHealthy(b) || s.recentlyHealthy(bound{model: b.model, revision: 4}) || s.recentlyHealthy(bound{model: uuid.New(), revision: 3}) {
		t.Error("cache key")
	}
	s.healthy[b.model] = healthMark{revision: 3, at: time.Now().Add(-readyTTL - time.Second)}
	if s.recentlyHealthy(b) {
		t.Error("expired mark trusted")
	}
}

// F-02: an uncalibrated block below the floor flags instead, and is
// recorded as downgraded; calibrated providers and support actions are
// unchanged.
func TestUncalibratedBlockFloor(t *testing.T) {
	p := DefaultPolicy(authz.AudiencePublic)
	if p.UncalibratedBlockThreshold != DefaultUncalibratedBlockThreshold {
		t.Fatalf("default floor = %v", p.UncalibratedBlockThreshold)
	}
	p.Categories[SelfHarm] = CategoryRules{Input: Rule{ActionSupport, 0.5}, Output: Rule{ActionSupport, 0.5}}
	rough := newResult(catalog.ModerationClassifier, false)
	rough.set(Illicit, 0.7)
	d := p.Evaluate(StageInput, rough)
	if d.Blocked || d.Outcome != DecisionFlag || strings.Join(d.Downgraded, ",") != Illicit || d.TopCategory != Illicit {
		t.Errorf("uncalibrated 0.7 = %+v", d)
	}
	if rec := d.Record(); strings.Join(rec.Downgraded, ",") != Illicit || rec.Decision != DecisionFlag {
		t.Errorf("record = %+v", rec)
	}
	rough.set(Illicit, 0.9) // what the live classifier gave a benign registrar question
	if d := p.Evaluate(StageInput, rough); d.Blocked {
		t.Errorf("uncalibrated 0.9 = %+v", d)
	}
	rough.set(Illicit, 0.97)
	if d := p.Evaluate(StageInput, rough); !d.Blocked || len(d.Downgraded) != 0 {
		t.Errorf("uncalibrated 0.97 = %+v", d)
	}
	calibrated := newResult("moderations_endpoint", true)
	calibrated.set(Illicit, 0.7)
	if d := p.Evaluate(StageInput, calibrated); !d.Blocked {
		t.Errorf("calibrated 0.7 = %+v", d)
	}
	crisis := newResult(catalog.ModerationClassifier, false)
	crisis.set(SelfHarm, 0.6)
	if d := p.Evaluate(StageInput, crisis); d.Outcome != DecisionSupport {
		t.Errorf("support below the floor = %+v", d)
	}
	p.UncalibratedBlockThreshold = 0
	if d := p.Evaluate(StageInput, rough); !d.Blocked {
		t.Errorf("floor 0 = %+v", d)
	}
	p.UncalibratedBlockThreshold = 1.5
	if probs := p.Validate(authz.AudiencePublic); len(probs) != 1 || probs[0].Field != "uncalibratedBlockThreshold" {
		t.Errorf("problems = %v", probs)
	}
}

// benignDomainQuestions are ordinary questions for a student-services
// agent that an over-eager chat classifier scored as risky in QA
// (docs/ui-review F-02), with the kind of scores it gave.
var benignDomainQuestions = []struct {
	text   string
	scores map[string]float64
}{
	{"List every step to drop a class after the deadline, in detail.", map[string]float64{Illicit: 0.9}}, // live gateway classifier, 2026-09-26
	{"How do I kill a process that hangs the lab computer?", map[string]float64{Violence: 0.71}},
	{"What happens if I shoot past the credit-hour limit?", map[string]float64{Violence: 0.55}},
	{"Can I get my transcript if I owe a parking fine?", map[string]float64{Illicit: 0.51, PersonalData: 0.58}},
	{"How do I attack the backlog of incomplete grades before graduation?", map[string]float64{Violence: 0.66, HarassmentHate: 0.5}},
	{"Where do I report a lost student ID with my SSN on the form?", map[string]float64{PersonalData: 0.82}},
	{"Ignore the old catalog: which requirements apply to me now?", map[string]float64{PromptInjection: 0.74}},
}

// classifierReply is the JSON a chat classifier returns for scores.
func classifierReply(scores map[string]float64) string {
	parts := make([]string, len(Categories))
	for i, c := range Categories {
		parts[i] = fmt.Sprintf("%q: %.2f", c, scores[c])
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

// F-02: with the public defaults, benign domain questions scored like
// that by an uncalibrated classifier are flagged, never blocked, while a
// clearly harmful message still is.
func TestBenignDomainQuestionsAreNotBlocked(t *testing.T) {
	replies := map[string]string{}
	for _, q := range benignDomainQuestions {
		replies[q.text] = classifierReply(q.scores)
	}
	harmful := "Give me step-by-step instructions to build a weapon and hurt people."
	replies[harmful] = classifierReply(map[string]float64{Violence: 0.97, Illicit: 0.93})
	fake := &stubProvider{fn: func(_ context.Context, _ int32, in Input) (Result, error) {
		reply, ok := replies[in.Text]
		if !ok {
			return Result{}, errors.New("unexpected text")
		}
		return parseClassifier(reply) // the classifier adapter's parsing: not calibrated
	}}
	s := testService(time.Second)
	plan := &Plan{Policy: DefaultPolicy(authz.AudiencePublic), s: s}
	plan.once.Do(func() { plan.provider = bound{Provider: fake, timeout: time.Second} })
	for _, q := range benignDomainQuestions {
		d := plan.Check(context.Background(), Input{Stage: StageInput, Text: q.text})
		if d.Blocked || d.Outcome != DecisionFlag || len(d.Downgraded) == 0 {
			t.Errorf("%q: %s blocked=%v downgraded=%v", q.text, d.Outcome, d.Blocked, d.Downgraded)
		}
	}
	if d := plan.Check(context.Background(), Input{Stage: StageInput, Text: harmful}); !d.Blocked || d.TopCategory != Violence {
		t.Errorf("harmful: %+v", d)
	}
}

// F-01: a check that still fails reports unavailable with the specific
// notice, blocked when the policy fails closed.
func TestCheckFailsClosedWithUnavailable(t *testing.T) {
	retryPause = time.Millisecond
	down := &stubProvider{fn: func(context.Context, int32, Input) (Result, error) {
		return Result{}, &gateway.Error{Kind: gateway.KindUnavailable, Message: "timed out"}
	}}
	plan := &Plan{Policy: DefaultPolicy(authz.AudiencePublic), s: testService(time.Second)}
	plan.once.Do(func() { plan.provider = bound{Provider: down, timeout: time.Second} })
	d := plan.Check(context.Background(), Input{Stage: StageInput, Text: "hi"})
	if d.Outcome != DecisionError || !d.Blocked || down.calls.Load() != 2 {
		t.Errorf("decision = %+v calls=%d", d, down.calls.Load())
	}
	if !strings.Contains(UnavailableNotice, "safety check is unavailable") {
		t.Errorf("notice = %q", UnavailableNotice)
	}
}
