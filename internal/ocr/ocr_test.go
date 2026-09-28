package ocr

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestTesseractClient(t *testing.T) {
	status := http.StatusOK
	var gotLang, gotType string
	var gotBody int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ocr":
			gotLang, gotType = r.URL.Query().Get("lang"), r.Header.Get("Content-Type")
			b, _ := io.ReadAll(r.Body)
			gotBody = len(b)
			w.WriteHeader(status)
			if status == http.StatusOK {
				_ = json.NewEncoder(w).Encode(map[string]any{"text": "Hello page", "confidence": 0.91})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "no such language"})
			}
		case "/languages":
			_ = json.NewEncoder(w).Encode(map[string]any{"languages": []string{"eng", "spa"}})
		}
	}))
	defer srv.Close()
	c := NewTesseract(srv.URL+"/", 5*time.Second)
	res, err := c.Recognize(context.Background(), SamplePNG, "eng+spa")
	if err != nil || res.Text != "Hello page" || res.Confidence != 0.91 || gotLang != "eng+spa" || gotType != "image/png" || gotBody != len(SamplePNG) {
		t.Fatalf("%+v %v lang %q type %q body %d", res, err, gotLang, gotType, gotBody)
	}
	status = http.StatusBadRequest
	if _, err := c.Recognize(context.Background(), SamplePNG, "xxx"); err == nil || errors.Is(err, parse.ErrOCRUnavailable) {
		t.Errorf("400 must fail the page only: %v", err)
	}
	status = http.StatusServiceUnavailable
	if _, err := c.Recognize(context.Background(), SamplePNG, "eng"); !errors.Is(err, parse.ErrOCRUnavailable) {
		t.Errorf("503: %v", err)
	}
	langs, err := c.Languages(context.Background())
	if err != nil || len(langs) != 2 {
		t.Errorf("languages %v %v", langs, err)
	}
	srv.Close()
	if _, err := c.Recognize(context.Background(), SamplePNG, "eng"); !errors.Is(err, parse.ErrOCRUnavailable) {
		t.Errorf("down: %v", err)
	}
}

func visionTarget(fp *testutil.FakeProxy, model string) catalog.ModerationTarget {
	return catalog.ModerationTarget{Model: dbgen.Model{UpstreamModel: model, Compat: json.RawMessage(`{}`)},
		Client: gateway.New(fp.BaseURL(), fp.APIKey, 10*time.Second)}
}

func TestVisionBackend(t *testing.T) {
	fp := testutil.NewFakeProxy(t)
	v := &vision{target: visionTarget(fp, testutil.FakeVisionModel), user: "team:x", background: true}
	res, err := v.Recognize(context.Background(), SamplePNG, "eng")
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != testutil.FakeTranscription(1000, 240) || res.TokensIn != 1000 || res.TokensOut == 0 || fp.VisionRequests() != 1 {
		t.Errorf("%+v, requests %d", res, fp.VisionRequests())
	}
	// The prompt and the image went as content parts.
	bodies := fp.ChatRequests()
	var sent struct {
		Messages []struct {
			Content []map[string]any `json:"content"`
		} `json:"messages"`
	}
	if len(bodies) == 0 || json.Unmarshal(bodies[len(bodies)-1], &sent) != nil || len(sent.Messages[0].Content) != 2 ||
		sent.Messages[0].Content[0]["text"] != VisionPrompt {
		t.Errorf("request: %s", bodies)
	}
	// A busy model is backpressure: the document is snoozed, not failed.
	fp.FailVisionWith(http.StatusTooManyRequests)
	_, err = v.Recognize(context.Background(), SamplePNG, "eng")
	var ge *gateway.Error
	if !errors.Is(err, parse.ErrOCRUnavailable) || !errors.As(err, &ge) || !ge.Backpressure() {
		t.Errorf("429: %v", err)
	}
	// A refused image fails that page only.
	fp.FailVisionWith(http.StatusBadRequest)
	if _, err = v.Recognize(context.Background(), SamplePNG, "eng"); err == nil || errors.Is(err, parse.ErrOCRUnavailable) {
		t.Errorf("400: %v", err)
	}
}

