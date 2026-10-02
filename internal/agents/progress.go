// An answer's progress before its first words (docs/phase3-agents.md §7):
// the status event names each step as it starts, and in always mode the
// search (embedding, vector and lexical search, fusion) runs while input
// moderation and the scope check answer. Only its judging waits for them:
// judging costs SystemOne requests that small talk, an out-of-scope
// question or a blocked one should not spend. A search whose results are
// not used is still waited for, so its embedding tokens are recorded.

package agents

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/tracing"
)

// Steps of the status event.
const (
	// StepRewriting: a follow-up that depends on the conversation is
	// rewritten into a search query.
	StepRewriting = "rewriting"
	// StepSearching: the knowledge bases are searched (always mode).
	StepSearching = "searching"
	// StepChecking: SystemOne passage judging.
	StepChecking = "checking"
	// StepThinking: the model is reasoning, in answers whose thinking isn't
	// streamed (buffered and checked answers): a step without content,
	// so the visitor sees progress (docs/v0.4.0.md §4, owner decision 4).
	StepThinking = "thinking"
	// StepAnswering: the model is writing, until its first token (or, in
	// buffered and checked answers, once it stops thinking).
	StepAnswering = "answering"
)

// status sends a step's status event, once. It starts the stream, so a
// failure after it is an error event rather than an HTTP error.
func (ru *run) status(step string) {
	if ru.step == step {
		return
	}
	ru.step = step
	ru.out.start()
	ru.out.send(Event{"status", StatusEvent{Step: step}})
}

// earlySearch is always mode's search, started before the input and scope
// checks have answered.
type earlySearch struct {
	ctx  context.Context // carries the agent.retrieve span
	span trace.Span
	done chan struct{}
	c    candidates // set when done is closed
}

// startSearch rewrites a follow-up that depends on the conversation, then
// starts the search in the background (always mode; nothing in tool
// mode). A message that stands on its own is searched as it is.
func (ru *run) startSearch(ctx context.Context) {
	if ru.cfg.RetrievalMode == ModeTool {
		return
	}
	query := ru.question
	if ru.cfg.QueryRewrite && len(ru.history) > 0 && needsContext(ru.question) {
		ru.status(StepRewriting)
		query = ru.rewrite(ctx)
	}
	ru.status(StepSearching)
	sctx, span := ru.retr.startSearch(ctx)
	es := &earlySearch{ctx: sctx, span: span, done: make(chan struct{})}
	go func() {
		defer close(es.done)
		es.c = ru.retr.fetch(sctx, query)
	}()
	ru.early = es
}

// retrieveFirst finishes the search before the model runs (always mode):
// it judges the candidates and builds the user message with the sources.
// refuse is set when strict grounding found nothing to answer from and
// canRefuse (the agent has no tools to call).
func (ru *run) retrieveFirst(canRefuse bool) (msg llm.Message, refuse bool, err error) {
	es := ru.early
	ru.early = nil // used: the record needn't wait for it
	<-es.done
	if ru.retr.judge != nil && es.c.err == nil && len(es.c.merged) > 0 {
		ru.status(StepChecking)
	}
	query := es.c.query
	hits, sj, err := ru.retr.finishSearch(es.ctx, es.span, es.c, 0)
	if err != nil {
		return nil, false, err
	}
	ru.out.send(Event{"retrieval", RetrievalEvent{Query: query, Hits: ru.retrievalHits(hits), Judging: sj.event()}})
	ru.firstSearch = &RetrievalView{Query: query, HitCount: len(hits), Judging: sj.event()}
	if len(hits) == 0 && ru.cfg.StrictlyGrounded && canRefuse {
		if sj.judgedOut() {
			ru.noContextReason = NoContextJudgedOut
		}
		return nil, true, nil
	}
	content := noSourcesNote + "\n\n" + ru.question
	if len(hits) > 0 {
		content = formatSources(hits) + "\n\n" + ru.question
	}
	return llm.UserMessage{Content: content}, false, nil
}

// settleSearch waits for a search whose results are not used (small talk,
// an out-of-scope refusal, a blocked question, a failure), so the tokens
// it spent are recorded, and ends its span. Nothing when there is none.
func (ru *run) settleSearch() {
	es := ru.early
	if es == nil {
		return
	}
	ru.early = nil
	<-es.done
	es.span.SetAttributes(attribute.Bool("grounded.retrieval.discarded", true))
	tracing.End(es.span, es.c.err)
}
