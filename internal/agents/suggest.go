// Follow-up suggestions (docs/follow-ups.md, docs/v0.4.1.md §1): once an
// answer with citations has ended, the agent's chat model writes up to 3
// questions that the passages it found can answer. It reads the question,
// the answer and the passages' titles and headings (not the conversation or
// the passages' text), so a suggestion leads to another grounded answer
// rather than a chatty prompt.
//
// It is a separate, small call after message_end and citations_checked: the
// answer, its citations and its checks are untouched, and a failed or
// empty call shows no suggestions. Like an answer, the suggestions pass the
// output moderation check (one check for all of them) or are dropped
// silently. They are sent as the suggestions event before done, never on
// the OpenAI-compatible endpoint or MCP ask (nothing shows them), and
// metered as chat tokens with the feature suggestions.

package agents

import (
	"context"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/tracing"
)

// FeatureSuggestions tags the usage events of follow-up suggestions.
const FeatureSuggestions = "suggestions"

// Suggestion limits: how many are shown, the longest accepted, the call's
// output tokens (reasoning included) and time, and what it reads.
const (
	MaxSuggestions       = 3
	MaxSuggestionChars   = 150
	suggestMaxTokens     = 1024
	suggestTimeout       = 20 * time.Second
	suggestAnswerChars   = 2000
	suggestPassageLines  = 12
	suggestMinChars      = 3
	suggestNoneReply     = "none"
	suggestPassagePrefix = "- "
)

// suggestPrompt asks for follow-up questions the passages answer. The fake
// gateway (testutil) recognises it by "suggest follow-up questions".
const suggestPrompt = `You suggest follow-up questions for a chat with an assistant that answers from a knowledge base.
You are given the user's question, the assistant's answer, and the titles and headings of the passages the assistant found.
Write up to 3 short follow-up questions the user might ask next that these passages answer.
Suggest a question only when the titles and headings show that the passages cover it. Never suggest the question already asked, or one the answer already answers.
Write the questions in the language of the user's question, each under 120 characters.
Reply with one question per line and nothing else, or with NONE when no follow-up qualifies.`

// offersSuggestions reports whether this answer may get suggestions: the
// agent offers them and the answer streams to a client that shows them
// (not the OpenAI-compatible endpoint, MCP ask, JSON replies or evaluation
// runs).
func (ru *run) offersSuggestions() bool {
	return ru.cfg.FollowUpSuggestions && ru.out != nil && ru.out.emit != nil &&
		ru.channel != ChannelOpenAI && ru.channel != ChannelMCP
}

// suggestable reports an answer worth following up: complete, with
// citations, not a refusal, not moderated and not failed.
func suggestable(ans *Answer) bool {
	return ans.ErrorCode == "" && ans.Moderation == nil && !ans.Refused && !ans.NoContext && len(ans.Citations) > 0 &&
		ans.StopReason == string(llm.StopReasonStop) && strings.TrimSpace(ans.Text) != ""
}

// suggest writes, checks, records and sends the answer's suggestions.
func (ru *run) suggest(ctx context.Context, ans *Answer, sources []numberedHit) {
	if !ru.offersSuggestions() || !suggestable(ans) || ctx.Err() != nil {
		return
	}
	passages := suggestionPassages(ans.Citations, sources)
	if len(passages) == 0 {
		return
	}
	ctx, span := tracing.Start(ctx, "agent.suggestions", attribute.String("grounded.agent_id", ru.agent.ID.String()))
	meter := &systemone.Meter{} // a SystemOne moderation check's use, recorded with the suggestions
	ctx = systemone.WithMeter(ctx, meter)
	modBefore, _ := ru.mod.Requests()
	list, usage, err := ru.writeSuggestions(ctx, ans.Text, passages)
	if len(list) > 0 && !ru.suggestionsPass(ctx, list) {
		list = nil
	}
	modAfter, modModel := ru.mod.Requests()
	ru.recordSuggestionUsage(ctx, usage, modAfter-modBefore, modModel, meter)
	span.SetAttributes(attribute.Int("grounded.suggestions", len(list)))
	tracing.End(span, err)
	if len(list) == 0 {
		return
	}
	ans.Suggestions = list
	ru.out.send(Event{"suggestions", SuggestionsEvent{MessageID: ans.MessageID, Suggestions: list}})
}

