// Documents that need attention (owner decision 3 of docs/v0.2.0.md §7): a
// platform admin tells a team's owners that documents in one of its sources
// failed or need OCR. Platform admins see counts, never document names, and
// so does the notification: the owners open the source to see which.

package notify

import (
	"fmt"
	"net/url"
	"time"

	"github.com/google/uuid"
)

// DocumentProblems is one source's documents of one reason class.
type DocumentProblems struct {
	SourceID   uuid.UUID
	SourceName string
	// Reason is needs_ocr, ocr_error, damaged or other.
	Reason    string
	Documents int64
	Oldest    time.Time
}

var problemText = map[string]string{
	"needs_ocr": "have pages without text that need OCR",
	"ocr_error": "couldn't be read with OCR",
	"damaged":   "are damaged, password-protected, too large or not a supported type",
	"other":     "failed to index",
}

// ProblemFilter is the status filter of a source's Documents tab that shows
// a reason's documents: Needs OCR, or Failed.
func ProblemFilter(reason string) string {
	if reason == "needs_ocr" {
		return "needs_ocr"
	}
	return "failed"
}

// DocumentsAttentionEvent: a platform admin asked the team's owners to look
// at a source's documents. Mandatory: the admin acted on purpose, and the
// owners are the only ones who can see and fix the documents.
func DocumentsAttentionEvent(t TeamRef, p DocumentProblems) Event {
	what := problemText[p.Reason]
	if what == "" {
		what = problemText["other"]
	}
	n := int(p.Documents)
	q := url.Values{"tab": {"documents"}, "status": {ProblemFilter(p.Reason)}}
	return Event{
		Type: DocumentsAttention, TeamID: t.ID, Link: t.path("/sources/" + p.SourceID.String() + "?" + q.Encode()),
		Title: fmt.Sprintf("%d %s in %s %s (%s)", n, plural(n, "document", "documents"), p.SourceName, plural(n, "needs attention", "need attention"), t.Name),
		Body: fmt.Sprintf("A platform admin asks you to look at %d %s in the data source %s that %s, the oldest since %s. "+
			"Open the source's documents to see which, then retry them or upload them again.",
			n, plural(n, "document", "documents"), p.SourceName, what, day(p.Oldest)),
		Data: map[string]any{"team": t.Slug, "sourceId": p.SourceID, "reason": p.Reason, "documents": p.Documents},
	}
}
