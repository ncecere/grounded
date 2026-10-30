package crawl

import (
	"strings"
	"testing"
)

func TestValidDNSLengths(t *testing.T) {
	l63, l64 := strings.Repeat("a", 63), strings.Repeat("a", 64)
	for host, want := range map[string]bool{
		"example.edu":               true,
		"*.example.edu":             true,
		l63 + ".example.edu":        true,
		"*." + l63 + ".example.edu": true,
		l64 + ".example.edu":        false,
		"hooks." + l64 + ".edu":     false,
		"*." + l64 + ".example.edu": false,
		"a..b":                      false,
		"":                          false,
		strings.Repeat(l63+".", 4):  false, // 256 characters
		strings.Repeat(l63+".", 3) + strings.Repeat("a", 61): true, // 253 characters
	} {
		if got := ValidDNSLengths(host); got != want {
			t.Errorf("ValidDNSLengths(%.40q…, %d chars) = %v, want %v", host, len(host), got, want)
		}
	}
}
