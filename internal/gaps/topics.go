// Topics for the team's editors, admins and owners, and their actions.

package gaps

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/store"
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
	// shown yet.
	Pending int32
}

// SharedQuestion is a question its asker shared with the team.
type SharedQuestion = dbgen.ListSharedGapQuestionsRow

// TopicDetail is a topic with its shared questions.
type TopicDetail struct {
	Topic  Topic
	Shared []SharedQuestion
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
	return TopicList{Topics: topics, Pending: pending}, err
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
	return TopicDetail{Topic: t, Shared: shared}, err
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

// Dismiss closes a topic with an optional reason (audited).
func (s *Service) Dismiss(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, reason string) (Topic, error) {
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) > 500 {
		return Topic{}, errLongNote
	}
	return s.setState(ctx, a, teamRef, id, StateDismissed, reason)
}

// Fix marks a topic fixed (audited).
func (s *Service) Fix(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Topic, error) {
	return s.setState(ctx, a, teamRef, id, StateFixed, "")
}

// setState records a person's dismissal or fix of an open topic.
func (s *Service) setState(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, state, reason string) (Topic, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Topic{}, err
	}
	if _, err := s.topic(ctx, acc.Team.ID, id); err != nil {
		return Topic{}, err
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockGapTopic(ctx, dbgen.LockGapTopicParams{ID: id, TeamID: acc.Team.ID})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoTopic
		} else if err != nil {
			return err
		}
		if cur.State != StateOpen {
			return errClosedNow
		}
		if err := q.SetGapTopicState(ctx, dbgen.SetGapTopicStateParams{ID: id, State: state, StateReason: reason,
			StateChangedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}}); err != nil {
			return err
		}
		meta := map[string]any{"agentId": cur.AgentID, "from": cur.State, "to": state}
		if reason != "" {
			meta["reason"] = reason
		}
		return audited(ctx, q, a, "gap_topic."+map[string]string{StateDismissed: "dismiss", StateFixed: "fix"}[state], acc.Team.ID, id, meta)
	})
	if err != nil {
		return Topic{}, err
	}
	return s.topic(ctx, acc.Team.ID, id)
}

// AddSource records that an editor went to add a source for the topic
// (audited); the app opens Data sources with the topic as a note.
func (s *Service) AddSource(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Topic, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Topic{}, err
	}
	t, err := s.topic(ctx, acc.Team.ID, id)
	if err != nil {
		return Topic{}, err
	}
	err = audited(ctx, s.q, a, "gap_topic.add_source", acc.Team.ID, id, map[string]any{"agentId": t.AgentID})
	return t, err
}

// EvaluationInput adds a shared question to an evaluation set.
type EvaluationInput struct {
	SetID, SharedQuestionID uuid.UUID
	// Question is the text as added ("": the shared text).
	Question    string
	Expected    evals.Expected
	MustMention []string
	Note        string
}

// AddToEvaluations adds one of the topic's shared questions to an
// evaluation set of the team (evaluations must be on; audited as
// evaluation.question_create by internal/evals and gap_topic.add_to_evaluations).
func (s *Service) AddToEvaluations(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, in EvaluationInput) (SharedQuestion, uuid.UUID, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return SharedQuestion{}, uuid.Nil, err
	}
	if s.Evals == nil {
		return SharedQuestion{}, uuid.Nil, errNoEvals
	}
	if _, err := s.topic(ctx, acc.Team.ID, id); err != nil {
		return SharedQuestion{}, uuid.Nil, err
	}
	sq, err := s.q.GetSharedGapQuestion(ctx, dbgen.GetSharedGapQuestionParams{ID: in.SharedQuestionID, TopicID: uuid.NullUUID{UUID: id, Valid: true}})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return SharedQuestion{}, uuid.Nil, errNoShared
	} else if err != nil {
		return SharedQuestion{}, uuid.Nil, err
	}
	text := strings.TrimSpace(in.Question)
	if text == "" {
		text = sq.Question
	}
	c, err := s.Evals.CreateQuestion(ctx, a, teamRef, in.SetID, evals.CaseInput{Question: text, Expected: in.Expected, MustMention: in.MustMention, Note: in.Note})
	if err != nil {
		return SharedQuestion{}, uuid.Nil, err
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.SetGapQuestionEvaluation(ctx, dbgen.SetGapQuestionEvaluationParams{ID: sq.ID,
			EvaluationQuestionID: uuid.NullUUID{UUID: c.ID, Valid: true}}); err != nil {
			return err
		}
		return audited(ctx, q, a, "gap_topic.add_to_evaluations", acc.Team.ID, id,
			map[string]any{"sharedQuestionId": sq.ID, "evaluationSetId": in.SetID, "evaluationQuestionId": c.ID})
	})
	sq.EvaluationQuestionID = uuid.NullUUID{UUID: c.ID, Valid: true}
	return SharedQuestion(sq), c.ID, err
}

func nullID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}
