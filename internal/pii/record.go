package pii

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// States of a document's possible personal data (documents.metadata.pii.state).
const (
	StateFlagged   = "flagged"   // indexed, waiting for an editor's review
	StateHeld      = "held"      // not indexed until an editor approves it (its classification is one to hold)
	StateDismissed = "dismissed" // an editor reviewed it and kept it as it is
	StateApproved  = "approved"  // an editor approved a held document; it is indexed
)

// ErrReview stops indexing a document held for review; ingestion records it as skipped with ErrorCode.
var ErrReview = errors.New("held for a review of possible personal data")

// ErrorCode is the document error code of a held document.
const ErrorCode = "pii_review"

// Record is documents.metadata.pii: what was found (never the matches), its hash, and the review. A review applies
// to the findings it saw: when a new version of the document finds something else, it is reviewed again.
type Record struct {
	Findings   []Finding  `json:"findings"`
	Hash       string     `json:"hash"`
	State      string     `json:"state"`
	ReviewedBy *uuid.UUID `json:"reviewedBy,omitempty"`
	ReviewedAt *time.Time `json:"reviewedAt,omitempty"`
}

// Hash identifies a set of findings (kinds, counts and pages), for keeping a review while nothing changed.
func Hash(findings []Finding) string {
	raw, _ := json.Marshal(findings)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Decide is the record after a scan: none without findings; the earlier review kept when the findings are the same;
// otherwise flagged, or held when the document's classification is one to hold.
func Decide(prev *Record, findings []Finding, hold bool) *Record {
	if len(findings) == 0 {
		return nil
	}
	h := Hash(findings)
	if prev != nil && prev.Hash == h && (prev.State == StateDismissed || prev.State == StateApproved) {
		kept := *prev
		kept.Findings = findings
		return &kept
	}
	if prev != nil && prev.Hash == h && prev.State == StateFlagged && !hold {
		return prev
	}
	state := StateFlagged
	if hold {
		state = StateHeld
	}
	return &Record{Findings: findings, Hash: h, State: state}
}

// FromMetadata reads a document's record (nil when it has none).
func FromMetadata(meta json.RawMessage) *Record {
	var m struct {
		PII *Record `json:"pii"`
	}
	if json.Unmarshal(meta, &m) != nil {
		return nil
	}
	return m.PII
}

// kindLabels name the built-in kinds in a sentence.
var kindLabels = map[string][2]string{
	KindUSSSN:       {"possible US Social Security number", "possible US Social Security numbers"},
	KindPaymentCard: {"possible payment card number", "possible payment card numbers"},
}

// Summary says what was found, for a document's message: "3 possible US Social Security numbers on pages 2 and 4".
func Summary(findings []Finding) string {
	parts := make([]string, 0, len(findings))
	for _, f := range findings {
		label, ok := kindLabels[f.Kind]
		noun := label[1]
		if f.Count == 1 {
			noun = label[0]
		}
		if !ok {
			noun = "matches of “" + f.Kind + "”"
			if f.Count == 1 {
				noun = "match of “" + f.Kind + "”"
			}
		}
		s := fmt.Sprintf("%d %s", f.Count, noun)
		switch len(f.Pages) {
		case 0:
		case 1:
			s += fmt.Sprintf(" on page %d", f.Pages[0])
		default:
			pages := make([]string, len(f.Pages))
			for i, p := range f.Pages {
				pages[i] = fmt.Sprint(p)
			}
			s += " on pages " + strings.Join(pages[:len(pages)-1], ", ") + " and " + pages[len(pages)-1]
		}
		parts = append(parts, s)
	}
	return strings.Join(parts, "; ")
}

// Holds reports whether a classification is one whose flagged documents wait for approval.
func Holds(blockLevels []string, classification string) bool {
	return slices.Contains(blockLevels, classification)
}