func TestStripFence(t *testing.T) {
	for in, want := range map[string]string{
		"```markdown\n# Page\n\nText\n```": "# Page\n\nText",
		"```\nplain\n```":                  "plain",
		"# Page\n\nno fence":               "# Page\n\nno fence",
		"```":                              "```",
	} {
		if got := stripFence(in); got != want {
			t.Errorf("stripFence(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidLanguages(t *testing.T) {
	for _, ok := range []string{"eng", "eng+spa", "chi_sim+eng", "deu+fra+ita+spa+por"} {
		if !ValidLanguages(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "en", "eng+", "ENG", "eng spa", "eng;rm", "eng+eng+eng+eng+eng+eng+eng+eng+eng+eng+eng"} {
		if ValidLanguages(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

func TestUsageEvents(t *testing.T) {
	model := uuid.NullUUID{UUID: uuid.New(), Valid: true}
	ev := UsageEvents(&parse.OCRInfo{Backend: BackendVision, Pages: []int{2, 3}, TokensIn: 2000, TokensOut: 40}, model)
	if len(ev) != 3 || ev[0].Kind != limits.UsageOCRPages || ev[0].Quantity != 2 || string(ev[0].Metadata) != `{"backend":"vision"}` ||
		ev[1].Kind != limits.UsageVisionIn || ev[1].Quantity != 2000 || ev[1].ModelID != model || ev[2].Kind != limits.UsageVisionOut || ev[2].Quantity != 40 {
		t.Errorf("vision events %+v", ev)
	}
	ev = UsageEvents(&parse.OCRInfo{Backend: BackendTesseract, Pages: []int{1}}, uuid.NullUUID{})
	if len(ev) != 1 || ev[0].Quantity != 1 || string(ev[0].Metadata) != `{"backend":"tesseract"}` {
		t.Errorf("tesseract events %+v", ev)
	}
	if UsageEvents(nil, model) != nil {
		t.Error("no OCR, no events")
	}
}

type slowOCR struct{ now, peak atomic.Int32 }

func (s *slowOCR) Recognize(context.Context, []byte, string) (parse.OCRResult, error) {
	n := s.now.Add(1)
	for {
		p := s.peak.Load()
		if n <= p || s.peak.CompareAndSwap(p, n) {
			break
		}
	}
	time.Sleep(20 * time.Millisecond)
	s.now.Add(-1)
	return parse.OCRResult{Text: "x"}, nil
}

func TestConcurrencyIsPerProcess(t *testing.T) {
	eng := &slowOCR{}
	sem := make(chan struct{}, 2)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = limited{OCR: eng, sem: sem}.Recognize(context.Background(), nil, "eng")
		}()
	}
	wg.Wait()
	if p := eng.peak.Load(); p != 2 {
		t.Errorf("peak concurrency %d, want 2", p)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	sem <- struct{}{}
	sem <- struct{}{}
	if _, err := (limited{OCR: eng, sem: sem}).Recognize(ctx, nil, "eng"); !errors.Is(err, context.Canceled) {
		t.Errorf("waiting for a slot must stop with the context: %v", err)
	}
}

func TestBackendStatuses(t *testing.T) {
	s := New(nil, nil, nil, Config{TesseractURL: "http://ocr:8080"}, nil)
	st := s.BackendStatuses()
	if len(st) != 3 || !st[0].Configured || st[1].Configured || st[1].ConfigKey != "TIKA_URL" || !st[2].Configured {
		t.Errorf("%+v", st)
	}
	if d := s.defaults(); d.Backend != BackendTesseract || d.Enabled || d.Revision != 1 || d.Languages != "eng" {
		t.Errorf("defaults %+v", d)
	}
	if d := New(nil, nil, nil, Config{Tika: parse.NewTika("http://tika:9998", time.Second, parse.Limits{})}, nil).defaults(); d.Backend != BackendTika {
		t.Errorf("tika only: %+v", d)
	}
}
