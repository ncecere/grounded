package agents

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Channels (message_events.channel).
const (
	ChannelUI     = "ui"
	ChannelAPI    = "api"
	ChannelOpenAI = "openai"
	ChannelTest   = "test"
	// ChannelEvaluation tags the usage of evaluation runs (their answers are still recorded as test chats).
	ChannelEvaluation = "evaluation"
	// ChannelMCP is the MCP server's ask tool (docs/mcp.md).
	ChannelMCP = "mcp"
)

// Limits of a chat request.
const (
	MaxMessageChars = 8000
	maxHistory      = 50
	// defaultContextWindow is assumed when a model does not declare one.
	defaultContextWindow = 32000
)

// Error codes recorded on answers.
const (
	ErrCodeModelUnavailable = "model_unavailable"
	// ErrCodeModelBusy: the gateway refused because of load (429, or 503
	// with Retry-After). Worth retrying soon; not an outage.
	ErrCodeModelBusy         = "model_busy"
	ErrCodeIncompleteAnswer  = "incomplete_answer"
	ErrCodeInternal          = "internal"
	ErrCodeAborted           = "aborted"
	incompleteAnswerMessage  = "The agent could not finish an answer. Try asking again, perhaps more specifically."
	modelUnavailableMessage  = "The chat model is unavailable. Try again shortly."
	modelBusyMessage         = "The chat model is busy right now. Try again in a moment."
	internalFailureMessage   = "Something went wrong while answering."
	conversationNotFoundCode = "conversation_not_found"
)

// HistoryMessage is a prior turn sent by a stateless caller.
type HistoryMessage struct {
	Role    string // user | assistant
	Content string
}

// ChatRequest asks a published agent a question.
type ChatRequest struct {
	// TeamRef and AgentRef name the agent: team slug and agent slug, or ""
	// and the agent ID.
	TeamRef, AgentRef string
	Message           string
	// ConversationID continues a conversation (user principals only).
	ConversationID *uuid.UUID
	// History is prior turns for stateless callers (service keys, the
	// OpenAI-compatible endpoint).
	History []HistoryMessage
	// Channel is ui, api, openai or mcp.
	Channel string
	// Stateless never stores a transcript (the OpenAI-compatible endpoint).
	Stateless bool
}

// Answer is the outcome of a chat.
type Answer struct {
	ConversationID *uuid.UUID
	UserMessageID  *uuid.UUID
	// MessageID identifies the answer (stored only when Persisted).
	MessageID    uuid.UUID
	Persisted    bool
	AgentVersion *int32
	// Model is the upstream model ID.
	Model     string
	Text      string
	Thinking  string
	Citations []Citation
	// Uncited are the factual sentences without a citation, when citations
	// were checked (verdicts.go); not for answers without sources.
	Uncited []UncitedSentence
	// Claims are the answer's factual sentences with their verdicts, when
	// citations were checked (claimverdicts.go).
	Claims     []Claim
	Sources    []RetrievalHit
	Usage      llm.Usage
	StopReason string
	// ErrorCode and ErrorMessage are set when the answer failed after
	// streaming started (model_unavailable, incomplete_answer, ...).
	ErrorCode    string
	ErrorMessage string
	Refused      bool
	NoContext    bool
	Latency      time.Duration
	// Moderation is set when moderation replaced the question's answer or
	// the answer with a notice (Text is the notice).
	Moderation *ModerationEvent
	// noContextReason is judged_out when judging dropped everything.
	noContextReason string
	// routedTo is the agent a router sent the question to (router.go), for message_end.
	routedTo  *RoutedView
	toolCalls int
	// storedCode is the stored message's error code when it differs from
	// ErrorCode (moderation notices).
	storedCode string
	// Suggestions are the follow-up questions (suggest.go); citePending:
	// message_end says citations_checked follows.
	Suggestions []string
	citePending bool
}

