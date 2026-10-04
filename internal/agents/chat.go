package agents

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ncecere/grounded/internal/agentloop"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/tracing"
)

// Channels (message_events.channel).
const (
	ChannelUI     = "ui"
	ChannelAPI    = "api"
	ChannelOpenAI = "openai"
	ChannelTest   = "test"
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
	toolCalls       int
	// storedCode is the stored message's error code when it differs from
	// ErrorCode (moderation notices).
	storedCode string
	// Suggestions are the follow-up questions (suggest.go); citePending:
	// message_end says citations_checked follows.
	Suggestions []string
	citePending bool
}

// run is one answer in progress.
type run struct {
	s       *Service
	a       authz.Actor
	team    dbgen.Team
	agent   dbgen.Agent
	version *dbgen.AgentVersion // nil for draft tests
	cfg     Config
	target  catalog.ChatTarget
	model   llm.Model
	grant   string
	rank    int32
	channel string
	persist bool

	conv       *dbgen.Conversation
	userMsgID  uuid.UUID
	msgID      uuid.UUID
	question   string
	history    []llm.Message
	stateless  []HistoryMessage
	out        *streamer
	started    time.Time
	firstToken time.Duration
	clock      time.Time // now in the platform's zone, read once (today.go)
	retr       *retriever
	extraUsage llm.Usage // query rewrite
	// early is always mode's search while the input and scope checks run
	// (progress.go); nil once used or settled. firstSearch is its view,
	// stored with the answer so a reload shows its step.
	early       *earlySearch
	firstSearch *RetrievalView
	// step is the last status event's step.
	step string

	mod *moderation.Plan // nil: nothing is moderated
	// audienceEffort is the audience's reasoning effort (its moderation
	// policy's; "" for the model's), used when the agent sets none.
	audienceEffort string
	modIn, modOut  *moderation.Decision
	// checked releases the answer in checked paragraphs (stream_checked,
	// streamcheck.go); checkedEvent is the moderation event sent when one
	// failed, and modChecks the number of checks.
	checked      *checkedStream
	checkedEvent *ModerationEvent
	modChecks    int

	// meter counts SystemOne tokens (judging, moderation) for the usage
	// ledger; noContextReason is set by retrieveFirst.
	meter           *systemone.Meter
	noContextReason string
	// usage are the usage events recorded for the answer (for the budget
	// check's cached spend).
	usage []dbgen.InsertUsageParams

	// Citation checks and the scope check (docs/systemone.md §3-§4): nil
	// when off. citeChanged: enforce changed the answer's text. answeredAt
	// is when a streamed answer ended, before its citations were checked.
	cite        *systemone.CitationPlan
	citeRec     *CitationsRecord
	citeChanged bool
	answeredAt  time.Time
	scope       *systemone.ScopePlan
	scopeRec    *ScopeRecord

	anon *AnonCaller // an anonymous visitor (public and widget channels)

	// usageMeta is added to the usage events' metadata (evaluation runs
	// tag theirs with source: evaluation).
	usageMeta map[string]any

	// mcp is the answer's MCP tool calls (nil: the agent has none; tools.go).
	mcp *mcpState

	// cache is the answer cache's part (nil: not used; cache.go).
	cache *cacheRun
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

// checkCaller decides whether the caller is stateless (service keys and the
// OpenAI-compatible endpoint send prior turns in history; users' conversations
// are stored) and checks the history it sent.
func checkCaller(a authz.Actor, req ChatRequest) (bool, []HistoryMessage, error) {
	stateless := req.Stateless || (a.Key != nil && !a.Key.Personal()) || a.UserID == uuid.Nil
	if stateless && req.ConversationID != nil {
		return false, nil, apperr.Invalid("conversation_not_allowed",
			"This caller is stateless (service key or OpenAI-compatible endpoint): send prior turns in history instead of conversationId")
	}
	if !stateless && len(req.History) > 0 {
		return false, nil, apperr.Invalid("history_not_allowed", "Conversations are stored for you: send conversationId instead of history")
	}
	hist, err := checkHistory(req.History)
	if err != nil {
		return false, nil, err
	}
	return stateless, hist, nil
}

// continuedConversation loads the conversation a user continues: it must be
// theirs and belong to the agent.
func (s *Service) continuedConversation(ctx context.Context, a authz.Actor, agentID, id uuid.UUID) (*dbgen.Conversation, error) {
	c, err := s.q.GetConversation(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (!ownedBy(c.UserID, a.UserID) || c.AgentID != agentID)) {
		return nil, apperr.NotFound(conversationNotFoundCode, "Conversation not found")
	} else if err != nil {
		return nil, err
	}
	return &c, nil
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
	e.Metadata = mergeMeta(e.Metadata, map[string]any{"rules": rules, "version": version, "rank": pol.Rank,
		"classification": pol.Classification, "message": pol.Violations[0].Message})
	if err := audit.Record(context.WithoutCancel(ctx), s.q, e); err != nil {
		s.Log.Error("audit policy violation", "err", err)
	}
}

// execute runs the shared part of chat and test chat, as one span (IDs
// and the channel only: never the question or the answer).
func (ru *run) execute(ctx context.Context, emit func(Event)) (ans Answer, err error) {
	ctx, span := tracing.Start(ctx, "agent.answer", attribute.String("grounded.team_id", ru.team.ID.String()),
		attribute.String("grounded.agent_id", ru.agent.ID.String()), attribute.String("grounded.channel", ru.channel))
	if v := ru.versionNum(); v != nil {
		span.SetAttributes(attribute.Int("grounded.agent_version", int(*v)))
	}
	defer func() {
		// A search or checked paragraphs left over by an early return.
		ru.settleSearch()
		if ru.checked != nil {
			ru.checked.close()
		}
		tracing.End(span, err)
	}()
	return ru.answer(ctx, emit)
}

// answer runs the pipeline: limits, moderation and scope, retrieval, the
// agent loop and the checks of the answer.
func (ru *run) answer(ctx context.Context, emit func(Event)) (Answer, error) {
	s := ru.s
	ru.started = time.Now()
	ru.out = &streamer{emit: emit}
	ru.meter = &systemone.Meter{}
	ctx = systemone.WithMeter(ctx, ru.meter)
	target, err := s.Catalog.ChatTarget(ctx, ru.chatModelID())
	if err != nil {
		return Answer{}, err
	}
	ru.target, ru.model = target, llm.ModelFromRow(target.Model)
	release, err := ru.admit(ctx)
	if err != nil {
		return Answer{}, err
	}
	defer release()
	resolvedKBs, err := s.KBs.ResolveKBs(ctx, ru.cfg.KBIDs())
	if err != nil {
		return Answer{}, err
	}
	ru.retr = newRetriever(s.KBs, resolvedKBs, ru.cfg, ru.userTag())
	ru.lookupCache(ctx) // the answer cache (cache.go)
	if !ru.cacheHitNow() {
		ru.retr.planRerank(ctx, ru.cfg)
		ru.planSystemOne(ctx)
	}
	ru.msgID = uuid.New()

	if err := ru.prepareConversation(ctx); err != nil {
		return Answer{}, err
	}
	ru.out.send(Event{"conversation", ConversationEvent{ConversationID: ru.convID(), UserMessageID: ru.userMsgPtr(), AgentVersion: ru.versionNum()}})
	if ru.cacheHitNow() {
		return ru.replayCached(ctx)
	}

	if err := ru.planModeration(ctx); err != nil {
		return ru.failBeforeStart(ctx, err)
	}
	// Input moderation and the scope check run concurrently with the rewrite
	// and, in always mode, the search; judging waits for them (progress.go).
	inputCheck, scopeCheck := ru.startInputCheck(ctx), ru.startScopeCheck(ctx)
	ru.startSearch(ctx)
	if ru.awaitInput(inputCheck) {
		return ru.blockInput(ctx)
	}
	switch ru.awaitScope(scopeCheck) {
	case systemone.ScopeSmallTalk:
		return ru.smallTalk(ctx)
	case systemone.ScopeOutOfScope:
		if ru.cfg.StrictlyGrounded {
			return ru.refuseOutOfScope(ctx)
		}
	}
	sys := systemPromptJudged(ru.agent.Name, ru.team.Name, ru.s.OrgName, ru.cfg, ru.retr.judge != nil, ru.now(ctx))
	msgs := append([]llm.Message(nil), ru.history...)
	var tools []agentloop.Tool
	mcpTools := ru.mcpTools(ctx)

	if ru.cfg.RetrievalMode == ModeTool {
		tools = []agentloop.Tool{ru.searchTool()}
		msgs = append(msgs, llm.UserMessage{Content: ru.question})
	} else {
		// A strict agent with tools may still answer from a tool's result.
		msg, refuse, err := ru.retrieveFirst(len(mcpTools) == 0)
		if err != nil {
			return ru.failBeforeStart(ctx, err)
		}
		if refuse {
			return ru.refuseWithoutModel(ctx)
		}
		msgs = append(msgs, msg)
	}
	tools = append(tools, mcpTools...)

	// The model starts: "Thinking…" until its first words ("Writing…" before it read backwards, v0.4.2 US-08).
	ru.status(StepThinking)
	ru.startChecked(ctx)
	st := &loopState{}
	loopCfg := agentloop.Config{
		Provider: s.NewProvider(target.Client), Model: ru.model, SystemPrompt: sys, Tools: tools,
		MaxTurns: ru.cfg.MaxTurns, Options: ru.options(ru.cfg.RetrievalMode == ModeTool),
	}
	added, runErr := agentloop.Run(ctx, loopCfg, msgs, func(ev agentloop.Event) { ru.onEvent(ev, st) })
	return ru.finish(ctx, added, runErr, st)
}

// errUnavailableNow is what anonymous visitors of a public agent get when
// its team's budget is used up (docs/costs.md §4).
var errUnavailableNow = apperr.New(503, "agent_unavailable", "This assistant is unavailable right now. Please try again later.")

// admit applies the limits (monthly budget, daily chat tokens, query rates,
// concurrent chats) and writes the access log entry that every use of a Sensitive or
// Restricted agent gets. release frees the concurrent-chat slot.
func (ru *run) admit(ctx context.Context) (release func(), err error) {
	s := ru.s
	release = func() {}
	if s.Limits != nil {
		if err := s.Limits.CheckChat(ctx, ru.team.ID, ru.a); err != nil {
			if ru.anon != nil && costs.IsExhausted(err) {
				return nil, errUnavailableNow // anonymous visitors don't see the team's budget
			}
			return nil, err
		}
		principal := ru.a.UserID.String()
		switch {
		case ru.anon != nil:
			principal = "anon:" + ru.anon.SessionID.String()
		case ru.a.Key != nil && !ru.a.Key.Personal():
			principal = "key:" + ru.a.Key.ID.String()
		}
		slot, err := s.Limits.AcquireChat(ctx, ru.team.ID, principal)
		if err != nil {
			return nil, err
		}
		release = func() { slot.Release(ctx) }
	}
	if ru.rank >= 1 {
		if err := s.q.InsertAccessLog(ctx, dbgen.InsertAccessLogParams{
			UserID: nullUser(ru.a), APIKeyID: keyID(ru.a), AgentID: ru.agent.ID,
			AgentVersionID: ru.versionID(), Rank: ru.rank, Channel: ru.channel,
		}); err != nil {
			release()
			return nil, err
		}
	}
	return release, nil
}

// effort is the answer's reasoning effort: the agent's own, else its
// audience's (docs/v0.4.0.md §4, owner decision 4).
func (ru *run) effort() string {
	if ru.cfg.ReasoningEffort != "" {
		return ru.cfg.ReasoningEffort
	}
	return ru.audienceEffort
}

// rewriteEffort is the query rewrite's: low, or off when the answer's is
// off and the model can turn thinking off.
func (ru *run) rewriteEffort() string {
	if ru.effort() == llm.EffortOff && ru.model.Compat.ThinkingOff != "" {
		return llm.EffortOff
	}
	return "low"
}

// options are the model options of the answer.
func (ru *run) options(withTools bool) llm.Options {
	opts := llm.Options{Temperature: ru.cfg.Temperature, ReasoningEffort: ru.effort(), User: ru.userTag()}
	if ru.cfg.MaxOutputTokens != nil {
		opts.MaxTokens = *ru.cfg.MaxOutputTokens
	}
	if withTools && ru.cfg.StrictlyGrounded {
		opts.ToolChoice = llm.ToolChoiceRequired // sent only when compat allows
	}
	return opts
}

func (ru *run) chatModelID() uuid.UUID {
	if ru.version != nil {
		return ru.version.ChatModelID
	}
	return *ru.cfg.ChatModelID
}

func (ru *run) versionID() uuid.NullUUID {
	if ru.version == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: ru.version.ID, Valid: true}
}

func (ru *run) versionNum() *int32 {
	if ru.version == nil {
		return nil
	}
	v := ru.version.Version
	return &v
}

func (ru *run) convID() *uuid.UUID {
	if ru.conv == nil {
		return nil
	}
	id := ru.conv.ID
	return &id
}

func (ru *run) userMsgPtr() *uuid.UUID {
	if ru.userMsgID == uuid.Nil {
		return nil
	}
	id := ru.userMsgID
	return &id
}

func (ru *run) userTag() string {
	return llm.UserTag(ru.team.Slug, ru.agent.Slug)
}

func nullUser(a authz.Actor) uuid.NullUUID {
	return uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
}

func keyID(a authz.Actor) uuid.NullUUID {
	if a.Key == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: a.Key.ID, Valid: true}
}
