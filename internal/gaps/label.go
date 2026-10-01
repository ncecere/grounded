// Topic labels (docs/v0.4.0.md §2, owner decision 3): once a topic has
// MinAskers different askers, the agent's chat model writes its 2-5 word
// label from the topic's questions, and nothing else (no agent
// instructions, sources or other topics). The tokens are metered to the
// team (usage source "gaps"). A topic is labelled again when it has doubled
// since its label was written.

package gaps

import (
	"context"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

const (
	// labelQuestions bounds the questions a label is written from, and
	// labelQuestionChars each question.
	labelQuestions     = 20
	labelQuestionChars = 300
	labelMaxWords      = 5
	labelMaxChars      = 80
	labelMaxTokens     = 1024
	labelTopicsPerRun  = 20
)

// LabelPrompt is the system prompt of a label request.
const LabelPrompt = "You name a group of questions that people asked an assistant and that it could not answer well. " +
	"Reply with one short topic label of 2 to 5 words, in the language of the questions, in sentence case, " +
	"with no quotes and no full stop. Name the subject the questions are about. " +
	"Never include names of people, email addresses, ID numbers or other personal details."

// labelCandidates are open topics with at least MinAskers askers that have
// no label, or doubled since it was written; with the agent's chat model.
const labelCandidates = `
SELECT t.id, t.team_id, t.agent_id, tm.slug, a.slug, v.chat_model_id, s.questions
FROM gap_topics t
JOIN agents a ON a.id = t.agent_id AND a.deleted_at IS NULL
JOIN teams tm ON tm.id = t.team_id
JOIN agent_versions v ON v.id = a.published_version_id
JOIN LATERAL (
    SELECT count(*)::int AS questions, count(DISTINCT q.asker_key)::int AS askers
    FROM gap_questions q JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
    WHERE q.topic_id = t.id
) s ON s.askers >= $1
WHERE t.state = 'open' AND (t.label = '' OR s.questions >= 2 * t.labelled_questions)
ORDER BY t.updated_at
LIMIT $2`

type labelTarget struct {
	id, teamID, agentID, modelID uuid.UUID
	team, agent                  string
	questions                    int32
}

// labelTopics labels the candidates. A failed label is logged and tried
// again next run.
func (r *Runner) labelTopics(ctx context.Context) (int, error) {
	rows, err := r.Pool.Query(ctx, labelCandidates, MinAskers, labelTopicsPerRun)
	if err != nil {
		return 0, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (labelTarget, error) {
		var t labelTarget
		return t, row.Scan(&t.id, &t.teamID, &t.agentID, &t.team, &t.agent, &t.modelID, &t.questions)
	})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, t := range list {
		if r.Budget != nil && r.Budget(ctx, t.teamID) != nil {
			continue // the team's budget is used up: no label this run
		}
		if err := r.label(ctx, t); err != nil {
			r.log().WarnContext(ctx, "could not label a gap topic; trying again next run", "topic", t.id, "err", err)
			continue
		}
		n++
	}
	return n, nil
}

// label writes one topic's label.
func (r *Runner) label(ctx context.Context, t labelTarget) error {
	rows, err := r.Pool.Query(ctx, `SELECT q.question FROM gap_questions q
		JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
		WHERE q.topic_id = $1 ORDER BY q.created_at DESC LIMIT $2`, t.id, labelQuestions)
	if err != nil {
		return err
	}
	questions, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	target, err := r.Catalog.ChatTarget(ctx, t.modelID)
	if err != nil {
		return err
	}
	newProvider := r.NewProvider
	if newProvider == nil {
		newProvider = func(c *gateway.Client) llm.Provider { return llm.NewOpenAI(c) }
	}
	lctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	msg, err := llm.Complete(lctx, newProvider(target.Client), llm.ModelFromRow(target.Model),
		llm.Context{SystemPrompt: LabelPrompt, Messages: []llm.Message{llm.UserMessage{Content: LabelRequest(questions)}}},
		llm.Options{MaxTokens: labelMaxTokens, ReasoningEffort: "low", User: llm.UserTag(t.team, t.agent)})
	if err != nil {
		return err
	}
	label := CleanLabel(msg.Text())
	return pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		for kind, n := range map[string]int{limits.UsageChatIn: msg.Usage.Input, limits.UsageChatOut: msg.Usage.Output} {
			if n > 0 {
				if err := q.InsertUsage(ctx, usage(kind, int64(n), t.teamID, t.agentID, target.Model.ID)); err != nil {
					return err
				}
			}
		}
		if label == "" {
			return nil
		}
		_, err := tx.Exec(ctx, `UPDATE gap_topics SET label = $2, labelled_questions = $3, labelled_at = now(), updated_at = now() WHERE id = $1`,
			t.id, label, t.questions)
		return err
	})
}

// LabelRequest is the user message of a label request: the questions only.
func LabelRequest(questions []string) string {
	var b strings.Builder
	b.WriteString("Questions:\n")
	for _, q := range questions {
		q = strings.Join(strings.Fields(q), " ")
		if utf8.RuneCountInString(q) > labelQuestionChars {
			q = string([]rune(q)[:labelQuestionChars]) + "…"
		}
		b.WriteString("- " + q + "\n")
	}
	return b.String()
}

// CleanLabel turns the model's reply into a label: its first line, without
// a "Label:" lead, quotes or a trailing full stop, at most 5 words and 80
// characters ("" when nothing is left).
func CleanLabel(s string) string {
	s = strings.TrimSpace(s)
	s, _, _ = strings.Cut(s, "\n")
	for _, lead := range []string{"topic label:", "label:", "topic:"} {
		if len(s) >= len(lead) && strings.EqualFold(s[:len(lead)], lead) {
			s = s[len(lead):]
		}
	}
	s = strings.Trim(strings.TrimSpace(s), "\"'“”‘’`*_#")
	words := strings.Fields(s)
	if len(words) > labelMaxWords {
		words = words[:labelMaxWords]
	}
	s = strings.Join(words, " ")
	s = strings.TrimRightFunc(s, func(r rune) bool { return unicode.IsPunct(r) || unicode.IsSpace(r) })
	if utf8.RuneCountInString(s) > labelMaxChars {
		s = strings.TrimSpace(string([]rune(s)[:labelMaxChars]))
	}
	if s == "" {
		return ""
	}
	r, size := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + s[size:]
}
