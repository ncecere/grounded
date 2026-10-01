package rerank

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

func testPlan(t *testing.T, p *testutil.FakeProxy) *Plan {
	t.Helper()
	return &Plan{
		Client: gateway.New(p.BaseURL(), p.APIKey, 5*time.Second), Candidates: DefaultCandidates, TimeLimit: time.Second,
		Model: dbgen.Model{ID: uuid.New(), UpstreamModel: testutil.FakeRerankModel, MaxClassification: "internal", Compat: json.RawMessage(`{}`)},
		ranks: map[string]int32{"open": 0, "internal": 1, "sensitive": 2},
	}
}

func TestSettings(t *testing.T) {
	s := DefaultSettings()
	if s.Candidates != 40 || s.TimeLimitMs != 2000 || len(s.Validate()) != 0 || s.TimeLimit() != 2*time.Second {
		t.Fatalf("defaults = %+v", s)
	}
	if p := (Settings{Candidates: 4, TimeLimitMs: 20000}).Validate(); len(p) != 2 || p[0].Field != "candidates" || p[1].Field != "timeLimitMs" {
		t.Errorf("problems = %v", p)
	}
	if got := DecodeSettings(json.RawMessage(`{"candidates":12}`)); got.Candidates != 12 || got.TimeLimitMs != DefaultTimeLimitMs {
		t.Errorf("decoded = %+v", got)
	}
}

func TestPlanAllowsAndFetch(t *testing.T) {
	p := testPlan(t, testutil.NewFakeProxy(t))
	if !p.Allows("") || !p.Allows("open") || !p.Allows("internal") || p.Allows("sensitive") || p.Allows("unknown") {
		t.Error("Allows")
	}
	if p.Fetch(4) != 40 || p.Fetch(45) != 45 || p.Fetch(80) != MaxDocuments {
		t.Error("Fetch")
	}
}

func TestRerankOrdersMetersAndFailsOpen(t *testing.T) {
	fake := testutil.NewFakeProxy(t)
	p := testPlan(t, fake)
	m := &Meter{}
	ctx := WithMeter(context.Background(), m)
	docs := []string{"Parking permits.", "The library opens at 8 am.", testutil.FakeRerankTop + " Opening hours."}
	out := p.Rerank(ctx, CallerRetrieve, "When does the library open?", docs, 2)
	if !out.OK() || len(out.Order) != 2 || out.Order[0] != 2 || out.Order[1] != 1 || out.Scores[2] != 1 {
		t.Fatalf("outcome = %+v", out)
	}
	usage := m.Usage(json.RawMessage(`{}`))
	if len(usage) != 2 || usage[0].Kind != UsageTokens || usage[0].Quantity <= 0 || usage[1].Kind != UsageRequests || usage[1].Quantity != 1 {
		t.Fatalf("usage = %+v", usage)
	}

	fake.FailRerankWith(http.StatusInternalServerError)
	if out := p.Rerank(ctx, CallerRetrieve, "q", docs, 2); out.Status != StatusError || out.Order != nil {
		t.Errorf("error = %+v", out)
	}
	fake.FailRerankWith(0)
	fake.SetRerankDelay(time.Second)
	p.TimeLimit = 100 * time.Millisecond
	start := time.Now()
	if out := p.Rerank(ctx, CallerRetrieve, "q", docs, 2); out.Status != StatusTimeout || time.Since(start) > 900*time.Millisecond {
		t.Errorf("timeout = %+v after %v", out, time.Since(start))
	}
	if usage := m.Usage(nil); len(usage) != 2 || usage[1].Quantity != 1 {
		t.Errorf("failed requests counted: %+v", usage)
	}
	if out := p.Rerank(ctx, CallerRetrieve, "q", nil, 2); !out.OK() || len(out.Order) != 0 {
		t.Errorf("no documents = %+v", out)
	}
	if out := Skip(CallerAgent); out.Status != StatusSkipped || out.OK() {
		t.Errorf("skip = %+v", out)
	}
}

func TestFitTrimsLongPassages(t *testing.T) {
	p := testPlan(t, testutil.NewFakeProxy(t))
	docs := []string{"short", strings.Repeat("word ", 500)}
	if got := p.fit("query", docs); &got[0] != &docs[0] {
		t.Error("copied without a limit")
	}
	limit := int32(100)
	p.Model.MaxInputTokens = &limit
	got := p.fit("query", docs)
	if got[0] != "short" || len([]rune(got[1])) != (100-2-16)*4 || docs[1] == got[1] {
		t.Errorf("fit = %d runes", len([]rune(got[1])))
	}
	if estimate("abcd", []string{"abcdefgh", ""}) != 1+2+1 {
		t.Error("estimate")
	}
}
