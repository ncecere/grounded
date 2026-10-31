package teamconfig

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"testing"
)

const empty = "apiVersion: grounded.team/v1\nsources: []\nknowledgeBases: []\nagents: []\nevaluationSets: []\nwebhooks: []\n"

func TestEnvelope(t *testing.T) {
	in := strings.Replace(empty, "sources: []", "sources:\n  - name: Guide\n    settings: {enabled: true, count: 2, ratio: 0.5}", 1)
	got, err := DecodeEnvelope(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"agents":[],"apiVersion":"grounded.team/v1","evaluationSets":[],"knowledgeBases":[],"sources":[{"name":"Guide","settings":{"count":2,"enabled":true,"ratio":0.5}}],"webhooks":[]}`
	if string(got) != want {
		t.Fatalf("got %s", got)
	}
	reordered := strings.Replace(in, "enabled: true, count: 2, ratio: 0.5", "ratio: 0.5, count: 2, enabled: true", 1)
	other, err := DecodeEnvelope(strings.NewReader(reordered))
	if err != nil || !bytes.Equal(got, other) {
		t.Fatalf("not deterministic: %s, %v", other, err)
	}
	got[0] = 'X'
	again, err := DecodeEnvelope(strings.NewReader(in))
	if err != nil || !bytes.Equal(again, other) {
		t.Fatal("output aliases previous result")
	}
}

func TestRejectEnvelope(t *testing.T) {
	tests := map[string]string{
		"empty": "", "array": "[]", "scalar": "hello", "null": "null",
		"second": empty + "---\n{}\n", "empty second": empty + "---\n",
		"unknown": empty + "surprise: []\n", "missing": "sources: []\n",
		"version":          strings.Replace(empty, "grounded.team/v1", "grounded.team/v2", 1),
		"version type":     strings.Replace(empty, "grounded.team/v1", "1", 1),
		"duplicate field":  empty + "sources: []\n",
		"anchor":           strings.Replace(empty, "sources: []", "sources: &s []", 1),
		"alias":            empty + "x: *s\n",
		"merge":            empty + "<<: {}\n",
		"tag":              strings.Replace(empty, "sources: []", "sources: !include []", 1),
		"explicit tag":     strings.Replace(empty, "sources: []", "sources: !!seq []", 1),
		"not sequence":     strings.Replace(empty, "sources: []", "sources: {}", 1),
		"resource scalar":  strings.Replace(empty, "sources: []", "sources: [a]", 1),
		"no name":          strings.Replace(empty, "sources: []", "sources: [{}]", 1),
		"name type":        strings.Replace(empty, "sources: []", "sources: [{name: 1}]", 1),
		"padded name":      strings.Replace(empty, "sources: []", "sources: [{name: ' a '}]", 1),
		"hidden name":      strings.Replace(empty, "sources: []", "sources: [{name: \"a\\u202eb\"}]", 1),
		"duplicate name":   strings.Replace(empty, "sources: []", "sources: [{name: a}, {name: a}]", 1),
		"nested duplicate": strings.Replace(empty, "sources: []", "sources: [{name: a, x: {k: 1, k: 2}}]", 1),
		"nonstring key":    strings.Replace(empty, "sources: []", "sources: [{name: a, x: {1: value}}]", 1),
		"nan":              strings.Replace(empty, "sources: []", "sources: [{name: a, x: .nan}]", 1),
		"timestamp":        strings.Replace(empty, "sources: []", "sources: [{name: a, x: 2026-10-31}]", 1),
		"hex":              strings.Replace(empty, "sources: []", "sources: [{name: a, x: 0x10}]", 1),
		"null setting":     strings.Replace(empty, "sources: []", "sources: [{name: a, x: null}]", 1),
		"syntax":           "apiVersion: [",
	}
	for name, in := range tests {
		t.Run(name, func(t *testing.T) {
			out, err := DecodeEnvelope(strings.NewReader(in))
			if err == nil || out != nil {
				t.Fatalf("accepted invalid input: %s %v", out, err)
			}
		})
	}
}

func TestBounds(t *testing.T) {
	resources := strings.Repeat("{name: a},", MaxResources+1)
	cases := []string{
		strings.Repeat(" ", MaxBytes+1),
		strings.Replace(empty, "sources: []", "sources: [{name: a, x: '"+strings.Repeat("a", MaxScalarBytes+1)+"'}]", 1),
		strings.Replace(empty, "sources: []", "sources: [{name: a, x: "+strings.Repeat("[", MaxDepth+1)+"0"+strings.Repeat("]", MaxDepth+1)+"}]", 1),
		strings.Replace(empty, "sources: []", "sources: ["+resources+"]", 1),
		strings.Replace(empty, "sources: []", "sources: [{name: a, x: ["+strings.Repeat("0,", MaxSequenceItems+1)+"]}]", 1),
	}
	for i, in := range cases {
		if out, err := DecodeEnvelope(strings.NewReader(in)); err == nil || out != nil {
			t.Fatalf("bound %d: %s %v", i, out, err)
		}
	}
}

func TestErrorsDoNotEchoValues(t *testing.T) {
	secret := "canary-private-token"
	for _, canary := range []string{secret, url.QueryEscape(secret + "@:/"), base64.StdEncoding.EncodeToString([]byte(secret))} {
		for _, in := range []string{
			empty + canary + ": value\n",
			strings.Replace(empty, "sources: []", "sources: [{name: '"+canary+"', x: !"+canary+" value}]", 1),
			"apiVersion: [" + canary,
			strings.Replace(empty, "sources: []", "sources: [{name: a, '"+canary+"': 1, '"+canary+"': 2}]", 1),
		} {
			_, err := DecodeEnvelope(strings.NewReader(in))
			if err == nil || strings.Contains(err.Error(), canary) {
				t.Fatalf("unsafe error: %v", err)
			}
		}
	}
}

type failReader struct{}

func (failReader) Read([]byte) (int, error) { return 0, errors.New("credential-canary") }
func TestReaderFailure(t *testing.T) {
	_, err := DecodeEnvelope(failReader{})
	if err == nil || strings.Contains(err.Error(), "credential-canary") {
		t.Fatalf("unsafe reader error: %v", err)
	}
}

func TestResourceKindsHaveSeparateNames(t *testing.T) {
	in := strings.Replace(empty, "sources: []", "sources: [{name: a}]", 1)
	in = strings.Replace(in, "agents: []", "agents: [{name: a}]", 1)
	if _, err := DecodeEnvelope(strings.NewReader(in)); err != nil {
		t.Fatal(err)
	}
}

func TestReadIsBounded(t *testing.T) {
	r := &countReader{Reader: strings.NewReader(strings.Repeat("x", MaxBytes*2))}
	if _, err := DecodeEnvelope(r); err == nil {
		t.Fatal("accepted oversize")
	}
	if r.n > MaxBytes+1 {
		t.Fatalf("read %d", r.n)
	}
}

type countReader struct {
	io.Reader
	n int
}

func (r *countReader) Read(p []byte) (int, error) { n, e := r.Reader.Read(p); r.n += n; return n, e }

func FuzzEnvelope(f *testing.F) {
	for _, s := range []string{empty, "", "[]", "a: &x [*x]", "---\n{}\n---\n{}"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		out, err := DecodeEnvelope(strings.NewReader(s))
		if err != nil && out != nil {
			t.Fatal("partial result")
		}
	})
}

func TestNodeBudgetAcrossResources(t *testing.T) {
	var resources []string
	for i := 0; i < 20; i++ {
		resources = append(resources, fmt.Sprintf("{name: n%d, values: [%s]}", i, strings.Repeat("0,", 1000)))
	}
	in := strings.Replace(empty, "sources: []", "sources: ["+strings.Join(resources, ",")+"]", 1)
	_, err := DecodeEnvelope(strings.NewReader(in))
	var syntax *SyntaxError
	if !errors.As(err, &syntax) || syntax.Code != "structure_limit" {
		t.Fatalf("node cap: %v", err)
	}
}

func TestResourceBudgetAcrossKinds(t *testing.T) {
	var resources []string
	for i := 0; i < MaxResources; i++ {
		resources = append(resources, fmt.Sprintf("{name: n%d}", i))
	}
	in := strings.Replace(empty, "sources: []", "sources: ["+strings.Join(resources, ",")+"]", 1)
	if _, err := DecodeEnvelope(strings.NewReader(in)); err != nil {
		t.Fatalf("at cap: %v", err)
	}
	in = strings.Replace(in, "agents: []", "agents: [{name: last}]", 1)
	_, err := DecodeEnvelope(strings.NewReader(in))
	var syntax *SyntaxError
	if !errors.As(err, &syntax) || syntax.Code != "resource_limit" {
		t.Fatalf("total cap: %v", err)
	}
}

func TestScalarTypesAndNames(t *testing.T) {
	for _, value := range []string{"true", "false", "-1", "0.1", "1e20", "'null'", "'2026-10-31'", "'{{not a template}}'"} {
		in := strings.Replace(empty, "sources: []", "sources: [{name: Guide, value: "+value+"}]", 1)
		if _, err := DecodeEnvelope(strings.NewReader(in)); err != nil {
			t.Fatalf("valid %s: %v", value, err)
		}
	}
	for _, name := range []string{"''", "'" + strings.Repeat("n", 101) + "'"} {
		in := strings.Replace(empty, "sources: []", "sources: [{name: "+name+"}]", 1)
		if _, err := DecodeEnvelope(strings.NewReader(in)); err == nil {
			t.Fatal("invalid name accepted")
		}
	}
	in := strings.Replace(empty, "sources: []", "sources: [{name: Guide, enabled: TRUE}]", 1)
	if _, err := DecodeEnvelope(strings.NewReader(in)); err == nil {
		t.Fatal("non-JSON boolean accepted")
	}
}

func TestStructuralErrorLocation(t *testing.T) {
	in := strings.Replace(empty, "sources: []", "sources: [{name: a, value: !private ignored}]", 1)
	_, err := DecodeEnvelope(strings.NewReader(in))
	var syntax *SyntaxError
	if !errors.As(err, &syntax) || syntax.Code != "explicit_tag_forbidden" ||
		syntax.Path != "$.value[1][0].value[1]" || syntax.Line != 2 || syntax.Column == 0 {
		t.Fatalf("location: %#v", syntax)
	}
}

func TestSyntaxSuccessDoesNotMeanResourceValidation(t *testing.T) {
	// Deliberately pin the checkpoint boundary. Never use this API as a validated
	// plan: it knows nothing about source setting allowlists or permitted secrets.
	in := strings.Replace(empty, "sources: []", "sources: [{name: a, unknownSetting: must-be-rejected-by-next-stage}]", 1)
	if _, err := DecodeEnvelope(strings.NewReader(in)); err != nil {
		t.Fatal(err)
	}
}
