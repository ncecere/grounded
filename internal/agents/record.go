// Recording an answer: the stored assistant message, the usage ledger and
// the analytics event (message_events).

package agents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func addUsage(dst *llm.Usage, u llm.Usage) {
	dst.Input += u.Input
	dst.Output += u.Output
	dst.Reasoning += u.Reasoning
	dst.CacheRead += u.CacheRead
	dst.CacheWrite += u.CacheWrite
	dst.Total += u.Total
}

// record stores the answer (for user conversations), usage events and one
// message_events row. It runs even when the request was cancelled.
func (ru *run) record(ctx context.Context, ans *Answer, msg *llm.AssistantMessage, results []llm.ToolResultMessage) {
	ctx = context.WithoutCancel(ctx)
	ans.Latency = time.Since(ru.started)
	if !ru.answeredAt.IsZero() { // a streamed answer's citation check came after it
		ans.Latency = ru.answeredAt.Sub(ru.started)
	}
	latency := int32(ans.Latency.Milliseconds())
	observability.ObserveChat(ru.channel, chatOutcome(ans), ans.Latency, ru.firstToken)
	modelID := uuid.NullUUID{UUID: ru.target.Model.ID, Valid: ru.target.Model.ID != uuid.Nil}
	err := store.InTx(ctx, ru.s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		messageID := uuid.NullUUID{}
		if ru.persist && ru.conv != nil {
			if err := ru.storeAnswer(ctx, q, ans, msg, results, modelID, latency); err != nil {
				return err
			}
			messageID = uuid.NullUUID{UUID: ans.MessageID, Valid: true}
			ans.Persisted = true
		}
		if err := ru.recordUsage(ctx, q, ans, modelID); err != nil {
			return err
		}
		return q.InsertMessageEvent(ctx, ru.messageEvent(ans, messageID, modelID, latency))
	})
	if err != nil {
		ru.s.Log.Error("record answer", "err", err, "agent", ru.agent.ID)
		return
	}
	if ru.s.Limits != nil {
		ru.s.Limits.Recorded(ru.team.ID, ru.usage)
	}
}

// Chat outcomes (grounded_chat_answers_total).
const (
	OutcomeOK        = "ok"
	OutcomeNoAnswer  = "no_answer" // refused or nothing to answer from
	OutcomeModerated = "moderated" // moderation replaced the question's answer or the answer
	OutcomeModelBusy = "model_busy"
	OutcomeAborted   = "aborted" // the caller went away
	OutcomeError     = "error"
)

// chatOutcome classifies a recorded answer for metrics.
func chatOutcome(ans *Answer) string {
	switch {
	case ans.ErrorCode == ErrCodeAborted:
		return OutcomeAborted
	case ans.ErrorCode == ErrCodeModelBusy:
		return OutcomeModelBusy
	case ans.Moderation != nil:
		return OutcomeModerated
	case ans.ErrorCode != "":
		return OutcomeError
	case ans.Refused || ans.NoContext:
		return OutcomeNoAnswer
	default:
		return OutcomeOK
	}
}

// storeAnswer appends the answer and its tool results to the conversation.
func (ru *run) storeAnswer(ctx context.Context, q *dbgen.Queries, ans *Answer, msg *llm.AssistantMessage, results []llm.ToolResultMessage, modelID uuid.NullUUID, latency int32) error {
	if msg == nil {
		msg = &llm.AssistantMessage{Model: ru.model.ID, StopReason: llm.StopReason(ans.StopReason)}
	}
	content, _ := json.Marshal(msg.Content)
	if msg.Content == nil {
		content = json.RawMessage("[]")
	}
	cites, _ := json.Marshal(ans.Citations)
	usage, _ := json.Marshal(ans.Usage)
	code := ans.ErrorCode
	if ans.storedCode != "" {
		code = ans.storedCode
	}
	seq, err := q.NextMessageSeq(ctx, ru.conv.ID)
	if err != nil {
		return err
	}
	if _, err := q.InsertMessage(ctx, dbgen.InsertMessageParams{
		ID: ans.MessageID, ConversationID: ru.conv.ID, Seq: seq, Role: "assistant", Content: content,
		Citations: cites, AgentVersionID: ru.versionID(), ModelID: modelID, Usage: usage,
		StopReason: ans.StopReason, ErrorCode: code, LatencyMs: &latency,
	}); err != nil {
		return err
	}
	for i, r := range results {
		raw, _ := json.Marshal(r)
		if _, err := q.InsertMessage(ctx, dbgen.InsertMessageParams{
			ID: uuid.New(), ConversationID: ru.conv.ID, Seq: seq + 1 + int32(i), Role: "tool_result", Content: raw,
			AgentVersionID: ru.versionID(),
		}); err != nil {
			return err
		}
	}
	return q.TouchConversation(ctx, dbgen.TouchConversationParams{ID: ru.conv.ID, LastVersionID: ru.versionID()})
}

