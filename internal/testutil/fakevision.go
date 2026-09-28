// Vision models of the fake gateway (docs/ocr.md §2): a chat completion
// with an image part is "transcribed" deterministically.

package testutil

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/png" // decodes the page images
	"net/http"
	"strings"
)

// FakeVisionModel is the vision model the fake offers by default.
const FakeVisionModel = "fake-vision"

// AddVisionModel registers a vision model: a chat completion to it whose
// last user message has an image_url part (a PNG data URL) answers
// FakeTranscription of that image; one without an image is refused (400).
func (p *FakeProxy) AddVisionModel(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.vision[id] = true
}

// FailVisionWith makes vision requests answer status (0 = succeed again).
func (p *FakeProxy) FailVisionWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.visionFail = status
}

// VisionRequests is how many vision requests carried an image.
func (p *FakeProxy) VisionRequests() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.visionCalls
}

// FakeTranscription is the fake's Markdown for a page image of w x h pixels.
func FakeTranscription(w, h int) string {
	return fmt.Sprintf("# Transcribed page\n\nA page image of %d x %d pixels.", w, h)
}

// fakeImage returns the PNG of the last user message's image part.
func fakeImage(in *fakeChatRequest) ([]byte, bool) {
	for i := len(in.Messages) - 1; i >= 0; i-- {
		m := in.Messages[i]
		if m.Role != "user" {
			continue
		}
		var parts []struct {
			Type     string `json:"type"`
			ImageURL struct {
				URL string `json:"url"`
			} `json:"image_url"`
		}
		if json.Unmarshal(m.Content, &parts) != nil {
			return nil, false
		}
		for _, pt := range parts {
			if pt.Type == "image_url" && strings.HasPrefix(pt.ImageURL.URL, "data:image/png;base64,") {
				data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(pt.ImageURL.URL, "data:image/png;base64,"))
				return data, err == nil
			}
		}
		return nil, false
	}
	return nil, false
}

// visionChat answers a vision model's request (raw is its body, kept for
// ChatRequests); false when the model isn't one.
func (p *FakeProxy) visionChat(w http.ResponseWriter, in *fakeChatRequest, raw []byte) bool {
	p.mu.Lock()
	isVision, fail := p.vision[in.Model], p.visionFail
	if isVision {
		p.chatBodies = append(p.chatBodies, raw)
	}
	p.mu.Unlock()
	if !isVision {
		return false
	}
	if fail != 0 {
		if fail == http.StatusTooManyRequests || fail == http.StatusServiceUnavailable {
			w.Header().Set("Retry-After", "1")
		}
		writeErr(w, fail, "vision failure (test)")
		return true
	}
	img, ok := fakeImage(in)
	if !ok {
		writeErr(w, 400, "a vision request needs a PNG image part")
		return true
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(img))
	if err != nil {
		writeErr(w, 400, "the image is not a PNG")
		return true
	}
	p.mu.Lock()
	p.visionCalls++
	p.mu.Unlock()
	text := FakeTranscription(cfg.Width, cfg.Height)
	out := len(strings.Fields(text))
	// A page image counts as 1000 input tokens, as real models count tiles.
	usage := map[string]any{"prompt_tokens": 1000, "completion_tokens": out, "total_tokens": 1000 + out}
	writeFakeCompletion(w, in, fakeReply{text: text}, usage)
	return true
}
