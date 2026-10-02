// The actions on a topic (docs/gaps.md, owner decisions 4 and 5 of
// 2026-10-01): dismiss it for now or as not for this agent, mark it fixed,
// reopen it (undoing either), go and add a source, and add a shared
// question to an evaluation set. Each is audited with IDs, states and
// kinds only: team audit logs are readable by platform staff, who never
// see a topic's label, a question or a dismissal's reason. The reason, who
// acted and when are kept in the topic's history (gap_topic_events),
// which only the team's editors, admins and owners see.

package gaps

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Dismissal kinds.
const (
	// DismissForNow: the topic reopens when newer questions about it fail.
	DismissForNow = "for_now"
	// DismissNotForAgent: the topic stays closed; new questions still join
	// it and are counted (sinceClosed), but it never reopens by itself.
	DismissNotForAgent = "not_for_agent"
)

// Topic history kinds (gap_topic_events.kind).
const (
	EventDismissed = "dismissed"
	EventFixed     = "fixed"
	EventReopened  = "reopened"
	EventResolved  = "resolved"
	EventMerged    = "merged"
)

var (
	errBadKind = apperr.Invalid("invalid_kind", "kind must be for_now or not_for_agent")
	errOpenNow = apperr.Conflict("gap_topic_open", "This topic is already open")
)

// change is a person's change of a topic's state.
type change struct {
	state, reason, event, action string
	kind                         *string
	// fromOpen: the change closes an open topic; otherwise it reopens a
	// closed one.
	fromOpen bool
}

// Dismiss closes a topic for now or as not for this agent ("" is for
// now), with an optional reason (audited without the reason's text).
func (s *Service) Dismiss(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, kind, reason string) (Topic, error) {
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) > 500 {
		return Topic{}, errLongNote
	}
	switch kind {
	case "":
		kind = DismissForNow
	case DismissForNow, DismissNotForAgent:
	default:
		return Topic{}, errBadKind
	}
	return s.setState(ctx, a, teamRef, id, change{state: StateDismissed, reason: reason, kind: &kind, event: EventDismissed,
		action: "gap_topic.dismiss", fromOpen: true})
}

// Fix marks a topic fixed (audited).
func (s *Service) Fix(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Topic, error) {
	return s.setState(ctx, a, teamRef, id, change{state: StateFixed, event: EventFixed, action: "gap_topic.fix", fromOpen: true})
}

// Reopen reopens a closed topic: it undoes a dismissal of either kind or a
// fix, and reopens a topic that closed itself (audited).
func (s *Service) Reopen(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Topic, error) {
	return s.setState(ctx, a, teamRef, id, change{state: StateOpen, event: EventReopened, action: "gap_topic.reopen"})
}

// setState records a person's change of a topic's state and its history.
func (s *Service) setState(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, c change) (Topic, error) {
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
		switch {
		case c.fromOpen && cur.State != StateOpen:
			return errClosedNow
		case !c.fromOpen && cur.State == StateOpen:
			return errOpenNow
		}
		by := uuid.NullUUID{UUID: a.UserID, Valid: true}
		if err := q.SetGapTopicState(ctx, dbgen.SetGapTopicStateParams{ID: id, State: c.state, StateReason: c.reason, DismissKind: c.kind,
			StateChangedBy: by}); err != nil {
			return err
		}
		if err := q.InsertGapTopicEvent(ctx, dbgen.InsertGapTopicEventParams{TopicID: id, Kind: c.event, DismissKind: c.kind, Reason: c.reason,
			ActorID: by}); err != nil {
			return err
		}
		return audited(ctx, q, a, c.action, acc.Team.ID, id, auditMeta(cur, c))
	})
	if err != nil {
		return Topic{}, err
	}
	return s.topic(ctx, acc.Team.ID, id)
}

// auditMeta is a state change's audit metadata: the agent, the states and
// the dismissal's kind, and whether it had a reason, never the reason's
// text (it tends to restate the topic: aud-2 of the v0.4.0 walkthrough).
func auditMeta(cur dbgen.LockGapTopicRow, c change) map[string]any {
	meta := map[string]any{"agentId": cur.AgentID, "from": cur.State, "to": c.state}
	if c.kind != nil {
		meta["kind"] = *c.kind
		meta["hasReason"] = c.reason != ""
	}
	if cur.DismissKind != nil && cur.State == StateDismissed && !c.fromOpen {
		meta["fromKind"] = *cur.DismissKind
	}
	return meta
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
// evaluation.question_create by internal/evals, which never records a
// question's text, and gap_topic.add_to_evaluations, with IDs only).
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
	c, err := s.Evals.CreateQuestion(ctx, a, teamRef, in.SetID, evals.CaseInput{Question: text, Expected: in.Expected, MustMention: in.MustMention,
		Note: in.Note, FromSharedQuestion: sq.ID})
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
