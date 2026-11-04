package teamconfig

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/ncecere/grounded/internal/agents"
	"net/url"
	"strings"
	"testing"
)

func validDocument() Document {
	return Document{APIVersion: Version, Sources: []Source{{Name: "Guide", Type: "upload", EmbeddingProfile: "Default", Classification: "open", Status: "active"}}, KnowledgeBases: []KnowledgeBase{{Name: "Help", EmbeddingProfile: "Default", TopK: 6, Sources: []SourceRef{{Namespace: "team", Name: "Guide"}}}}, Agents: []Agent{}, EvaluationSets: []EvaluationSet{}, Webhooks: []Webhook{}}
}
func TestStrictDocument(t *testing.T) {
	d := validDocument()
	raw, _ := json.Marshal(d)
	if _, err := DecodeDocument(bytes.NewReader(raw)); err != nil {
		t.Fatal(err)
	}
	for _, change := range []struct{ from, to string }{
		{`"description":""`, `"unknown":"password=canary","description":""`},
		{`"namespace":"team"`, `"namespace":"other-team"`},
		{`"topK":6`, `"topK":"six"`},
		{`"topK":6`, `"topK":0`},
		{`"topK":6`, `"topK":51`},
		{`"boilerplate":{}`, `"boilerplate":{"authorization":"canary"}`},
	} {
		// A reference to a source that is not in the file is resolved against the team when planning (plan_test.go).
		changed := strings.Replace(string(raw), change.from, change.to, 1)
		if _, err := DecodeDocument(strings.NewReader(changed)); err == nil {
			t.Errorf("accepted invalid domain %s", change.to)
		}
	}
}
func TestAgentSettingsStrictNestedAndPrecision(t *testing.T) {
	for _, settings := range []string{`{"unknown":true}`, `{"systemOne":{"unknown":true}}`, `{"moderation":{"unknown":true}}`, `{"filters":{"unknown":true}}`, `{"filters":{"sourceIds":["00000000-0000-0000-0000-000000000001"]}}`, `{"filters":{"urlPrefixes":["https://example.edu/?token=synthetic"]}}`, `{"chatModelId":"x"}`, `{"tools":[]}`} {
		if validateConfig(AgentConfig{Settings: json.RawMessage(settings)}, map[string]bool{}) == nil {
			t.Errorf("accepted %s", settings)
		}
	}
	d := validDocument()
	d.Agents = []Agent{{Name: "Helper", Slug: "helper", Status: "active", Draft: AgentConfig{Settings: json.RawMessage(`{"temperature":0.12345678901234567890123456789}`), KnowledgeBases: []KBRef{}}, StarterQuestions: []string{}, Versions: []AgentVersion{}}}
	raw, _ := json.Marshal(d)
	got, err := DecodeDocument(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(got.Agents[0].Draft.Settings, []byte("0.12345678901234567890123456789")) {
		t.Fatal("precision lost")
	}
}
func TestCredentialMarkersEncodedAndURLs(t *testing.T) {
	canary := "Authorization: Bearer synthetic-canary"
	for _, text := range []string{canary, url.QueryEscape(canary), base64.StdEncoding.EncodeToString([]byte(canary))} {
		d := validDocument()
		d.Sources[0].Description = text
		raw, _ := json.Marshal(d)
		_, err := DecodeDocument(bytes.NewReader(raw))
		if err == nil || strings.Contains(err.Error(), "canary") {
			t.Fatal("secret accepted or echoed")
		}
	}
	for _, u := range []string{"https://user:pw@example.edu", "https://example.edu?key=x", "https://example.edu/#x", "https://example.edu/%74oken"} {
		if safeURL(u) {
			t.Fatalf("credential URL accepted %s", u)
		}
	}
}

// Credential syntax is refused; the words alone are ordinary help-desk text.
func TestCredentialPatternsNotWords(t *testing.T) {
	for _, text := range []string{"Help students reset their password.", "Explain cookies and the session timeout.", "Ask for an access token only through the portal.", "Authorization forms are in the registrar's office."} {
		if unsafeText(text, 0) {
			t.Errorf("refused ordinary text %q", text)
		}
	}
	for _, text := range []string{"password: Tr0ub4dor&3", "api_key=abcdef123456", "Authorization: Basic dXNlcjpwYXNzd29yZA==", "sk-" + strings.Repeat("a", 24), "ghp_" + strings.Repeat("b", 36), "AKIAABCDEFGHIJKLMNOP", "rag_" + strings.Repeat("c", 30), "Cookie: session=abc123", "-----BEGIN RSA PRIVATE KEY-----"} {
		if !unsafeText(text, 0) {
			t.Errorf("accepted credential syntax %q", text)
		}
	}
}

func TestDomainResourceRanges(t *testing.T) {
	d := validDocument()
	d.EvaluationSets = []EvaluationSet{{Name: "Check", KnowledgeBase: "Help", Cases: []EvaluationCase{{Question: "Question", URLs: []string{"https://example.edu/guide"}, MustMention: []string{strings.Repeat("x", 201)}}}}}
	raw, _ := json.Marshal(d)
	if _, err := DecodeDocument(bytes.NewReader(raw)); err == nil {
		t.Fatal("accepted invalid must-mention phrase")
	}
	d.EvaluationSets = nil
	d.Agents = []Agent{{Name: "Helper", Slug: "NOT A SLUG", Status: "active", Draft: AgentConfig{Settings: json.RawMessage("{}")}, Versions: []AgentVersion{}, StarterQuestions: []string{}}}
	// Use a non-null list so this tests the domain rather than ingress null.
	d.EvaluationSets = []EvaluationSet{}
	raw, _ = json.Marshal(d)
	if _, err := DecodeDocument(bytes.NewReader(raw)); err == nil {
		t.Fatal("accepted invalid agent slug")
	}
	config := AgentConfig{Settings: json.RawMessage("{}")}
	names := map[string]bool{}
	for i := 0; i < agents.MaxKBs+1; i++ {
		config.KnowledgeBases = append(config.KnowledgeBases, KBRef{Name: fmt.Sprint(i)})
		names[fmt.Sprint(i)] = true
	}
	if validateConfig(config, names) == nil {
		t.Fatal("accepted too many KB references")
	}
}
