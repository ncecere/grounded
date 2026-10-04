// Finishing an answer: turning the agent loop's outcome (or a failure before
// it started) into the Answer, then recording and reporting it.

package agents

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/llm"
)

// failBeforeStart handles a failure before anything was streamed: the
// stored conversation records the failed answer, and the caller gets an
// HTTP error.
func (ru *run) failBeforeStart(ctx context.Context, err error) (Answer, error) {
	code, msg := ErrCodeInternal, internalFailureMessage
	var ae *apperr.Error
	switch {
	case errors.As(err, &ae) && ae.Code == ErrCodeModelUnavailable:
		code, msg = ErrCodeModelUnavailable, ae.Message
	case isGatewayBusy(err):
		code, msg = ErrCodeModelBusy, modelBusyMessage
	case isGatewayErr(err):
		code, msg = ErrCodeModelUnavailable, modelUnavailableMessage
	case ctx.Err() != nil:
		code, msg = ErrCodeAborted, "The request was cancelled"
	}
	ans := ru.baseAnswer()
	ans.StopReason, ans.ErrorCode, ans.ErrorMessage = string(llm.StopReasonError), code, msg
	if code == ErrCodeAborted {
		ans.StopReason = string(llm.StopReasonAborted)
	}
	ru.record(ctx, &ans, nil, nil)
	if code == ErrCodeModelUnavailable || code == ErrCodeModelBusy {
		return ans, withConversation(apperr.New(503, code, msg), ans)
	}
	if code == ErrCodeAborted {
		return ans, ctx.Err()
	}
	return ans, err
}

func withConversation(e *apperr.Error, ans Answer) error {
	if ans.ConversationID != nil {
		e.Details = map[string]any{"conversationId": ans.ConversationID.String()}
	}
	return e
}

// isGatewayBusy reports a gateway refusal because of load (rate limit or
// overload with Retry-After), as opposed to an outage.
func isGatewayBusy(err error) bool {
	var ge *gateway.Error
	return errors.As(err, &ge) && ge.Backpressure()
}

func isGatewayErr(err error) bool {
	var ge *gateway.Error
	return errors.As(err, &ge) || errors.Is(err, kbs.ErrModelUnavailable)
}

func (ru *run) baseAnswer() Answer {
	return Answer{ConversationID: ru.convID(), UserMessageID: ru.userMsgPtr(), MessageID: ru.msgID,
		AgentVersion: ru.versionNum(), Model: ru.model.ID, Citations: []Citation{}, Sources: []RetrievalHit{},
		Usage: ru.extraUsage}
}

// refuseWithoutModel answers with the refusal message: strict grounding and
// nothing retrieved, or everything dropped by judging (always mode). A
// question the scope check found outside the agent's subject gets its own
// wording, since nothing was searched (refusal says "couldn't find").
func (ru *run) refuseWithoutModel(ctx context.Context) (Answer, error) {
	text := ru.cfg.RefusalMessage
	if ru.noContextReason == NoContextOutOfScope {
		text = OutOfScopeMessage(ru.agent.Name)
	}
	st := &loopState{}
	ru.startAnswer(st)
	ru.markFirstToken()
	ru.out.send(Event{"text_delta", DeltaEvent{Delta: text}})
	ans := ru.baseAnswer()
	ans.Text, ans.StopReason, ans.Refused, ans.NoContext = text, string(llm.StopReasonStop), true, true
	ans.noContextReason = ru.noContextReason
	msg := llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: text}}, StopReason: llm.StopReasonStop}
	ru.record(ctx, &ans, &msg, nil)
	ru.sendEnd(ans)
	return ans, nil
}