// replaySuggestions sends a saved answer's suggestions (cache.go).
func (ru *run) replaySuggestions(ans *Answer, saved []string) {
	if len(saved) == 0 || !ru.offersSuggestions() {
		return
	}
	ans.Suggestions = saved
	ru.out.send(Event{"suggestions", SuggestionsEvent{MessageID: ans.MessageID, Suggestions: saved}})
}

// writeSuggestions is the model call: low reasoning effort (off when the
// answer's is off and the model can turn thinking off, as for the query
// rewrite), bounded in tokens and time.
func (ru *run) writeSuggestions(ctx context.Context, answer string, passages []string) ([]string, llm.Usage, error) {
	sctx, cancel := context.WithTimeout(ctx, suggestTimeout)
	defer cancel()
	msg, err := llm.Complete(sctx, ru.s.NewProvider(ru.target.Client), ru.model,
		llm.Context{SystemPrompt: suggestPrompt, Messages: []llm.Message{llm.UserMessage{Content: suggestionInput(ru.question, answer, passages)}}},
		llm.Options{MaxTokens: suggestMaxTokens, ReasoningEffort: ru.rewriteEffort(), User: ru.userTag()})
	if err != nil {
		if ctx.Err() == nil {
			ru.s.Log.Warn("follow-up suggestions failed; none are shown", "err", err, "agent", ru.agent.ID)
		}
		return nil, msg.Usage, err
	}
	return parseSuggestions(msg.Text(), ru.question), msg.Usage, nil
}

// suggestionsPass checks the suggestions like an answer when answers are
// moderated: one check for all of them. A failed check (blocked, or the
// provider failed) drops them.
func (ru *run) suggestionsPass(ctx context.Context, list []string) bool {
	if !ru.mod.Active(moderation.StageOutput) {
		return true
	}
	d := ru.mod.Check(ctx, moderation.Input{Stage: moderation.StageOutput, Text: strings.Join(list, "\n"), Question: ru.question})
	return !d.Blocked && d.Outcome != moderation.DecisionError
}

// suggestionInput is the call's message: the question, the answer
// (shortened) and one line per passage, "Title › Heading › Subheading".
func suggestionInput(question, answer string, passages []string) string {
	var b strings.Builder
	b.WriteString("Question: ")
	b.WriteString(question)
	b.WriteString("\n\nAnswer:\n")
	b.WriteString(truncateRunes(stripMarkers(answer), suggestAnswerChars))
	b.WriteString("\n\nPassages (title › headings):\n")
	for _, p := range passages {
		b.WriteString(suggestPassagePrefix + p + "\n")
	}
	return b.String()
}

// markerRun matches citation markers ([1], [1, 2]) and the space before.
var markerRun = regexp.MustCompile(`\s*\[\d+(?:\s*,\s*\d+)*\]`)

func stripMarkers(s string) string { return markerRun.ReplaceAllString(s, "") }

// suggestionPassages are the passages' titles and headings, the cited ones
// first, then the others the answer was given, once each; tools' results
// and conflicting passages are left out.
func suggestionPassages(cites []Citation, sources []numberedHit) []string {
	var out []string
	seen := map[string]bool{}
	add := func(title string, headings []string) {
		line := passageLine(title, headings)
		if line == "" || seen[line] || len(out) >= suggestPassageLines {
			return
		}
		seen[line] = true
		out = append(out, line)
	}
	for _, c := range cites {
		if c.Kind != SourceTool {
			add(c.Title, c.HeadingPath)
		}
	}
	for _, h := range sources {
		if h.Tool == nil && !h.Conflicting {
			add(h.Title, h.HeadingPath)
		}
	}
	return out
}

// passageLine is "Title › Heading › Subheading" on one line.
func passageLine(title string, headings []string) string {
	parts := make([]string, 0, len(headings)+1)
	for _, p := range append([]string{title}, headings...) {
		if p = strings.Join(strings.Fields(p), " "); p != "" && (len(parts) == 0 || parts[len(parts)-1] != p) {
			parts = append(parts, p)
		}
	}
	return truncateRunes(strings.Join(parts, " › "), 300)
}

