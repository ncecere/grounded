// Query rewrite (docs/phase3-agents.md §6, queryRewrite): in a conversation, the chat
// model turns the user's latest message into a search query that stands on
// its own ("And for a second copy?" → "How much does a second official
// transcript cost?"). Retrieval is only as good as that query, so the
// rewrite must not fail quietly:
//
//   - reasoning models spend output tokens thinking before they answer, so
//     the rewrite asks for low reasoning effort (when the model supports it)
//     and leaves room for the reasoning;
//   - long earlier answers are shortened in the rewrite's context;
//   - a message that leans on the conversation (short, led by a
//     conjunction, or with a pronoun) that comes back empty or unchanged is
//     searched together with the user's earlier question, and a failed
//     rewrite is logged.

package agents

import (
	"context"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/llm"
)

// Rewrite limits: the turns and characters of context, the output tokens
// (reasoning included) and the longest query accepted.
const (
	rewriteTurns       = 6
	rewriteAnswerChars = 1500
	rewriteMaxTokens   = 1024
	rewriteMaxQuery    = 1000
	rewriteShortWords  = 6
)

// rewrite turns the question into a search query that stands on its own
// (non-streaming). On failure, or when a message that needs the conversation
// comes back unchanged, the earlier questions are searched with it.
func (ru *run) rewrite(ctx context.Context) string {
	rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	msg, err := llm.Complete(rctx, ru.s.NewProvider(ru.target.Client), ru.model,
		llm.Context{SystemPrompt: rewritePrompt, Messages: rewriteContext(ru.history, ru.question)},
		llm.Options{MaxTokens: rewriteMaxTokens, ReasoningEffort: "low", User: ru.userTag()})
	addUsage(&ru.extraUsage, msg.Usage)
	q := cleanRewrite(msg.Text())
	switch {
	case err != nil:
		if ctx.Err() == nil {
			ru.s.Log.Warn("query rewrite failed; searching with the conversation's previous question", "err", err, "agent", ru.agent.ID)
		}
	case q == "":
		ru.s.Log.Warn("query rewrite returned no text; searching with the conversation's previous question", "agent", ru.agent.ID,
			"stopReason", msg.StopReason)
	case utf8.RuneCountInString(q) > rewriteMaxQuery:
		ru.s.Log.Warn("query rewrite was too long; searching with the conversation's previous question", "agent", ru.agent.ID)
	case sameQuery(q, ru.question) && needsContext(ru.question):
		// The model kept a follow-up as it was: it can't be searched alone.
	default:
		return q
	}
	return contextualQuery(ru.history, ru.question)
}

// rewriteContext is the conversation the rewrite reads: the last turns, with
// long answers shortened (the question and its topic are what matter), then
// the latest message.
func rewriteContext(history []llm.Message, question string) []llm.Message {
	recent := history[max(0, len(history)-rewriteTurns):]
	msgs := make([]llm.Message, 0, len(recent)+1)
	for _, m := range recent {
		if a, ok := m.(llm.AssistantMessage); ok {
			if t := a.Text(); utf8.RuneCountInString(t) > rewriteAnswerChars {
				m = llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: truncateRunes(t, rewriteAnswerChars) + " …"}}, StopReason: a.StopReason}
			}
		}
		msgs = append(msgs, m)
	}
	return append(msgs, llm.UserMessage{Content: question})
}

// cleanRewrite trims the model's reply to the query: quotes, a "Query:"
// label and anything after the first line.
func cleanRewrite(s string) string {
	s = strings.TrimSpace(s)
	s, _, _ = strings.Cut(s, "\n")
	s = strings.TrimSpace(s)
	for _, label := range []string{"query:", "search query:", "rewritten query:"} {
		if len(s) >= len(label) && strings.EqualFold(s[:len(label)], label) {
			s = strings.TrimSpace(s[len(label):])
		}
	}
	return strings.TrimSpace(strings.Trim(s, "\"'“”`"))
}

// sameQuery reports a rewrite that only changed case, spacing or the final
// punctuation.
func sameQuery(a, b string) bool {
	norm := func(s string) string {
		return strings.TrimRight(strings.ToLower(strings.Join(strings.Fields(s), " ")), "?.!")
	}
	return norm(a) == norm(b)
}

// followUpLeads start a message that continues the previous one.
var followUpLeads = map[string]bool{
	"and": true, "or": true, "but": true, "also": true, "so": true, "then": true, "plus": true,
	"it": true, "its": true, "that": true, "this": true, "these": true, "those": true, "they": true, "them": true,
	"their": true, "he": true, "she": true, "same": true, "another": true, "other": true, "else": true,
}

// referringWords anywhere in a message point back into the conversation.
var referringWords = map[string]bool{
	"it": true, "its": true, "they": true, "them": true, "their": true, "these": true, "those": true, "this": true,
	"he": true, "she": true, "him": true, "her": true, "his": true,
}

// needsContext reports a message that can't be searched on its own: short
// (a few words), led by a conjunction or a pronoun ("And for a second
// copy?", "What about the fee?", "How about online?"), or referring back
// with a pronoun ("Can I pay for it by card?").
func needsContext(q string) bool {
	words := strings.FieldsFunc(strings.ToLower(q), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '\'' })
	if len(words) == 0 {
		return false
	}
	if len(words) <= rewriteShortWords || followUpLeads[words[0]] {
		return true
	}
	if (words[0] == "what" || words[0] == "how") && words[1] == "about" {
		return true
	}
	for _, w := range words {
		if referringWords[strings.TrimSuffix(w, "'s")] {
			return true
		}
	}
	return false
}

// contextualQuery searches a follow-up together with the user's earlier
// questions when the rewrite couldn't make it stand alone: back to the
// last one that stands on its own, at most two.
func contextualQuery(history []llm.Message, question string) string {
	if !needsContext(question) {
		return question
	}
	parts := []string{question}
	for i := len(history) - 1; i >= 0 && len(parts) < 3; i-- {
		m, ok := history[i].(llm.UserMessage)
		if !ok || strings.TrimSpace(m.Content) == "" {
			continue
		}
		parts = append([]string{truncateRunes(strings.TrimSpace(m.Content), rewriteMaxQuery/3)}, parts...)
		if !needsContext(m.Content) {
			break
		}
	}
	return strings.Join(parts, " ")
}
