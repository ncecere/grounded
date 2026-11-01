// Package teamconfig validates bounded, strict portable team configuration and
// exports authorized snapshots without content, secrets or side effects.
// DecodeEnvelope remains a syntax-only boundary; use DecodeDocument for domain
// validation. Export always runs the full document validator before download.
package teamconfig

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/ncecere/grounded/internal/displaytext"
	"gopkg.in/yaml.v3"
)

const (
	Version          = "grounded.team/v1"
	MaxBytes         = 1 << 20
	MaxDepth         = 16
	MaxNodes         = 20000
	MaxScalarBytes   = 64 << 10
	MaxSequenceItems = 1000
	MaxResources     = 500
)

// SyntaxError intentionally excludes input values and third-party parser errors:
// either can contain credentials. Paths use structural ordinals, not input keys.
type SyntaxError struct {
	Code         string
	Path         string
	Line, Column int
}

func (e *SyntaxError) Error() string {
	return fmt.Sprintf("%s at %s (line %d, column %d)", e.Code, e.Path, e.Line, e.Column)
}

func invalid(code, path string, n *yaml.Node) error {
	e := &SyntaxError{Code: code, Path: path}
	if n != nil {
		e.Line = n.Line
		e.Column = n.Column
	}
	return e
}

// DecodeEnvelope reads one bounded YAML team envelope and returns deterministic
// JSON for the future strict resource-schema stage. A successful result remains
// untrusted input, not a plan or an export-safe representation. Arrays retain
// their order; only JSON mapping keys are sorted. No network or persistence work
// is possible here. All six envelope fields are required; null is unsupported.
func DecodeEnvelope(r io.Reader) (json.RawMessage, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxBytes+1))
	if err != nil {
		return nil, invalid("read_failed", "$", nil)
	}
	if len(raw) > MaxBytes {
		return nil, invalid("size_limit", "$", nil)
	}
	dec := yaml.NewDecoder(strings.NewReader(string(raw)))
	var doc yaml.Node
	if err := dec.Decode(&doc); err != nil {
		return nil, invalid("invalid_yaml", "$", nil)
	}
	var extra yaml.Node
	if dec.Decode(&extra) != io.EOF {
		return nil, invalid("single_document_required", "$", nil)
	}
	if len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, invalid("mapping_required", "$", &doc)
	}
	count := 0
	value, err := readNode(doc.Content[0], "$", 0, &count)
	if err != nil {
		return nil, err
	}
	envelope := value.(map[string]any)
	if err := checkEnvelope(envelope); err != nil {
		return nil, err
	}
	out, err := json.Marshal(envelope)
	if err != nil {
		return nil, invalid("invalid_value", "$", nil)
	}
	return out, nil
}

var jsonNumber = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`)

func readNode(n *yaml.Node, path string, depth int, count *int) (any, error) {
	*count++
	if depth > MaxDepth || *count > MaxNodes {
		return nil, invalid("structure_limit", path, n)
	}
	if n.Anchor != "" || n.Kind == yaml.AliasNode {
		return nil, invalid("aliases_forbidden", path, n)
	}
	if n.Style&yaml.TaggedStyle != 0 {
		return nil, invalid("explicit_tag_forbidden", path, n)
	}
	switch n.Kind {
	case yaml.MappingNode:
		return readMap(n, path, depth, count)
	case yaml.SequenceNode:
		if len(n.Content) > MaxSequenceItems {
			return nil, invalid("item_limit", path, n)
		}
		out := make([]any, len(n.Content))
		for i, child := range n.Content {
			v, err := readNode(child, fmt.Sprintf("%s[%d]", path, i), depth+1, count)
			if err != nil {
				return nil, err
			}
			out[i] = v
		}
		return out, nil
	case yaml.ScalarNode:
		return readScalar(n, path)
	default:
		return nil, invalid("invalid_node", path, n)
	}
}

func readMap(n *yaml.Node, path string, depth int, count *int) (any, error) {
	out := make(map[string]any, len(n.Content)/2)
	for i := 0; i < len(n.Content); i += 2 {
		key := n.Content[i]
		keyPath := fmt.Sprintf("%s.key[%d]", path, i/2)
		// Count and validate keys just like values; never interpret merge keys.
		if _, err := readNode(key, keyPath, depth+1, count); err != nil {
			return nil, err
		}
		if key.Kind != yaml.ScalarNode || key.Tag != "!!str" {
			return nil, invalid("string_key_required", keyPath, key)
		}
		if _, exists := out[key.Value]; exists {
			return nil, invalid("duplicate_key", keyPath, key)
		}
		v, err := readNode(n.Content[i+1], fmt.Sprintf("%s.value[%d]", path, i/2), depth+1, count)
		if err != nil {
			return nil, err
		}
		out[key.Value] = v
	}
	return out, nil
}

func readScalar(n *yaml.Node, path string) (any, error) {
	if len(n.Value) > MaxScalarBytes {
		return nil, invalid("scalar_limit", path, n)
	}
	switch n.Tag {
	case "!!str":
		return n.Value, nil
	case "!!bool":
		if n.Value == "true" {
			return true, nil
		}
		if n.Value == "false" {
			return false, nil
		}
	case "!!int", "!!float":
		if jsonNumber.MatchString(n.Value) {
			// Preserve numeric precision; no conversion through float64.
			return json.Number(n.Value), nil
		}
	}
	return nil, invalid("json_scalar_required", path, n)
}

var resourceFields = []string{"sources", "knowledgeBases", "agents", "evaluationSets", "webhooks"}

func checkEnvelope(m map[string]any) error {
	if v, ok := m["apiVersion"].(string); !ok || v != Version {
		return invalid("unsupported_version", "$.apiVersion", nil)
	}
	if len(m) != len(resourceFields)+1 {
		return invalid("envelope_fields", "$", nil)
	}
	total := 0
	for _, field := range resourceFields {
		items, ok := m[field].([]any)
		if !ok {
			return invalid("resource_array_required", "$."+field, nil)
		}
		total += len(items)
		if total > MaxResources {
			return invalid("resource_limit", "$", nil)
		}
		if err := checkNames(items, "$."+field); err != nil {
			return err
		}
	}
	return nil
}

func checkNames(items []any, path string) error {
	seen := map[string]bool{}
	for i, item := range items {
		p := fmt.Sprintf("%s[%d]", path, i)
		m, ok := item.(map[string]any)
		if !ok {
			return invalid("resource_mapping_required", p, nil)
		}
		name, ok := m["name"].(string)
		if !ok || len(name) < 1 || len(name) > 100 || strings.TrimSpace(name) != name {
			return invalid("invalid_name", p+".name", nil)
		}
		if displaytext.Validate(name, "invalid_name", "Name") != nil {
			return invalid("invalid_name", p+".name", nil)
		}
		if seen[name] {
			return invalid("duplicate_name", p+".name", nil)
		}
		seen[name] = true
	}
	return nil
}
