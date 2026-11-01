package teamconfig

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"reflect"
	"strings"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/evals"
	kbservice "github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/web"
)

func domainError() error { return invalid("unsupported_configuration", "$", nil) }

func (d Document) validate() error {
	if len(d.Webhooks) != 0 {
		return domainError()
	}
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
	raw, _ := json.Marshal(d)
	if unsafeText(string(raw), 0) {
		return domainError()
	}
	return nil
}
func (d Document) validateSources(sources map[string]bool) error {
	for _, s := range d.Sources {
		sources[s.Name] = true
		if !referenceName(s.EmbeddingProfile) || !referenceName(s.Classification) || len(s.Description) > 2000 || (s.Status != "active" && s.Status != "paused") {
			return domainError()
		}
		switch s.Type {
		case "upload":
			if s.Web != nil {
				return domainError()
			}
		case "web":
			if s.Web == nil {
				return domainError()
			}
			raw, _ := json.Marshal(s.Web)
			if _, err := web.ParseConfig(raw, 1000000); err != nil {
				return domainError()
			}
			for _, u := range s.Web.URLs {
				if !safeURL(u) {
					return domainError()
				}
			}
		default:
			return domainError()
		}
		if err := s.Boilerplate.validate(); err != nil {
			return err
		}
	}
	return nil
}
func (d Document) validateKBs(sources, kbs map[string]bool) error {
	for _, k := range d.KnowledgeBases {
		kbs[k.Name] = true
		if !referenceName(k.EmbeddingProfile) || len(k.Description) > 2000 || k.TopK < 1 || k.TopK > 50 {
			return domainError()
		}
		if (k.VectorWeight == nil) != (k.KeywordWeight == nil) {
			return domainError()
		}
		if k.VectorWeight != nil {
			v, e := k.VectorWeight.Float64()
			w, err := k.KeywordWeight.Float64()
			if e != nil || err != nil || !(kbservice.Weights{Vector: v, Keyword: w}).Valid() {
				return domainError()
			}
		}
		seen := map[SourceRef]bool{}
		for _, r := range k.Sources {
			if seen[r] || !referenceName(r.Name) {
				return domainError()
			}
			seen[r] = true
			if r.Namespace != "platform" && (r.Namespace != "team" || !sources[r.Name]) {
				return domainError()
			}
		}
	}
	return nil
}
func (d Document) validateAgents(kbs map[string]bool) error {
	for _, a := range d.Agents {
		if agentProfile(a) != nil || validateConfig(a.Draft, kbs) != nil {
			return domainError()
		}
		seen := map[int32]bool{}
		for _, v := range a.Versions {
			if v.Version < 1 || seen[v.Version] || validateConfig(v.Config, kbs) != nil {
				return domainError()
			}
			seen[v.Version] = true
		}
		if a.PublishedVersion != 0 && !seen[a.PublishedVersion] {
			return domainError()
		}
	}
	return nil
}
func (d Document) validateEvaluations(kbs map[string]bool) error {
	agentsByName := map[string]bool{}
	for _, a := range d.Agents {
		agentsByName[a.Name] = true
	}
	for _, s := range d.EvaluationSets {
		if len(s.Description) > 2000 {
			return domainError()
		}
		if (s.KnowledgeBase == "") == (s.Agent == "") {
			return domainError()
		}
		if s.KnowledgeBase != "" && !kbs[s.KnowledgeBase] || s.Agent != "" && !agentsByName[s.Agent] {
			return domainError()
		}
		if len(s.Cases) > MaxSequenceItems {
			return domainError()
		}
		for _, c := range s.Cases {
			if _, err := (evals.CaseInput{Question: c.Question, Expected: evals.Expected{URLs: c.URLs}, MustMention: c.MustMention, Note: c.Note}).Normalize(); err != nil {
				return domainError()
			}
			for _, u := range c.URLs {
				if !safeURL(strings.TrimSuffix(u, "*")) {
					return domainError()
				}
			}
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
		if !kbs[r.Name] || seen[r.Name] || r.TopK != nil && (*r.TopK < 1 || *r.TopK > 50) {
			return domainError()
		}
		seen[r.Name] = true
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

// This is a credential-marker check, not general secret discovery/DLP. Free
// configuration text is authorized; connection/secret tables are never read.
// Decode bounded encodings to prevent hiding recognizable credential syntax.
func unsafeText(s string, depth int) bool {
	l := strings.ToLower(s)
	for _, marker := range []string{"authorization", "bearer ", "cookie", "password", "signingsecret", "api_key", "api-key", "access_token", "sk-", "-----begin private"} {
		if strings.Contains(l, marker) {
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
