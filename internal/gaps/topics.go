// Topics for the team's editors, admins and owners (the actions are in
// actions.go).

package gaps

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Topic states.
const (
	StateOpen      = "open"
	StateDismissed = "dismissed"
	StateFixed     = "fixed"
	// StateResolved: the topic closed itself when its questions started
	// being answered well.
	StateResolved = "resolved"
)

// trendWeeks is the length of a topic's weekly trend.
const trendWeeks = 8

// Topic is a topic shown to editors: counts, signals, reasons and trend.
type Topic struct {
	dbgen.ListGapTopicsRow
	Signals map[string]int32
	Reasons map[string]int32
	// Trend is questions per week, oldest first.
	Trend []int32
}

// TopicList is a team's (or agent's) topics.
type TopicList struct {
	Topics []Topic
	// Pending counts the last 30 days' failed questions not in a topic
	// shown yet; Ungrouped, those of them the topics job hasn't grouped
	// yet (the rest are in topics below MinAskers).
	Pending, Ungrouped int32
}

// SharedQuestion is a question its asker shared with the team.
type SharedQuestion = dbgen.ListSharedGapQuestionsRow

// Event is a line of a topic's history.
type Event = dbgen.ListGapTopicEventsRow

// TopicDetail is a topic with its shared questions and its history.
type TopicDetail struct {
	Topic   Topic
	Shared  []SharedQuestion
	History []Event
}

// states maps the list filter to topic states (nil: all).
func states(filter string) ([]string, error) {
	switch filter {
	case "", StateOpen:
		return []string{StateOpen}, nil
	case "closed":
		return []string{StateDismissed, StateFixed, StateResolved}, nil
	case "all":
		return []string{}, nil
	}
	return nil, errBadState
}

// List returns the team's topics with at least MinAskers askers,
// optionally one agent's, by state (open, closed or all).
func (s *Service) List(ctx context.Context, a authz.Actor, teamRef string, agentID *uuid.UUID, state string) (TopicList, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return TopicList{}, err
	}
	st, err := states(state)
	if err != nil {
		return TopicList{}, err
	}
	agent := nullID(agentID)
	rows, err := s.q.ListGapTopics(ctx, dbgen.ListGapTopicsParams{TeamID: acc.Team.ID, AgentID: agent, States: st, MinAskers: MinAskers})
	if err != nil {
		return TopicList{}, err
	}
	topics, err := s.decorate(ctx, rows)
	if err != nil {
		return TopicList{}, err
	}
	pending, err := s.q.GapPendingCount(ctx, dbgen.GapPendingCountParams{TeamID: acc.Team.ID, AgentID: agent, MinAskers: MinAskers})
	return TopicList{Topics: topics, Pending: pending.Pending, Ungrouped: pending.Ungrouped}, err
}

// Get returns a topic shown to editors with its shared questions.
func (s *Service) Get(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (TopicDetail, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return TopicDetail{}, err
	}
	t, err := s.topic(ctx, acc.Team.ID, id)
	if err != nil {
		return TopicDetail{}, err
	}
	shared, err := s.q.ListSharedGapQuestions(ctx, uuid.NullUUID{UUID: id, Valid: true})
	if err != nil {
		return TopicDetail{}, err
	}
	history, err := s.q.ListGapTopicEvents(ctx, id)
	return TopicDetail{Topic: t, Shared: shared, History: history}, err
}

// topic loads one visible topic (404 below MinAskers).
func (s *Service) topic(ctx context.Context, teamID, id uuid.UUID) (Topic, error) {
	rows, err := s.q.ListGapTopics(ctx, dbgen.ListGapTopicsParams{TeamID: teamID, TopicID: uuid.NullUUID{UUID: id, Valid: true},
		States: []string{}, MinAskers: MinAskers})
	if err != nil {
		return Topic{}, err
	}
	if len(rows) == 0 {
		return Topic{}, errNoTopic
	}
	out, err := s.decorate(ctx, rows)
	if err != nil {
		return Topic{}, err
	}
	return out[0], nil
}

// decorate adds the topics' signals, thumbs-down reasons and trend.
func (s *Service) decorate(ctx context.Context, rows []dbgen.ListGapTopicsRow) ([]Topic, error) {
	out := make([]Topic, len(rows))
	ids := make([]uuid.UUID, len(rows))
	byID := map[uuid.UUID]*Topic{}
	for i, r := range rows {
		out[i] = Topic{ListGapTopicsRow: r, Signals: map[string]int32{}, Reasons: map[string]int32{}, Trend: make([]int32, trendWeeks)}
		ids[i] = r.ID
		byID[r.ID] = &out[i]
	}
	if len(rows) == 0 {
		return out, nil
	}
	sigs, err := s.q.GapTopicSignals(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range sigs {
		byID[r.TopicID].Signals[r.Signal] = r.N
	}
	reasons, err := s.q.GapTopicReasons(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range reasons {
		byID[r.TopicID].Reasons[r.Reason] = r.N
	}
	trend, err := s.q.GapTopicTrend(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range trend {
		if r.WeeksAgo >= 0 && r.WeeksAgo < trendWeeks {
			byID[r.TopicID].Trend[trendWeeks-1-r.WeeksAgo] += r.N
		}
	}
	return out, nil
}
