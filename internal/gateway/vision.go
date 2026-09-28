package gateway

import (
	"encoding/base64"
	"encoding/json"
)

// MarshalJSON writes a message with an image as OpenAI content parts
// (text, then the image as a data URL); other messages as plain content.
func (m ChatMessage) MarshalJSON() ([]byte, error) {
	if len(m.ImagePNG) == 0 {
		type plain struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}
		return json.Marshal(plain{Role: m.Role, Content: m.Content})
	}
	type imageURL struct {
		URL string `json:"url"`
	}
	type part struct {
		Type     string    `json:"type"`
		Text     string    `json:"text,omitempty"`
		ImageURL *imageURL `json:"image_url,omitempty"`
	}
	parts := []part{}
	if m.Content != "" {
		parts = append(parts, part{Type: "text", Text: m.Content})
	}
	parts = append(parts, part{Type: "image_url", ImageURL: &imageURL{URL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(m.ImagePNG)}})
	return json.Marshal(struct {
		Role    string `json:"role"`
		Content []part `json:"content"`
	}{m.Role, parts})
}
