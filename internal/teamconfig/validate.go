package teamconfig

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/evals"
	kbservice "github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/web"
	"github.com/ncecere/grounded/internal/webhooks"
)

func domainError() error { return invalid("unsupported_configuration", "$", nil) }

// domainAt names the resource a domain check refused, by its position only (never its text).
func domainAt(field string, i int) error {
	return invalid("unsupported_configuration", fmt.Sprintf("%s[%d]", field, i), nil)
}

func (d Document) validate() error {
	sources := map[string]bool{}
	kbs := map[string]bool{}
	if err := d.validateSources(sources); err != nil {
		return err
	}
	if err := d.validateKBs(sources, kbs); err != nil {
		return err
	}
	if err := d.validateAgents(kbs); err != nil {
		return err
	}
	if err := d.validateEvaluations(kbs); err != nil {
		return err
	}
	if err := d.validateWebhooks(); err != nil {
		return err
	}
	raw, _ := json.Marshal(d)
	if unsafeText(string(raw), 0) {
		return domainError()
	}
	return nil
}
func (d Document) validateSources(sources map[string]bool) error {
	for i, s := range d.Sources {
		sources[s.Name] = true
		if !referenceName(s.EmbeddingProfile) || !referenceName(s.Classification) || len(s.Description) > 2000 || (s.Status != "active" && s.Status != "paused") {
			return domainAt("$.sources", i)
		}
		switch s.Type {
		case "upload":
			if s.Web != nil {
				return domainAt("$.sources", i)
			}
		case "web":
			if s.Web == nil {
				return domainAt("$.sources", i)
			}
			raw, _ := json.Marshal(s.Web)
			if _, err := web.ParseConfig(raw, 1000000); err != nil {
				return domainAt("$.sources", i)
			}
			for _, u := range s.Web.URLs {
				if !safeURL(u) {
					return domainAt("$.sources", i)
				}
			}
		default:
			return domainAt("$.sources", i)
		}
		if err := s.Boilerplate.validate(); err != nil {
			return domainAt("$.sources", i)
		}
	}
	return nil
}
func (d Document) validateKBs(sources, kbs map[string]bool) error {
	for i, k := range d.KnowledgeBases {
		kbs[k.Name] = true
		if !referenceName(k.EmbeddingProfile) || len(k.Description) > 2000 || k.TopK < 1 || k.TopK > 50 {
			return domainAt("$.knowledgeBases", i)
		}
		if (k.VectorWeight == nil) != (k.KeywordWeight == nil) {
			return domainAt("$.knowledgeBases", i)
		}
		if k.VectorWeight != nil {
			v, e := k.VectorWeight.Float64()
			w, err := k.KeywordWeight.Float64()
			if e != nil || err != nil || !(kbservice.Weights{Vector: v, Keyword: w}).Valid() {
				return domainAt("$.knowledgeBases", i)
			}
		}
		seen := map[SourceRef]bool{}
		for _, r := range k.Sources {
			if seen[r] || !referenceName(r.Name) {
				return domainAt("$.knowledgeBases", i)
			}
			seen[r] = true
			// A team source may be in the file or already in the team: planning resolves it (§1).
			if r.Namespace != "platform" && r.Namespace != "team" {
				return domainAt("$.knowledgeBases", i)
			}
		}
	}
	return nil
}
func (d Document) validateAgents(kbs map[string]bool) error {
	for i, a := range d.Agents {
		if !referenceName(a.Name) || agentProfile(a) != nil || validateConfig(a.Draft, kbs) != nil {
			return domainAt("$.agents", i)
		}
		seen := map[int32]bool{}
		for _, v := range a.Versions {
			if v.Version < 1 || seen[v.Version] || validateConfig(v.Config, kbs) != nil {
				return domainAt("$.agents", i)
			}
			seen[v.Version] = true
		}
		if a.PublishedVersion != 0 && !seen[a.PublishedVersion] {
			return domainAt("$.agents", i)
		}
	}
	return nil
}
func (d Document) validateEvaluations(kbs map[string]bool) error {
	for i, s := range d.EvaluationSets {
		if len(s.Description) > 2000 {
			return domainAt("$.evaluationSets", i)
		}
		if (s.KnowledgeBase == "") == (s.Agent == "") {
			return domainAt("$.evaluationSets", i)
		}
		// The target is a knowledge base's name or an agent's address (slug), in the file or the team (§1).
		if s.KnowledgeBase != "" && !referenceName(s.KnowledgeBase) || s.Agent != "" && teams.ValidateSlug(s.Agent) != nil {
			return domainAt("$.evaluationSets", i)
		}
		if len(s.Cases) > MaxSequenceItems {
			return domainAt("$.evaluationSets", i)
		}
		for _, c := range s.Cases {
			if _, err := (evals.CaseInput{Question: c.Question, Expected: evals.Expected{URLs: c.URLs}, MustMention: c.MustMention, Note: c.Note}).Normalize(); err != nil {
				return domainAt("$.evaluationSets", i)
			}
			for _, u := range c.URLs {
				if !safeURL(strings.TrimSuffix(u, "*")) {
					return domainAt("$.evaluationSets", i)
				}
			}
		}
	}
	return nil
}

