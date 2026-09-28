package httpapi

import (
	"testing"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// P-07: a note that only repeats the status (runs cancelled before the
// fix) is not returned; real reasons are.
func TestCrawlNoteDoesNotRepeatStatus(t *testing.T) {
	if got := toAPICrawl(dbgen.WebCrawl{Status: "cancelled", Error: "Cancelled"}).Error; got != "" {
		t.Errorf("legacy note = %q", got)
	}
	if got := toAPICrawl(dbgen.WebCrawl{Status: "cancelled", Error: "The source was paused"}).Error; got != "The source was paused" {
		t.Errorf("reason = %q", got)
	}
}