// finish turns the loop result into the answer: citations, refusals,
// incomplete answers and errors; then checks the citations (when on),
// stores and reports it, and suggests follow-up questions.
func (ru *run) finish(ctx context.Context, added []llm.Message, runErr error, st *loopState) (Answer, error) {
	ans := ru.baseAnswer()
	final, blocks, results := collectLoop(added, &ans.Usage)
	ans.StopReason = string(final.StopReason)
	ans.Thinking = st.thinkSoFar.String()
	ans.noContextReason = ru.noContextReason
	sources := ru.retr.numbered()
	ans.Sources = ru.retrievalHits(sources)
	if ru.cfg.RetrievalMode == ModeTool {
		ans.NoContext = ru.retr.hitSearches == 0 && !hasToolSource(sources)
	} else {
		ans.NoContext = len(sources) == 0
	}
	if failed := ru.settle(ctx, &ans, final, runErr, st, sources); failed != nil {
		return ru.failBeforeStart(ctx, failed)
	}
	withheld := ru.moderateOutput(ctx, &ans)
	if withheld {
		blocks, results = nil, nil // nothing of a withheld answer is kept
	}
	// Citations are checked before a buffered or JSON answer is released,
	// and after message_end when the answer streamed (docs/systemone.md §3).
	timing := ru.citationTiming(&ans, withheld)
	if timing == checkBefore {
		ru.checkCitations(ctx, &ans, sources, ru.citationMode(timing))
	}
	ru.releaseBuffered(st, withheld, ans)
	if timing == checkAfter {
		ru.answeredAt = time.Now()
		ans.citePending = true
		ru.sendEnd(ans)
		ans.citePending = false
		ru.checkCitations(ctx, &ans, sources, ru.citationMode(timing))
	}
	if ctx.Err() != nil && ans.StopReason == string(llm.StopReasonStop) && timing != checkAfter {
		// The reader pressed Stop (or left) after the model finished but before the answer reached them (checks,
		// moderation): it's stored as stopped, as they saw it, not as a complete answer (v0.4.2 US-05, US2-12).
		ans.StopReason = string(llm.StopReasonAborted)
		ru.storeAsShown(&ans, sources)
	}
	if ans.Text != "" {
		blocks = append(blocks, llm.Text{Text: ans.Text})
	}
	stored := llm.AssistantMessage{Content: blocks, Model: ru.model.ID, Usage: ans.Usage, StopReason: llm.StopReason(ans.StopReason)}
	ans.toolCalls = st.toolCalls
	ru.record(ctx, &ans, &stored, results)
	if ans.ErrorCode != "" && ans.StopReason != string(llm.StopReasonAborted) {
		ru.out.send(Event{"error", ErrorEvent{Code: ans.ErrorCode, Message: ans.ErrorMessage}})
	}
	if timing != checkAfter {
		ru.sendEnd(ans)
	} else if ru.citeRec != nil {
		ru.out.send(ru.citationsChecked(ans))
	}
	ru.suggest(ctx, &ans, sources) // follow-up questions (suggest.go)
	ru.storeCached(ctx, &ans)      // the answer cache (cache.go)
	return ans, nil
}

// storeAsShown makes a stopped answer's text what the reader got before
// they left (v0.4.2 US2-12): text the model wrote after that (a token or two
// read from the model's stream before the stop reached it), or a buffered
// answer they never got, isn't stored, so a reload shows what they saw. The
// citations follow the text; claims checked on more text are dropped. Not
// for JSON replies (nothing streamed) or a moderation notice.
func (ru *run) storeAsShown(ans *Answer, sources []numberedHit) {
	if ru.out == nil || ru.out.emit == nil || ans.Moderation != nil || ans.Refused {
		return
	}
	shown := openMarkerEnd.ReplaceAllString(NormalizePunctuation(ru.out.shownText()), "") // as the chat drops it at Stop
	text, cites := applyCitations(shown, sources, ru.cfg.CitationMode)
	if text != ans.Text {
		ans.Text, ans.Citations, ans.Claims, ans.Uncited = text, cites, nil, nil
	}
}

// openMarkerEnd is a marker cut off at the end of a stopped answer ("[1").
var openMarkerEnd = regexp.MustCompile(`\s*[\[\x{FF3B}\x{3010}][\d,\x{FF0C}\s]*(?:\x{2020}[^\]\x{FF3D}\x{3011}]*)?$`)

