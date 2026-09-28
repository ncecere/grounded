package public

import (
	"bytes"
	"strings"
	"testing"
)

func TestKeyFormat(t *testing.T) {
	key, id := NewKey()
	if !strings.HasPrefix(key, "pk_"+id+"_") || len(key) != 3+12+1+32 {
		t.Fatalf("key %q id %q", key, id)
	}
	got, ok := ParseKey("  " + key + " ")
	if !ok || got != id {
		t.Fatalf("parse %q: %q %v", key, got, ok)
	}
	for _, bad := range []string{"", "pk_", "rag_" + key[3:], key + "x", key[:len(key)-1], strings.Replace(key, "_", "-", 2),
		"pk_" + strings.Repeat("!", 12) + "_" + strings.Repeat("a", 32), "pk_" + strings.Repeat("a", 13) + strings.Repeat("a", 32)} {
		if _, ok := ParseKey(bad); ok {
			t.Errorf("ParseKey(%q) accepted", bad)
		}
	}
	if KeyDisplay(id) != "pk_"+id+"_…" {
		t.Error(KeyDisplay(id))
	}
}

func TestHashKey(t *testing.T) {
	p1, p2 := []byte("pepper-one"), []byte("pepper-two")
	a := HashKey(p1, "pk_x")
	if !bytes.Equal(a, HashKey(p1, "pk_x")) {
		t.Fatal("not deterministic")
	}
	if bytes.Equal(a, HashKey(p2, "pk_x")) || bytes.Equal(a, HashKey(p1, "pk_y")) || len(a) != 32 {
		t.Fatal("digest must depend on the pepper and the key")
	}
}

func TestNormalizeAllowedOrigins(t *testing.T) {
	got, err := NormalizeAllowedOrigins([]string{"https://WWW.Example.edu/", "https://www.example.edu:443", "*.example.edu",
		"http://127.0.0.1:8095", "https://apps.example.edu:8443", " ", "http://localhost:80"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"https://www.example.edu", "https://*.example.edu", "http://127.0.0.1:8095", "https://apps.example.edu:8443", "http://localhost"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("got %v", got)
	}
	for _, bad := range []string{"https://example.edu/path", "ftp://example.edu", "https://*.edu", "https://a.*.edu", "https://ex ample.edu",
		"https://example.edu?x=1", "https://user@example.edu", "https://example.edu:0", "https://example.edu:70000", "https://-a.example.edu", "*"} {
		if _, err := NormalizeAllowedOrigins([]string{bad}); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	many := make([]string, 21)
	for i := range many {
		many[i] = "https://h" + string(rune('a'+i)) + ".example.edu"
	}
	if _, err := NormalizeAllowedOrigins(many); err == nil {
		t.Error("21 origins accepted")
	}
}

// F-08: a missing scheme is http for the local machine and https
// otherwise; the saved value is reported; problems are named.
func TestOriginSchemesAndProblems(t *testing.T) {
	got, changes, err := NormalizeOrigins([]string{"localhost:8095", "127.0.0.1:8095", "[::1]:3000", "app.localhost", "www.example.edu", "https://www.example.edu"})
	if err != nil {
		t.Fatal(err)
	}
	want := "http://localhost:8095 http://127.0.0.1:8095 http://[::1]:3000 http://app.localhost https://www.example.edu"
	if strings.Join(got, " ") != want {
		t.Errorf("got %v", got)
	}
	if len(changes) != 5 || changes[0] != (OriginChange{Input: "localhost:8095", Origin: "http://localhost:8095"}) {
		t.Errorf("changes = %+v", changes)
	}
	for in, problem := range map[string]string{
		"https://example.edu/page":  "no path",
		"https://example.edu?x=1":   "no query",
		"ftp://example.edu":         "http:// or https://",
		"https://user@example.edu":  "no user name",
		"https://example.edu:70000": "port",
		"https://ex_ample.edu":      "host",
		"https://a.*.edu":           "wildcard",
	} {
		c := CheckOrigins([]string{in})
		if len(c) != 1 || c[0].Origin != "" || !strings.Contains(c[0].Problem, problem) {
			t.Errorf("%s: %+v, want a problem mentioning %q", in, c, problem)
		}
	}
	if c := CheckOrigins([]string{" ", "Example.EDU"}); len(c) != 1 || c[0].Origin != "https://example.edu" || c[0].Problem != "" {
		t.Errorf("check = %+v", c)
	}
}

func TestMatchOrigin(t *testing.T) {
	allowed := []string{"https://www.example.edu", "https://*.dept.example.edu", "http://127.0.0.1:8095", "https://apps.example.edu:8443"}
	cases := map[string]bool{
		"https://www.example.edu":             true,
		"https://WWW.example.edu:443":         true,  // default port
		"http://www.example.edu":              false, // scheme
		"https://www.example.edu:8443":        false, // port
		"https://example.edu":                 false,
		"https://a.dept.example.edu":          true,
		"https://b.a.dept.example.edu":        true,  // any depth
		"https://dept.example.edu":            false, // the wildcard is subdomains only
		"https://evildept.example.edu":        false,
		"https://a.dept.example.edu.evil.com": false,
		"https://a.dept.example.edu:8443":     false,
		"http://127.0.0.1:8095":               true,
		"http://127.0.0.1:8096":               false,
		"https://apps.example.edu:8443":       true,
		"https://apps.example.edu":            false,
		"null":                                false,
		"":                                    false,
	}
	for o, want := range cases {
		if got := MatchOrigin(o, allowed); got != want {
			t.Errorf("MatchOrigin(%q) = %v, want %v", o, got, want)
		}
	}
	if OriginOf("https://www.example.edu/page?q=1") != "https://www.example.edu" || OriginOf("not a url") != "" {
		t.Error("OriginOf")
	}
	if got := FrameAncestors([]string{"https://www.example.edu", "https://*.example.edu"}); got != "'self' https://www.example.edu https://*.example.edu" {
		t.Error(got)
	}
}