// listLead matches a list marker or label at the start of a line: "- ",
// "1. ", "2) ", "Q1: ".
var listLead = regexp.MustCompile(`^(?:[-*•–]+|\d+[.)]|[Qq]\d+:)\s*`)

// parseSuggestions reads the model's reply defensively: one question per
// line, list markers, quotes, emphasis and citation markers removed;
// empty, over-long or duplicate lines, labels, NONE and the question asked
// are dropped; at most MaxSuggestions are kept.
func parseSuggestions(reply, question string) []string {
	var out []string
	for _, line := range strings.Split(reply, "\n") {
		q := cleanSuggestion(line)
		n := utf8.RuneCountInString(q)
		switch {
		case n < suggestMinChars, n > MaxSuggestionChars, !strings.ContainsFunc(q, unicode.IsLetter),
			strings.EqualFold(strings.TrimRight(q, ".!"), suggestNoneReply), strings.HasSuffix(q, ":"),
			sameQuery(q, question), containsQuery(out, q):
			continue
		}
		out = append(out, q)
		if len(out) == MaxSuggestions {
			break
		}
	}
	return out
}

// cleanSuggestion trims one line of the reply to its question.
func cleanSuggestion(line string) string {
	q := strings.TrimSpace(line)
	q = strings.TrimSpace(listLead.ReplaceAllString(q, ""))
	q = strings.ReplaceAll(strings.ReplaceAll(q, "**", ""), "__", "")
	q = strings.TrimSpace(strings.Trim(stripMarkers(q), "\"'“”‘’`"))
	return strings.Join(strings.Fields(NormalizePunctuation(q)), " ")
}

// containsQuery reports a suggestion already in list (sameQuery).
func containsQuery(list []string, q string) bool {
	for _, s := range list {
		if sameQuery(s, q) {
			return true
		}
	}
	return false
}

// recordSuggestionUsage writes the call's usage events (chat tokens, and
// the moderation check's requests), tagged feature suggestions, after the
// answer's own were recorded.
func (ru *run) recordSuggestionUsage(ctx context.Context, u llm.Usage, modReqs int64, modModel uuid.UUID, meter *systemone.Meter) {
	meta := ru.usageMetadata(map[string]any{"feature": FeatureSuggestions})
	model := uuid.NullUUID{UUID: ru.target.Model.ID, Valid: ru.target.Model.ID != uuid.Nil}
	var usage []dbgen.InsertUsageParams
	if u.Input > 0 {
		usage = append(usage, dbgen.InsertUsageParams{Kind: limits.UsageChatIn, Quantity: int64(u.Input), ModelID: model, Metadata: meta})
	}
	if u.Output > 0 {
		usage = append(usage, dbgen.InsertUsageParams{Kind: limits.UsageChatOut, Quantity: int64(u.Output), ModelID: model, Metadata: meta})
	}
	if modReqs > 0 {
		usage = append(usage, dbgen.InsertUsageParams{Kind: moderation.UsageKind, Quantity: modReqs,
			ModelID: uuid.NullUUID{UUID: modModel, Valid: true}, Metadata: meta})
	}
	for _, e := range meter.Entries() {
		usage = append(usage, e.UsageParams(ru.usageMetadata(map[string]any{"feature": e.Feature}))...)
	}
	if len(usage) == 0 {
		return
	}
	ctx = context.WithoutCancel(ctx)
	team, agent := uuid.NullUUID{UUID: ru.team.ID, Valid: true}, uuid.NullUUID{UUID: ru.agent.ID, Valid: true}
	for i := range usage {
		usage[i].TeamID, usage[i].AgentID, usage[i].UserID, usage[i].APIKeyID = team, agent, nullUser(ru.a), keyID(ru.a)
		if err := ru.s.q.InsertUsage(ctx, usage[i]); err != nil {
			ru.s.Log.Error("record follow-up suggestion usage", "err", err, "agent", ru.agent.ID)
			return
		}
	}
	if ru.s.Limits != nil {
		ru.s.Limits.Recorded(ru.team.ID, usage)
	}
}