// hasToolSource reports whether an MCP tool's result is among the sources.
func hasToolSource(sources []numberedHit) bool {
	for _, h := range sources {
		if h.Tool != nil {
			return true
		}
	}
	return false
}

// collectLoop sums the usage of the messages the loop added into usage and
// returns the final assistant message, the non-text blocks of every
// assistant message (thinking, tool calls) and the tool results.
func collectLoop(added []llm.Message, usage *llm.Usage) (final llm.AssistantMessage, blocks []llm.Block, results []llm.ToolResultMessage) {
	for _, m := range added {
		switch v := m.(type) {
		case llm.AssistantMessage:
			addUsage(usage, v.Usage)
			final = v
			for _, b := range v.Content {
				if _, isText := b.(llm.Text); !isText {
					blocks = append(blocks, b)
				}
			}
		case llm.ToolResultMessage:
			results = append(results, v)
		}
	}
	return final, blocks, results
}

// settle sets the answer's text, citations, stop reason and error from the
// loop outcome. It returns the model's error, without changing the answer,
// when the model failed before responding at all.
func (ru *run) settle(ctx context.Context, ans *Answer, final llm.AssistantMessage, runErr error, st *loopState, sources []numberedHit) error {
	// The stored and returned text has plain hyphens and spaces (punctuation.go).
	raw := NormalizePunctuation(st.textSoFar.String())
	switch {
	case ctx.Err() != nil || final.StopReason == llm.StopReasonAborted:
		ans.StopReason = string(llm.StopReasonAborted)
		ans.Text, ans.Citations = applyCitations(raw, sources, ru.cfg.CitationMode)
		ru.storeAsShown(ans, sources)
	case final.StopReason == llm.StopReasonError || runErr != nil:
		if !st.answerStarts {
			// The model failed before responding at all.
			msg := final.ErrorMessage
			if msg == "" && runErr != nil {
				msg = runErr.Error()
			}
			ru.s.Log.Warn("chat model failed", "agent", ru.agent.ID, "err", msg)
			return &gateway.Error{Kind: final.ErrorKind, Message: msg}
		}
		ru.s.Log.Warn("chat model failed mid-answer", "agent", ru.agent.ID, "kind", final.ErrorKind, "err", final.ErrorMessage)
		ans.StopReason = string(llm.StopReasonError)
		ans.ErrorCode, ans.ErrorMessage = ErrCodeModelUnavailable, modelUnavailableMessage
		if final.ErrorKind == gateway.KindRateLimited {
			ans.ErrorCode, ans.ErrorMessage = ErrCodeModelBusy, modelBusyMessage
		}
		ans.Text, ans.Citations = applyCitations(raw, sources, ru.cfg.CitationMode)
	case strings.TrimSpace(raw) == "":
		// No text: typically the model kept calling tools on the forced
		// final turn.
		if ru.cfg.StrictlyGrounded {
			ans.Text, ans.Refused, ans.StopReason = ru.cfg.RefusalMessage, true, string(llm.StopReasonStop)
			ru.out.send(Event{"text_delta", DeltaEvent{Delta: ru.cfg.RefusalMessage}})
		} else {
			ans.StopReason = string(llm.StopReasonError)
			ans.ErrorCode, ans.ErrorMessage = ErrCodeIncompleteAnswer, incompleteAnswerMessage
		}
	default:
		ans.Text, ans.Citations = applyCitations(raw, sources, ru.cfg.CitationMode)
		if ans.StopReason == string(llm.StopReasonToolUse) {
			ans.StopReason = string(llm.StopReasonStop)
		}
		if ru.cfg.StrictlyGrounded && isRefusal(ans.Text, ru.cfg.RefusalMessage) {
			ans.Refused, ans.Citations = true, []Citation{}
		}
	}
	return nil
}
