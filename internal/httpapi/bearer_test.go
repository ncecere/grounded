package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBearerTokenSchemeAndWhitespace(t *testing.T) {
	const token = "rag_Test_CaseSensitive"
	for _, tc := range []struct {
		header string
		ok     bool
	}{
		{"Bearer " + token, true}, {"bearer " + token, true},
		{"BEARER " + token, true}, {"bEaReR " + token, true},
		{"Bearer   " + token, true},
		{"", false}, {"Bearer", false}, {"Bearer ", false},
		{"Bearer\t" + token, false}, {" Bearer " + token, false},
		{"Basic " + token, false}, {"BearerX " + token, false},
		{"Bearer " + token + " ", false}, {"Bearer " + token + "\t", false},
		{"Bearer " + token + "\r\n", false}, {"Bearer " + token + ",other", false},
		{"Bearer " + token + " another", false}, {"Bearer " + strings.Repeat("a", 506), false},
	} {
		t.Run(tc.header, func(t *testing.T) {
			got, ok := bearerToken(tc.header)
			if ok != tc.ok || (ok && got != token) || (!ok && got != "") {
				t.Fatalf("parse = %q, %v; want accepted=%v and an unchanged token", got, ok, tc.ok)
			}
		})
	}
	// The shared header bound is inclusive, without accepting an oversized token.
	got, ok := bearerToken("Bearer " + strings.Repeat("a", 505))
	if !ok || len(got) != 505 {
		t.Fatal("512-byte header should pass the parser")
	}
}

func TestOAuthBearerSchemeIsCaseInsensitive(t *testing.T) {
	// OAuth access tokens have a prefix and a fixed 43-character random value.
	token := "gat_" + strings.Repeat("a", 43)
	for _, scheme := range []string{"Bearer", "bearer", "BEARER", "bEaReR"} {
		r := httptest.NewRequest("POST", "/mcp", nil)
		r.Header.Set("Authorization", scheme+" "+token)
		if got, ok := bearerAccessToken(r); !ok || got != token {
			t.Fatalf("%s: got %q, %v", scheme, got, ok)
		}
		r.Header.Set("Authorization", scheme+" rag_not_an_oauth_token")
		if _, ok := bearerAccessToken(r); ok {
			t.Fatal("an API key must not enter OAuth authentication")
		}
	}
}