// Chat answers a question with a published agent. Errors returned before
// anything was emitted are HTTP errors (403 agent_disabled, 409
// agent_policy_violation, 429, 503 model_unavailable, ...); once the answer
// has started, failures are reported with an error event and in the Answer.
// emit is called from the calling goroutine only.
func (s *Service) Chat(ctx context.Context, a authz.Actor, req ChatRequest, emit func(Event)) (Answer, error) {
	question, err := checkMessage(req.Message)
	if err != nil {
		return Answer{}, err
	}
	if a.Key != nil && !a.Key.HasScope(authz.ScopeQuery) {
		return Answer{}, apperr.Forbidden("This API key does not have the query scope")
	}
	r, err := s.resolve(ctx, a, req.TeamRef, req.AgentRef)
	if err != nil {
		return Answer{}, err
	}
	if r.agent.Status != StatusActive {
		return Answer{}, disabledError(r.agent)
	}
	stateless, hist, err := checkCaller(a, req)
	if err != nil {
		return Answer{}, err
	}
	pol, err := s.evaluate(ctx, s.q, r.team, &r.version.ChatModelID, r.config.KBIDs(), r.grant)
	if err != nil {
		return Answer{}, err
	}
	if len(pol.Violations) > 0 {
		s.recordViolation(ctx, a, r.agent, r.version.Version, pol)
		return Answer{}, policyError(pol.Violations[0])
	}
	channel := req.Channel
	if channel == "" {
		channel = ChannelAPI
	}
	ru := &run{s: s, a: a, team: r.team, agent: r.agent, version: &r.version, cfg: r.config, grant: r.grant,
		rank: pol.Rank, channel: channel, persist: !stateless, question: question, stateless: hist}
	if req.ConversationID != nil {
		if ru.conv, err = s.continuedConversation(ctx, a, r.agent.ID, *req.ConversationID); err != nil {
			return Answer{}, err
		}
	}
	return ru.execute(ctx, emit)
}

// TestChat runs the draft configuration (editors). Nothing is stored except
// usage and analytics (channel test).
func (s *Service) TestChat(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID, message string, history []HistoryMessage, emit func(Event)) (Answer, error) {
	question, err := checkMessage(message)
	if err != nil {
		return Answer{}, err
	}
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return Answer{}, err
	}
	ag, err := s.loadAgent(ctx, s.q, acc.Team.ID, agentID, false)
	if err != nil {
		return Answer{}, err
	}
	hist, err := checkHistory(history)
	if err != nil {
		return Answer{}, err
	}
	cfg := DecodeConfig(ag.Draft)
	grant := cfg.Audience // the draft's audience: its moderation applies
	probs, pol, err := s.strictProblems(ctx, s.q, acc.Team, cfg, grant)
	if err != nil {
		return Answer{}, err
	}
	if len(probs) > 0 {
		return Answer{}, Invalid(probs)
	}
	ru := &run{s: s, a: a, team: acc.Team, agent: ag, cfg: cfg, grant: grant, rank: pol.Rank,
		channel: ChannelTest, question: question, stateless: hist}
	return ru.execute(ctx, emit)
}

func checkMessage(m string) (string, error) {
	m = strings.TrimSpace(m)
	if m == "" || utf8.RuneCountInString(m) > MaxMessageChars {
		return "", apperr.Invalid("invalid_message", fmt.Sprintf("The message must be 1-%d characters", MaxMessageChars))
	}
	return m, nil
}

func checkHistory(h []HistoryMessage) ([]HistoryMessage, error) {
	if len(h) > maxHistory {
		h = h[len(h)-maxHistory:]
	}
	for _, m := range h {
		if m.Role != "user" && m.Role != "assistant" {
			return nil, apperr.Invalid("invalid_history", "History roles must be user or assistant")
		}
		if utf8.RuneCountInString(m.Content) > 4*MaxMessageChars {
			return nil, apperr.Invalid("invalid_history", "A history message is too long")
		}
	}
	return h, nil
}

func disabledError(ag dbgen.Agent) error {
	msg := "This agent has been disabled by its team."
	if ag.Status == StatusDisabledByPlatform {
		msg = "This agent has been disabled by the platform administrators."
	}
	return apperr.New(403, "agent_disabled", msg)
}

// recordViolation audits a query refused by the policy check.
func (s *Service) recordViolation(ctx context.Context, a authz.Actor, ag dbgen.Agent, version int32, pol policy) {
	e := a.Audit("agent.policy_violation", "agent", ag.ID.String())
	e.TeamID = ag.TeamID
	rules := make([]string, len(pol.Violations))
	for i, v := range pol.Violations {
		rules[i] = v.Rule
	}
	e.Metadata = audit.MergeMeta(e.Metadata, map[string]any{"rules": rules, "version": version, "rank": pol.Rank,
		"classification": pol.Classification, "message": pol.Violations[0].Message})
	if err := audit.Record(context.WithoutCancel(ctx), s.q, e); err != nil {
		s.Log.Error("audit policy violation", "err", err)
	}
}
