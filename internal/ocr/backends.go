package ocr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/parse"
)

// Tesseract is a client of the grounded-ocr sidecar (cmd/grounded-ocr):
// POST /ocr?lang=eng with a PNG body returns {"text", "confidence"}.
type Tesseract struct {
	BaseURL string
	HTTP    *http.Client
}

// NewTesseract returns a client; timeout bounds one page.
func NewTesseract(baseURL string, timeout time.Duration) *Tesseract {
	return &Tesseract{BaseURL: strings.TrimRight(baseURL, "/"), HTTP: &http.Client{Timeout: timeout}}
}

// maxOCRResponse bounds a page's text (a dense page is a few KB).
const maxOCRResponse = 4 << 20

// Recognize reads one page. Network errors, 429 and 5xx are
// parse.ErrOCRUnavailable (the document is retried); other refusals fail
// the page.
func (t *Tesseract) Recognize(ctx context.Context, img []byte, langs string) (parse.OCRResult, error) {
	u := t.BaseURL + "/ocr?lang=" + url.QueryEscape(langs)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(img))
	if err != nil {
		return parse.OCRResult{}, err
	}
	req.Header.Set("Content-Type", "image/png")
	res, err := t.HTTP.Do(req)
	if err != nil {
		return parse.OCRResult{}, fmt.Errorf("%w: tesseract: %v", parse.ErrOCRUnavailable, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, maxOCRResponse))
	if err != nil {
		return parse.OCRResult{}, fmt.Errorf("%w: tesseract response: %v", parse.ErrOCRUnavailable, err)
	}
	var out struct {
		Text       string  `json:"text"`
		Confidence float64 `json:"confidence"`
		Error      string  `json:"error"`
	}
	_ = json.Unmarshal(body, &out)
	switch {
	case res.StatusCode >= 500 || res.StatusCode == http.StatusTooManyRequests:
		return parse.OCRResult{}, fmt.Errorf("%w: tesseract returned HTTP %d %s", parse.ErrOCRUnavailable, res.StatusCode, out.Error)
	case res.StatusCode != http.StatusOK:
		return parse.OCRResult{}, fmt.Errorf("tesseract could not read the page (HTTP %d): %s", res.StatusCode, out.Error)
	}
	return parse.OCRResult{Text: out.Text, Confidence: out.Confidence}, nil
}

// Languages lists the sidecar's installed languages (GET /languages).
func (t *Tesseract) Languages(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.BaseURL+"/languages", nil)
	if err != nil {
		return nil, err
	}
	res, err := t.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: tesseract: %v", parse.ErrOCRUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: tesseract returned HTTP %d", parse.ErrOCRUnavailable, res.StatusCode)
	}
	var out struct {
		Languages []string `json:"languages"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out); err != nil {
		return nil, err
	}
	return out.Languages, nil
}

// VisionPrompt is what a vision model is asked for each page.
const VisionPrompt = "Transcribe this page as Markdown. Keep the reading order, headings, lists and tables. " +
	"Write only the page's text: no commentary, and nothing that isn't on the page."

// visionMaxTokens bounds a page's transcription when the model sets no
// maximum output.
const visionMaxTokens = 4096

// vision transcribes page images with a vision model through the gateway.
type vision struct {
	target catalog.ModerationTarget
	user   string
	// background marks ingestion's requests (they yield to interactive
	// requests under the connection's request limit).
	background bool
}

func (v *vision) Recognize(ctx context.Context, img []byte, _ string) (parse.OCRResult, error) {
	if v.background {
		ctx = gateway.Background(ctx)
	}
	m := v.target.Model
	maxTokens := visionMaxTokens
	if m.MaxOutputTokens != nil && *m.MaxOutputTokens > 0 {
		maxTokens = int(*m.MaxOutputTokens)
	}
	res, err := v.target.Client.Complete(ctx, gateway.CompleteRequest{
		Model: m.UpstreamModel, MaxTokens: maxTokens, User: v.user, Extra: catalog.DecodeCompat(m.Compat).ExtraBody,
		Messages: []gateway.ChatMessage{{Role: "user", Content: VisionPrompt, ImagePNG: img}},
	})
	if err != nil {
		var ge *gateway.Error
		if errors.As(err, &ge) && ge.Kind == gateway.KindBadRequest {
			return parse.OCRResult{}, err // this page (e.g. the image was refused)
		}
		// Keeps the gateway error for backpressure (the document is snoozed).
		return parse.OCRResult{}, fmt.Errorf("%w: %w", parse.ErrOCRUnavailable, err)
	}
	return parse.OCRResult{Text: stripFence(res.Text), TokensIn: res.Usage.PromptTokens, TokensOut: res.Usage.CompletionTokens}, nil
}

// stripFence removes a ```markdown fence some models wrap their answer in.
func stripFence(s string) string {
	t := strings.TrimSpace(s)
	if !strings.HasPrefix(t, "```") || !strings.HasSuffix(t, "```") || len(t) < 6 {
		return s
	}
	t = strings.TrimSuffix(t, "```")
	if i := strings.IndexByte(t, '\n'); i >= 0 {
		return strings.TrimSpace(t[i+1:])
	}
	return s
}
