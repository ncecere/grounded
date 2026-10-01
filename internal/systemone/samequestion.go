// The answer cache's same-question check (docs/answer-cache.md): a cached
// question near a new one by embedding is reused only when SystemOne says
// both ask the same thing, so "hours on Saturday" never gets the answer to
// "hours on Sunday".

package systemone

import (
	"context"
	"time"
)

// FeatureCache is the same-question check's feature (usage and metrics).
const FeatureCache = "cache"

// QSameQuestion is the check's question ID.
const QSameQuestion = "same_question"

// SameQuestionThreshold is the probability at which two questions count
// as the same.
const SameQuestionThreshold = 0.8

// sameQuestionTimeout bounds the check: a slow check is a miss.
const sameQuestionTimeout = 3 * time.Second

var sameQuestions = map[string]Question{
	QSameQuestion: Noul("Do `question` and `cached_question` ask for exactly the same information, so that one answer fits both "+
		"word for word? A different day, date, time, place, person, number, programme, product or detail makes them different questions.",
		"They ask the same thing in other words.",
		"They ask about something different, even if only one detail differs."),
}

// SameQuestionState is the check's state.
type SameQuestionState struct {
	Question       string `json:"question"`
	CachedQuestion string `json:"cached_question"`
}

// SameQuestion reports whether question asks the same as cached, and the
// probability. An error (or a timeout) means no.
func (cl *Client) SameQuestion(ctx context.Context, question, cached string) (bool, float64, error) {
	res, err := cl.Ask(ctx, Call{Feature: FeatureCache, Timeout: sameQuestionTimeout},
		SameQuestionState{Question: question, CachedQuestion: cached}, sameQuestions)
	if err != nil {
		return false, 0, err
	}
	p := res.Noul(QSameQuestion)
	return p >= SameQuestionThreshold, p, nil
}

// CacheClient returns the client of the platform's SystemOne model, or nil
// when none is set or it is unusable (near-identical matching is then off).
// It doesn't depend on the features' settings.
func (s *Service) CacheClient(ctx context.Context) (*Client, error) {
	st, err := s.Load(ctx)
	if err != nil || st.ModelID == nil {
		return nil, err
	}
	return s.usableClient(ctx, *st.ModelID)
}
