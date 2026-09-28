package crawl

import (
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	for _, tt := range []struct{ raw, want string }{
		// Ported from yoink (adapted: queries are now sorted).
		{"HTTPS://EXAMPLE.COM:443/Docs/%2fFile?a=2&a=1#part", "https://example.com/Docs/%2FFile?a=1&a=2"},
		{"http://Example.com.:80", "http://example.com/"},
		{"https://[2606:4700:4700:0:0:0:0:1111]:443/", "https://[2606:4700:4700::1111]/"},
		{"https://bücher.example/", "https://xn--bcher-kva.example/"},
		{"HTTPS://BÜCHER.example.:443/Docs#x", "https://xn--bcher-kva.example/Docs"},
		// Ports.
		{"https://example.com:80/", "https://example.com:80/"},
		{"http://example.com:443/", "http://example.com:443/"},
		{"http://example.com:0080/a", "http://example.com/a"},
		{"https://example.com:8443", "https://example.com:8443/"},
		// Dot segments (literal and %2e).
		{"https://example.com/a/b/../c/./d", "https://example.com/a/c/d"},
		{"https://example.com/a/%2e%2E/b", "https://example.com/b"},
		{"https://example.com/../../x", "https://example.com/x"},
		{"https://example.com/a/b/..", "https://example.com/a/"},
		{"https://example.com/a/.", "https://example.com/a/"},
		{"https://example.com", "https://example.com/"},
		// Escapes: upper-cased, unreserved decoded, unsafe bytes encoded.
		{"https://example.com/%7euser/%41b%2f", "https://example.com/~user/Ab%2F"},
		{"https://example.com/a b/ü", "https://example.com/a%20b/%C3%BC"},
		// Tracking params removed; others sorted.
		{"https://example.com/p?utm_source=x&b=2&UTM_Medium=y&a=1&gclid=1&fbclid=2&mc_cid=3&mc_eid=4", "https://example.com/p?a=1&b=2"},
		{"https://example.com/?%75tm_source=x&z=%2b&a=%20", "https://example.com/?a=%20&z=%2B"},
		{"https://example.com/?utm_source=x", "https://example.com/"},
		{"https://example.com/?", "https://example.com/"},
		{"https://example.com/?b=2&&a=1&utm=keep", "https://example.com/?a=1&b=2&utm=keep"},
		{"https://example.com/?q=a+b&flag", "https://example.com/?flag&q=a+b"},
		// Legacy IPv4 notations become dotted quads.
		{"http://2130706433/", "http://127.0.0.1/"},
		{"http://0177.0.0.1/", "http://127.0.0.1/"},
		{"http://0x7f.1/", "http://127.0.0.1/"},
		{"http://127.1/", "http://127.0.0.1/"},
		{"http://0x7f000001/", "http://127.0.0.1/"},
		{"http://[::ffff:127.0.0.1]/", "http://[::ffff:127.0.0.1]/"},
		{" https://example.com/a\n ", "https://example.com/a"},
	} {
		got, err := Normalize(tt.raw)
		if err != nil || got != tt.want {
			t.Errorf("Normalize(%q) = %q, %v; want %q", tt.raw, got, err, tt.want)
			continue
		}
		again, err := Normalize(got)
		if err != nil || again != got {
			t.Errorf("not idempotent: %q -> %q %v", got, again, err)
		}
	}
	for _, raw := range []string{
		"", "example.com", "/relative", "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c",
		"https://user:pass@example.com/", "https://user@example.com/", "http://example.com:/", "http://example.com:99999/",
		"http://[fe80::1%25eth0]/", "http://a..com/", "https://example.com/" + strings.Repeat("a", 8192), "https://bad_host/",
		"http://a\\b/", "http://-bad.com/", "http://1.2.3.256/", "http://example.123/", "http://0x100000000/", "http://1.2.3.4.5/",
	} {
		if got, err := Normalize(raw); err == nil {
			t.Errorf("accepted %q as %q", raw, got)
		}
	}
}

func TestIsTrackingParam(t *testing.T) {
	for _, k := range []string{"utm_source", "UTM_campaign", "gclid", "fbclid", "mc_cid", "mc_eid"} {
		if !IsTrackingParam(k) {
			t.Errorf("%s not tracking", k)
		}
	}
	for _, k := range []string{"utm", "id", "q", "page"} {
		if IsTrackingParam(k) {
			t.Errorf("%s tracking", k)
		}
	}
}
