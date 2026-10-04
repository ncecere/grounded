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
	"slices"
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
	suggestTimeout       = 10 * time.Second
	suggestAnswerChars   = 2000
	suggestPassageLines  = 12
	suggestMinChars      = 3
	suggestNoneReply     = "none"
	suggestPassagePrefix = "- "
)

// suggestPrompt asks for follow-up questions the passages answer. The fake
// gateway (testutil) recognises it by "suggest follow-up questions". Each
// question must come from one listed passage and add to the answer
// (walkthrough, 2026-10-02: suggestions repeated what the answer said, and
// one joined two passages' topics into a question neither answers).
const suggestPrompt = `You suggest follow-up questions for a chat with an assistant that answers from a knowledge base.
You are given the user's question, the assistant's answer, and the titles and headings of the passages the assistant found, one passage per line.
Write up to 3 short follow-up questions the user might ask next. Each question must:
- be answered by one listed passage, as its title or headings show;
- stay within that one passage: never combine topics, names or terms from different passages;
- ask for something the answer doesn't already say (not its facts, numbers, times, steps or names again), and not repeat or reword the question asked;
- be a complete question ending with a question mark, never a title, heading or topic on its own.
Fewer questions, or none, are better than a weak one.
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

// replaySuggestions sends a saved answer's suggestions (cache.go). Ones
// saved before v0.4.2 checked they were questions are checked now.
func (ru *run) replaySuggestions(ans *Answer, saved []string) {
	saved = slices.DeleteFunc(slices.Clone(saved), func(q string) bool { return !isQuestion(q) })
	if len(saved) == 0 || !ru.offersSuggestions() {
		return
	}
	ans.Suggestions = saved
	ru.out.send(Event{"suggestions", SuggestionsEvent{MessageID: ans.MessageID, Suggestions: saved}})
}

// writeSuggestions is the model call, bounded in tokens and time, with
// thinking off whenever the model can turn it off (suggestEffort).
func (ru *run) writeSuggestions(ctx context.Context, answer string, passages []string) ([]string, llm.Usage, error) {
	sctx, cancel := context.WithTimeout(ctx, suggestTimeout)
	defer cancel()
	msg, err := llm.Complete(sctx, ru.s.NewProvider(ru.target.Client), ru.model,
		llm.Context{SystemPrompt: suggestPrompt, Messages: []llm.Message{llm.UserMessage{Content: suggestionInput(ru.question, answer, passages)}}},
		llm.Options{MaxTokens: suggestMaxTokens, ReasoningEffort: suggestEffort(ru.model.Compat.ThinkingOff), User: ru.userTag()})
	if err != nil {
		if ctx.Err() == nil {
			ru.s.Log.Warn("follow-up suggestions failed; none are shown", "err", err, "agent", ru.agent.ID)
		}
		return nil, msg.Usage, err
	}
	return parseSuggestions(msg.Text(), ru.question, passages), msg.Usage, nil
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
// empty, over-long or duplicate lines, labels, NONE, lines that aren't
// questions (a passage's title, v0.4.2 US-04), a passage's title or
// headings and the question asked are dropped; at most MaxSuggestions are
// kept.
func parseSuggestions(reply, question string, passages []string) []string {
	var out []string
	for _, line := range strings.Split(reply, "\n") {
		q := cleanSuggestion(line)
		n := utf8.RuneCountInString(q)
		switch {
		case n < suggestMinChars, n > MaxSuggestionChars, !strings.ContainsFunc(q, unicode.IsLetter),
			strings.EqualFold(strings.TrimRight(q, ".!"), suggestNoneReply), strings.HasSuffix(q, ":"), !isQuestion(q),
			sameSuggestion(q, question), containsQuery(out, q), namesPassage(q, passages):
			continue
		}
		out = append(out, q)
		if len(out) == MaxSuggestions {
			break
		}
	}
	return out
}

// questionMarks end a question: ASCII, full-width (Chinese, Japanese),
// Arabic and Greek.
const questionMarks = "?？؟;"

// questionWords start a question in the languages people ask in most
// (English, Spanish, French, German, Portuguese, Italian, Dutch): a
// question without its mark still counts.
var questionWords = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`how what when where which who whom whose why can could do does did is are was were will would should
		shall may might
		cómo como qué que cuándo cuando dónde donde cuál cual cuáles quién quien quiénes por puedo puede hay
		comment quand où pourquoi qui quel quelle quels quelles quoi est-ce combien puis-je peut-on
		wie was wann wo warum wer welche welcher welches wieso weshalb kann darf gibt muss
		quando onde porque quem qual quais posso pode
		dove perché chi quale quali cosa quanto quanti posso
		hoe wat wanneer waar waarom wie welke kan mag`) {
		questionWords[w] = true
	}
}

// isQuestion reports a line that is a question: it ends with a question
// mark, opens with ¿, or starts with a question word.
func isQuestion(q string) bool {
	q = strings.TrimSpace(q)
	if q == "" {
		return false
	}
	if last, _ := utf8.DecodeLastRuneInString(q); strings.ContainsRune(questionMarks, last) || strings.HasPrefix(q, "¿") {
		return true
	}
	words := strings.FieldsFunc(q, func(r rune) bool { return unicode.IsSpace(r) || r == ',' || r == '\'' || r == '’' })
	return len(words) > 0 && questionWords[strings.ToLower(words[0])]
}

// namesPassage reports a suggestion that is only a passage's title or one
// of its headings.
func namesPassage(q string, passages []string) bool {
	for _, p := range passages {
		for _, part := range strings.Split(p, " › ") {
			if sameSuggestion(q, part) {
				return true
			}
		}
	}
	return false
}

// cleanSuggestion trims one line of the reply to its question.
func cleanSuggestion(line string) string {
	q := strings.TrimSpace(line)
	q = strings.TrimSpace(listLead.ReplaceAllString(q, ""))
	q = strings.ReplaceAll(strings.ReplaceAll(q, "**", ""), "__", "")
	q = strings.TrimSpace(strings.Trim(stripMarkers(q), "\"'“”‘’`"))
	return strings.Join(strings.Fields(NormalizePunctuation(q)), " ")
}

// sameSuggestion reports two questions that differ only in case, spacing
// or the final punctuation (also full-width).
func sameSuggestion(a, b string) bool {
	norm := func(s string) string {
		return strings.ToLower(strings.Join(strings.Fields(strings.TrimRight(s, "?.!？。！ ")), " "))
	}
	return norm(a) == norm(b)
}

// containsQuery reports a suggestion already in list.
func containsQuery(list []string, q string) bool {
	return slices.ContainsFunc(list, func(s string) bool { return sameSuggestion(s, q) })
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

// suggestEffort is the suggestion call's reasoning effort: off whenever the
// model can turn thinking off, whatever the answer's effort (three short
// questions gain nothing from reasoning, and a reasoning model thinking at
// length would use the call's tokens and time up), otherwise low. Low is
// sent only to models that accept a reasoning effort.
func suggestEffort(thinkingOff string) string {
	if thinkingOff != "" {
		return llm.EffortOff
	}
	return "low"
}
