package sources

import (
	"strings"
	"testing"
)

// #132: the too_large rejection did not say what the limit is.
func TestTooLargeUploadStatesTheLimit(t *testing.T) {
	res, ok := checkContent("big.md", ".md", &sniffer{n: 100<<20 + 1, head: []byte("# x")}, 100<<20)
	if ok || res.Error == nil || res.Error.Code != "too_large" {
		t.Fatalf("checkContent = %+v %v", res, ok)
	}
	if !strings.Contains(res.Error.Message, "100 MiB") {
		t.Errorf("message does not state the limit: %q", res.Error.Message)
	}
	if res, ok := checkContent("fits.md", ".md", &sniffer{n: 100 << 20, head: []byte("# x")}, 100<<20); !ok {
		t.Errorf("a file at the limit was rejected: %+v", res)
	}
}
