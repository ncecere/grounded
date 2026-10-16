package webhooks

import (
	"strings"
	"testing"
	"time"
)

const (
	testSecret = "whsec_test-secret"
	testBody   = `{"id":"e1","type":"webhook.test"}`
)

var signedAt = time.Unix(1760000000, 0)

// The expected value is computed independently (Python's hmac) so the test does not just agree with the code.
func TestSignMatchesTheDocumentedFormat(t *testing.T) {
	want := "t=1760000000,v1=4a94fb00d94f776165056ed5a9f737f852c5edd1b1cf1017947adcc37b3c97a3"
	if got := Sign(testSecret, signedAt, []byte(testBody)); got != want {
		t.Fatalf("Sign = %s, want %s", got, want)
	}
}

func TestVerify(t *testing.T) {
	good := Sign(testSecret, signedAt, []byte(testBody))
	now := signedAt.Add(time.Minute)
	for _, c := range []struct {
		name   string
		secret string
		header string
		body   string
		now    time.Time
		ok     bool
	}{
		{"the right secret and body", testSecret, good, testBody, now, true},
		{"the edge of the tolerance", testSecret, good, testBody, signedAt.Add(SignatureTolerance), true},
		{"a changed body", testSecret, good, testBody + " ", now, false},
		{"another secret", "whsec_other", good, testBody, now, false},
		{"too old", testSecret, good, testBody, signedAt.Add(SignatureTolerance + time.Second), false},
		{"from the future", testSecret, good, testBody, signedAt.Add(-SignatureTolerance - time.Second), false},
		{"a changed timestamp", testSecret, strings.Replace(good, "t=1760000000", "t=1760000001", 1), testBody, now, false},
		{"no signature", testSecret, "t=1760000000", testBody, now, false},
		{"no timestamp", testSecret, strings.TrimPrefix(good, "t=1760000000,"), testBody, now, false},
		{"garbage", testSecret, "nonsense", testBody, now, false},
		{"empty", testSecret, "", testBody, now, false},
	} {
		if err := Verify(c.secret, c.header, []byte(c.body), c.now, SignatureTolerance); (err == nil) != c.ok {
			t.Errorf("%s: Verify = %v, want ok=%v", c.name, err, c.ok)
		}
	}
}

func TestMatchPattern(t *testing.T) {
	for _, c := range []struct {
		pattern, host string
		want          bool
	}{
		{"hooks.example.edu", "hooks.example.edu", true},
		{"hooks.example.edu", "HOOKS.example.edu.", true},
		{"hooks.example.edu", "evil.hooks.example.edu", false},
		{"hooks.example.edu", "example.edu", false},
		{"*.example.edu", "example.edu", true},
		{"*.example.edu", "a.b.example.edu", true},
		{"*.example.edu", "notexample.edu", false},
		{"*.example.edu", "example.edu.evil.com", false},
		{"hooks.example.edu", "", false},
	} {
		if got := matchPattern(c.pattern, c.host); got != c.want {
			t.Errorf("matchPattern(%q, %q) = %v, want %v", c.pattern, c.host, got, c.want)
		}
	}
}