// recordUsage writes the usage ledger: the query, chat tokens, embedding
// tokens, moderation requests and SystemOne use.
func (ru *run) recordUsage(ctx context.Context, q *dbgen.Queries, ans *Answer, modelID uuid.NullUUID) error {
	meta := ru.usageMetadata(nil)
	team := uuid.NullUUID{UUID: ru.team.ID, Valid: true}
	agent := uuid.NullUUID{UUID: ru.agent.ID, Valid: true}
	usage := []dbgen.InsertUsageParams{{Kind: limits.UsageQuery, Quantity: 1}}
	if ans.Usage.Input > 0 {
		usage = append(usage, dbgen.InsertUsageParams{Kind: limits.UsageChatIn, Quantity: int64(ans.Usage.Input), ModelID: modelID})
	}
	if ans.Usage.Output > 0 {
		usage = append(usage, dbgen.InsertUsageParams{Kind: limits.UsageChatOut, Quantity: int64(ans.Usage.Output), ModelID: modelID})
	}
	for m, n := range ru.retr.embedTokens {
		usage = append(usage, dbgen.InsertUsageParams{Kind: "embed_tokens", Quantity: int64(n), ModelID: uuid.NullUUID{UUID: m, Valid: true}})
	}
	if n, m := ru.mod.Requests(); n > 0 {
		usage = append(usage, dbgen.InsertUsageParams{Kind: moderation.UsageKind, Quantity: n, ModelID: uuid.NullUUID{UUID: m, Valid: true}})
	}
	for i := range usage {
		usage[i].Metadata = meta
	}
	usage = append(usage, ru.systemOneUsage()...)
	for i := range usage {
		usage[i].TeamID, usage[i].AgentID, usage[i].UserID, usage[i].APIKeyID = team, agent, nullUser(ru.a), keyID(ru.a)
		if err := q.InsertUsage(ctx, usage[i]); err != nil {
			return err
		}
	}
	ru.usage = usage
	return nil
}

// messageEvent is the answer's analytics row: no content, no user ID.
func (ru *run) messageEvent(ans *Answer, messageID, modelID uuid.NullUUID, latency int32) dbgen.InsertMessageEventParams {
	ev := dbgen.InsertMessageEventParams{
		TeamID: ru.team.ID, AgentID: ru.agent.ID, AgentVersionID: ru.versionID(), MessageID: messageID,
		Channel: ru.channel, AudienceType: ru.grant, ModelID: modelID, LatencyMs: latency,
		InputTokens: int32(ans.Usage.Input), OutputTokens: int32(ans.Usage.Output), ReasoningTokens: int32(ans.Usage.Reasoning),
		HitCount: int32(len(ans.Sources)), NoContext: ans.NoContext, Refused: ans.Refused, ToolCalls: int32(ans.toolCalls),
		CitedDocumentIds: citedDocuments(ans.Citations), StopReason: ans.StopReason, ErrorCode: ans.ErrorCode,
		PseudonymousUser: ru.pseudonym(),
	}
	ev.ModerationInput, ev.ModerationOutput = ru.moderationRecords()
	ev.Judging = ru.judgingJSON(ans)
	ev.Citations, ev.Scope = ru.citationsJSON(), ru.scopeJSON()
	if ru.firstToken > 0 {
		ft := int32(ru.firstToken.Milliseconds())
		ev.FirstTokenMs = &ft
	}
	if len(ans.Sources) > 0 {
		ev.TopSimilarity = pgtype.Float4{Float32: float32(ru.retr.topSim), Valid: true}
	}
	return ev
}

// citedDocuments lists the cited documents once each, in citation order.
func citedDocuments(cites []Citation) []uuid.UUID {
	docs := []uuid.UUID{}
	seen := map[uuid.UUID]bool{}
	for _, c := range cites {
		if !seen[c.DocumentID] {
			seen[c.DocumentID] = true
			docs = append(docs, c.DocumentID)
		}
	}
	return docs
}
