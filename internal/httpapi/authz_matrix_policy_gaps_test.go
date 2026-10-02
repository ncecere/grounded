package httpapi_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

// Classification of the gap report (docs/gaps.md): a team's topics and
// their actions are for its editors, admins and owners, in the app.
// Members, API keys and platform staff get 404 (never another team's);
// platform admins and auditors read counts per team only.

func init() {
	for id, p := range gapPolicies {
		p.scope = scopeTeam
		register(id, p)
	}
	register("adminGetGapCounts", policy{scope: scopeGlobal, own: platform, build: func(*mctx) request {
		return get("/v1/admin/analytics/gaps")
	}})
}

func (c *mctx) gapTopic(suffix string) string { return c.team("/gap-topics/" + c.tf.gapTopic + suffix) }

var gapPolicies = map[string]policy{
	"listGapTopics": {own: editors, build: func(c *mctx) request { return get(c.team("/gap-topics?state=all")) }},
	"getGapTopic":   {own: editors, build: func(c *mctx) request { return get(c.gapTopic("")) }},
	"dismissGapTopic": {own: editors, build: func(c *mctx) request {
		return post(c.team("/gap-topics/"+c.pick(c.tf.gapTopic, c.e.freshGapTopic)+"/dismiss"), map[string]any{"reason": "Covered elsewhere."})
	}},
	"fixGapTopic": {own: editors, build: func(c *mctx) request {
		return post(c.team("/gap-topics/"+c.pick(c.tf.gapTopic, c.e.freshGapTopic)+"/fix"), nil)
	}},
	"reopenGapTopic": {own: editors, build: func(c *mctx) request {
		return post(c.team("/gap-topics/"+c.pick(c.tf.gapTopic, c.e.closedGapTopic)+"/reopen"), nil)
	}},
	"addGapTopicSource": {own: editors, build: func(c *mctx) request { return post(c.gapTopic("/add-source"), nil) }},
	"getGapSettings":    {own: editors, build: func(c *mctx) request { return get(c.team("/gap-settings")) }},
	"updateGapSettings": {own: editors, build: func(c *mctx) request {
		p := c.team("/gap-settings")
		return put(p, map[string]any{"confirmSimilar": false}).h(c.rev(p))
	}},
	"addGapQuestionToEvaluations": {own: editors, build: func(c *mctx) request {
		return post(c.gapTopic("/evaluations"), map[string]any{"setId": c.tf.evalSet, "sharedQuestionId": c.tf.gapShared,
			"expected": map[string]any{"filenames": []string{"parking.md"}}})
	}},
}

// seedGapTopic gives a team a topic of 3 askers' failed questions in the
// owner's name, the first shared; team A's carry its markers.
func (e *matrixEnv) seedGapTopic(t *testing.T, f *teamFix, prefix string) (topic, shared string) {
	t.Helper()
	return insertGapTopic(t, e, f, prefix+" parking permits", "Where do "+prefix+" visitors park near the "+contentMarkerFor(prefix)+"?")
}

// freshGapTopic is a new open topic of the team.
func (e *matrixEnv) freshGapTopic(t *testing.T, f *teamFix) string {
	topic, _ := insertGapTopic(t, e, f, fmt.Sprintf("Fresh topic %d", e.next()), "Is the pool open on holidays?")
	return topic
}

// closedGapTopic is a new topic of the team, dismissed as not for its agent.
func (e *matrixEnv) closedGapTopic(t *testing.T, f *teamFix) string {
	topic := e.freshGapTopic(t, f)
	if _, err := e.app.Pool.Exec(context.Background(), `UPDATE gap_topics SET state = 'dismissed', dismiss_kind = 'not_for_agent' WHERE id = $1`,
		topic); err != nil {
		t.Fatalf("close gap topic: %v", err)
	}
	return topic
}

func contentMarkerFor(prefix string) string {
	if prefix == nameMarker {
		return contentMarker
	}
	return "stadium"
}

// insertGapTopic writes a topic and 3 questions of different askers (the
// first shared) directly: the topics job and its embeddings are tested in
// internal/gaps.
func insertGapTopic(t *testing.T, e *matrixEnv, f *teamFix, label, question string) (string, string) {
	t.Helper()
	ctx, pool := context.Background(), e.app.Pool
	var topic, shared, conv uuid.UUID
	// A conversation of its own: the matrix deletes the owner's.
	if err := pool.QueryRow(ctx, `INSERT INTO conversations (agent_id, user_id, title) SELECT agent_id, user_id, 'Gap fixture' FROM conversations
		WHERE id = $1 RETURNING id`, f.conv).Scan(&conv); err != nil {
		t.Fatalf("gap conversation: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO gap_topics (team_id, agent_id, label, labelled_questions) SELECT team_id, id, $2, 3 FROM agents WHERE id = $1 RETURNING id`,
		f.agent, label).Scan(&topic); err != nil {
		t.Fatalf("gap topic: %v", err)
	}
	for i := range 3 {
		var msg, id uuid.UUID
		if err := pool.QueryRow(ctx, `INSERT INTO messages (conversation_id, seq, role, content)
			VALUES ($1, (SELECT coalesce(max(seq), 0) + 1 FROM messages WHERE conversation_id = $1), 'assistant', '[]') RETURNING id`, conv).Scan(&msg); err != nil {
			t.Fatalf("gap message: %v", err)
		}
		// Embedded in the knowledge base's profile, so the topics job leaves it in its topic.
		if err := pool.QueryRow(ctx, `INSERT INTO gap_questions (team_id, agent_id, conversation_id, message_id, question, signals, asker_key, shared,
				topic_id, profile_id, embedding)
			SELECT a.team_id, a.id, $2, $3, $4, ARRAY['no_context'], $5, $6, $7, p.id, array_fill(0.1::real, ARRAY[p.dimensions])::vector
			FROM agents a, knowledge_bases kb JOIN embedding_profiles p ON p.id = kb.embedding_profile_id
			WHERE a.id = $1 AND kb.id = $8 RETURNING gap_questions.id`,
			f.agent, conv, msg, question, fmt.Sprintf("%s-asker-%d", topic, i), i == 0, topic, f.kb).Scan(&id); err != nil {
			t.Fatalf("gap question: %v", err)
		}
		if i == 0 {
			shared = id
		}
	}
	return topic.String(), shared.String()
}
