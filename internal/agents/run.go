package agents

import (
	"context"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ncecere/grounded/internal/agentloop"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/requestcache"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/tracing"
)

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
	stepState   // the status step, and the waits that overlay it

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
	// routeRec is a router's routing decision (router.go); nil for every other answer.
	routeRec *RoutingRecord
	scopeRec *ScopeRecord

	anon *AnonCaller // an anonymous visitor (public and widget channels)
	// restricted: the agent's knowledge has restricted documents, so its answers depend on who asks and skip the answer
	// cache (docs/specs/document-acls/DESIGN.md).
	restricted bool
	// evaluation: an evaluation run's answer, which reads unrestricted documents only (its results are the team's).
	evaluation bool

	// usageMeta is added to the usage events' metadata (evaluation runs
	// tag theirs with source: evaluation).
	usageMeta map[string]any

	// mcp is the answer's MCP tool calls (nil: the agent has none; tools.go);
	// toolTurns: the model is offered tools (message_start's ToolTurns).
	mcp       *mcpState
	toolTurns bool

	// cache is the answer cache's part (nil: not used; cache.go).
	cache *cacheRun
}

// execute runs the shared part of chat and test chat, as one span (IDs
// and the channel only: never the question or the answer).
func (ru *run) execute(ctx context.Context, emit func(Event)) (ans Answer, err error) {
	// One answer reads the team's limits and cost settings in several steps (admission, budgets, tools): once each.
	ctx = requestcache.With(ctx)
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

// answer runs the pipeline: limits, the answer cache and the conversation,
// then the router's hand-over or the agent's own answer (generate).
func (ru *run) answer(ctx context.Context, emit func(Event)) (Answer, error) {
	s := ru.s
	if ru.cfg.Router && !ru.persist && ru.anon == nil {
		return Answer{}, errRouterNeedsConversation
	}
	ru.started = time.Now()
	ru.out = &streamer{emit: emit, gone: func() bool { return ctx.Err() != nil }}
	ru.meter = &systemone.Meter{}
	ctx = systemone.WithMeter(ctx, ru.meter)
	ctx = gateway.WithWaitNotice(ctx, ru.waitNotice) // "Working on it…" while a request waits for capacity (G22)
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
	if err := ru.newRetriever(ctx, resolvedKBs); err != nil {
		return Answer{}, err
	}
	ru.lookupCache(ctx) // the answer cache (cache.go); never for a router, which has no knowledge bases (cacheCandidate)
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

	if ru.cfg.Router { // a router answers nothing itself (router.go)
		_ = ru.planModeration(ctx) // only for the effort of its small-talk replies
		return ru.routeAnswer(ctx)
	}
	return ru.generate(ctx)
}

// generate is the pipeline of an agent that answers itself, after admission and the conversation: moderation and
// scope, retrieval, the agent loop and the checks of the answer.
func (ru *run) generate(ctx context.Context) (Answer, error) {
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
	ru.toolTurns = len(tools) > 0

	// The model starts: "Thinking…" until its first words ("Writing…" before it read backwards, v0.4.2 US-08).
	ru.status(StepThinking)
	ru.startChecked(ctx)
	st := &loopState{}
	loopCfg := agentloop.Config{
		Provider: ru.s.NewProvider(ru.target.Client), Model: ru.model, SystemPrompt: sys, Tools: tools,
		MaxTurns: ru.cfg.MaxTurns, Options: ru.options(ru.cfg.RetrievalMode == ModeTool),
	}
	added, runErr := agentloop.Run(ctx, loopCfg, msgs, func(ev agentloop.Event) { ru.onEvent(ev, st) })
	return ru.finish(ctx, added, runErr, st)
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

func keyID(a authz.Actor) uuid.NullUUID {
	if a.Key == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: a.Key.ID, Valid: true}
}