// validateWebhooks checks what is portable: an https URL on port 443 without credentials, query or fragment (a query
// is where a receiver's token usually hides), one line of description, and known team events. Whether the host is
// approved is a property of the target install, checked when planning.
func (d Document) validateWebhooks() error {
	for i, h := range d.Webhooks {
		u, err := url.Parse(h.URL)
		if err != nil || u.Scheme != "https" || (u.Port() != "" && u.Port() != "443") || !safeURL(h.URL) {
			return domainAt("$.webhooks", i)
		}
		if utf8.RuneCountInString(h.Description) > 200 || strings.ContainsAny(h.Description, "\r\n") || len(h.Events) == 0 || len(h.Events) > 50 {
			return domainAt("$.webhooks", i)
		}
		seen := map[string]bool{}
		for _, e := range h.Events {
			t, ok := webhooks.Lookup(e)
			if !ok || t.Test || t.Scope != webhooks.ScopeTeam || seen[e] {
				return domainAt("$.webhooks", i)
			}
			seen[e] = true
		}
	}
	return nil
}

func validateConfig(c AgentConfig, kbs map[string]bool) error {
	if len(c.KnowledgeBases) > agents.MaxKBs {
		return domainError()
	}
	if c.Model != nil && (!referenceName(c.Model.Name) || !referenceName(c.Model.Connection)) {
		return domainError()
	}
	var m map[string]json.RawMessage
	if strictJSON(c.Settings, &m) != nil || m == nil {
		return domainError()
	}
	for _, f := range []string{"chatModelId", "kbs", "tools"} {
		if _, ok := m[f]; ok {
			return domainError()
		}
	}
	raw, _ := json.Marshal(m)
	if checkFields(raw, reflect.TypeOf(agents.Config{})) != nil {
		return domainError()
	}
	config, err := agents.ParseConfig(raw)
	if err != nil || !portableFilters(config) {
		return domainError()
	}
	seen := map[string]bool{}
	for _, r := range c.KnowledgeBases {
		if !referenceName(r.Name) || seen[strings.ToLower(r.Name)] || r.TopK != nil && (*r.TopK < 1 || *r.TopK > 50) {
			return domainError()
		}
		seen[strings.ToLower(r.Name)] = true
	}
	return nil
}

// Credential-bearing URLs cannot round trip safely. Conservatively refuse all
// query/fragment/userinfo and encoded paths rather than guessing which are keys.
// No URL is ever visited.
func safeURL(s string) bool {
	u, e := url.Parse(s)
	return e == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && !u.ForceQuery && !strings.ContainsAny(u.EscapedPath(), "%@")
}

// This is a credential-pattern check, not general secret discovery/DLP: configuration text is authorized content,
// and connection and secret tables are never read. It looks for credential syntax (an Authorization or Cookie value,
// a key=value secret, well-known token prefixes, a private key block), not for words: instructions that tell people
// how to reset their password are ordinary help-desk text and must export. Bounded decoding stops a credential from
// hiding behind URL or base64 encoding.
var credentialPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(authorization|proxy-authorization)\s*:\s*((bearer|basic|token|negotiate|digest)\s+)?[a-z0-9._~+/=-]{8,}`),
	regexp.MustCompile(`(?i)\b(bearer|basic)\s+[a-z0-9._~+/=-]{20,}`),
	regexp.MustCompile(`(?i)\bcookie\s*:\s*[^\s=;]+=\S+`),
	regexp.MustCompile(`(?i)\b(password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|auth[_-]?token|signing[_-]?secret)\s*[:=]\s*["']?[^\s"',;]{6,}`),
	regexp.MustCompile(`\b(sk|rk|pk)-[A-Za-z0-9_-]{20,}`),
	regexp.MustCompile(`\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}`),
	regexp.MustCompile(`\bxox[abpors]-[A-Za-z0-9-]{10,}`),
	regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),
	regexp.MustCompile(`\brag_[A-Za-z0-9_]{20,}`), // Grounded API keys (internal/apikeys)
	regexp.MustCompile(`(?i)-----begin [a-z ]*private key-----`),
}

func unsafeText(s string, depth int) bool {
	for _, re := range credentialPatterns {
		if re.MatchString(s) {
			return true
		}
	}
	if depth >= 3 {
		return false
	}
	if decoded, e := url.QueryUnescape(s); e == nil && decoded != s && unsafeText(decoded, depth+1) {
		return true
	}
	for _, part := range strings.FieldsFunc(s, func(r rune) bool {
		return !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || strings.ContainsRune("+/=_-", r))
	}) {
		if len(part) < 8 || len(part) > MaxScalarBytes {
			continue
		}
		for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
			if b, e := enc.DecodeString(part); e == nil && !bytes.Equal(b, []byte(part)) && unsafeText(string(b), depth+1) {
				return true
			}
		}
	}
	return false
}

// UUID source filters cannot bind across installs, and credential-bearing URL
// prefixes are no safer than source URLs. Refuse, never pass through opaque IDs.
func portableFilters(c agents.Config) bool {
	if c.Filters == nil {
		return true
	}
	if len(c.Filters.SourceIDs) > 0 {
		return false
	}
	for _, u := range c.Filters.URLPrefixes {
		if !safeURL(u) {
			return false
		}
	}
	return true
}

func (b Boilerplate) validate() error {
	if b.MinDocs != nil && (*b.MinDocs < boilerplate.MinMinDocs || *b.MinDocs > boilerplate.MaxMinDocs) {
		return domainError()
	}
	if b.Ratio != nil {
		f, err := b.Ratio.Float64()
		if err != nil || f < boilerplate.MinRatio || f > boilerplate.MaxRatio {
			return domainError()
		}
	}
	return nil
}
