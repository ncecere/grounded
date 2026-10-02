// The gap report's same-subject check (docs/gaps.md, owner decision 4 of
// 2026-10-01): when a team turns on "Confirm similar questions with
// SystemOne", the hourly topics job asks whether two questions that are
// close but not clearly alike by embedding are about the same subject,
// before putting a question in a topic or merging two topics.

package systemone

import (
	"context"
	"time"
)

// FeatureGaps is the same-subject check's feature (usage and metrics).
const FeatureGaps = "gaps"

// QSameSubject is the check's question ID.
const QSameSubject = "same_subject"

// SameSubjectThreshold is the probability at which two questions count as
// one subject.
const SameSubjectThreshold = 0.8

// sameSubjectTimeout bounds the check: a slow check is a no.
const sameSubjectTimeout = 10 * time.Second

var sameSubjects = map[string]Question{
	QSameSubject: Noul("Are `question` and `other_question` about the same subject, so that the same page or document would answer both? "+
		"Different wording, detail or tone doesn't matter; a different service, place, product or process does.",
		"They are about the same subject.",
		"They are about different subjects."),
}

// SameSubjectState is the check's state.
type SameSubjectState struct {
	Question      string `json:"question"`
	OtherQuestion string `json:"other_question"`
}

// SameSubject reports whether two questions are about the same subject.
// An error (or a timeout) means no.
func (cl *Client) SameSubject(ctx context.Context, question, other string) (bool, error) {
	res, err := cl.Ask(ctx, Call{Feature: FeatureGaps, Timeout: sameSubjectTimeout},
		SameSubjectState{Question: question, OtherQuestion: other}, sameSubjects)
	if err != nil {
		return false, err
	}
	return res.Noul(QSameSubject) >= SameSubjectThreshold, nil
}

// PlatformClient returns the client of the platform's SystemOne model, or
// nil when none is set or it is unusable, whatever the features' settings
// (the answer cache's near-identical check and the gap report's
// same-subject check use it).
func (s *Service) PlatformClient(ctx context.Context) (*Client, error) { return s.CacheClient(ctx) }
