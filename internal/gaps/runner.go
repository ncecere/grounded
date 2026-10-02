// The topics job (docs/v0.4.0.md §2, owner decisions 3 and 4): every hour
// it embeds failed questions that have no vector yet, groups each agent's
// new questions into topics by cosine similarity (pgvector) with their
// nearest questions and the topics' centroids, so topic IDs stay stable
// between runs (grouping.go), merges topics that grew alike (merge.go),
// reopens closed topics that newer failures joined (not those dismissed as
// not for the agent), resolves open topics whose questions are now
// answered well, labels topics that reached MinAskers with the agent's chat
// model (label.go), and prunes topics whose questions are all gone.

package gaps

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// ResolveAfter is how many good answers to a topic's questions, after its
// last failure, resolve it.
const ResolveAfter = 2

const (
	// lockKey is the job's advisory lock ("gaps" in ASCII): one run at a time.
	lockKey = 0x67617073
	// assignBatch bounds the questions grouped per run; embedBatch the
	// questions per embedding request; embedLimit the questions embedded
	// per run.
	assignBatch = 2000
	embedBatch  = 32
	embedLimit  = 1000
)

// Runner runs the topics job.
type Runner struct {
	Pool    *pgxpool.Pool
	Catalog *catalog.Service
	// NewProvider builds the chat model provider for labels (default: the
	// OpenAI-compatible adapter).
	NewProvider func(*gateway.Client) llm.Provider
	// Budget refuses labels while the team's budget is used up (nil: none).
	Budget func(ctx context.Context, teamID uuid.UUID) error
	// SystemOne returns the platform's SystemOne client, or nil without a
	// usable model (nil: borderline pairs are never confirmed).
	SystemOne func(ctx context.Context) (*systemone.Client, error)
	Log       *slog.Logger
}

// Summary is one run's counts.
type Summary struct {
	Embedded, Assigned, NewTopics, Merged, Reopened, Resolved, Labelled, Pruned int
	// Confirmed counts the SystemOne same-subject checks answered.
	Confirmed int
}

func (r *Runner) log() *slog.Logger {
	if r.Log == nil {
		return slog.Default()
	}
	return r.Log
}

// Run runs every step once, under a cross-worker lock (a run that finds the
// lock taken does nothing). Its SystemOne checks run at background priority
// (docs/v0.4.1.md §4), behind answers waiting for the same connection.
func (r *Runner) Run(ctx context.Context) (Summary, error) {
	var sum Summary
	ctx = systemone.WithPriority(ctx, systemone.Background)
	conn, err := r.Pool.Acquire(ctx)
	if err != nil {
		return sum, err
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, lockKey).Scan(&locked); err != nil || !locked {
		return sum, err
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, lockKey) }()
	if sum.Embedded, err = r.embedPending(ctx); err != nil {
		return sum, err
	}
	cf := r.confirmer()
	err = r.assign(ctx, &sum, cf)
	if err == nil {
		err = r.merge(ctx, &sum, cf)
	}
	sum.Confirmed = cf.Asked
	if err != nil {
		return sum, err
	}
	if sum.Resolved, err = r.resolve(ctx); err != nil {
		return sum, err
	}
	if sum.Labelled, err = r.labelTopics(ctx); err != nil {
		return sum, err
	}
	sum.Pruned, err = r.prune(ctx)
	return sum, err
}

// pending is a question to embed.
type pending struct {
	id, teamID, agentID, profileID uuid.UUID
	text, team, agent              string
}

// pendingSQL lists questions without a vector in their agent's profile
// (captured without one, or whose profile was deleted): the question's
// profile, else the lowest profile ID among the published version's
// knowledge bases (as the chat pipeline picks it, internal/agents gaps.go).
const pendingSQL = `
SELECT q.id, q.team_id, q.agent_id, coalesce(q.profile_id, p.profile_id), q.question, t.slug, a.slug
FROM gap_questions q
JOIN agents a ON a.id = q.agent_id
JOIN teams t ON t.id = q.team_id
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
LEFT JOIN LATERAL (
    SELECT kb.embedding_profile_id AS profile_id FROM agent_version_kbs avk JOIN knowledge_bases kb ON kb.id = avk.kb_id
    WHERE avk.version_id = a.published_version_id ORDER BY kb.embedding_profile_id LIMIT 1
) p ON true
WHERE (q.embedding IS NULL OR q.profile_id IS NULL) AND coalesce(q.profile_id, p.profile_id) IS NOT NULL
ORDER BY q.agent_id, q.created_at
LIMIT $1`

// embedPending embeds questions without a vector, a batch per agent and
// profile, and meters the tokens to the team (usage source "gaps"). A
// profile that can't embed now is skipped until the next run.
func (r *Runner) embedPending(ctx context.Context) (int, error) {
	rows, err := r.Pool.Query(ctx, pendingSQL, embedLimit)
	if err != nil {
		return 0, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pending, error) {
		var p pending
		err := row.Scan(&p.id, &p.teamID, &p.agentID, &p.profileID, &p.text, &p.team, &p.agent)
		return p, err
	})
	if err != nil {
		return 0, err
	}
	done := 0
	for start := 0; start < len(list); {
		end := start + 1
		for end < len(list) && end-start < embedBatch && list[end].agentID == list[start].agentID && list[end].profileID == list[start].profileID {
			end++
		}
		n, err := r.embed(ctx, list[start:end])
		if err != nil {
			r.log().WarnContext(ctx, "could not embed failed questions; trying again next run", "agent", list[start].agentID, "err", err)
		}
		done += n
		start = end
	}
	return done, nil
}

// embed embeds one batch (one agent, one profile) and stores the vectors.
func (r *Runner) embed(ctx context.Context, batch []pending) (int, error) {
	first := batch[0]
	target, err := r.Catalog.EmbedTarget(ctx, first.profileID)
	if err != nil {
		return 0, err
	}
	texts := make([]string, len(batch))
	for i, p := range batch {
		texts[i] = target.Profile.QueryPrefix + p.text
	}
	res, err := target.Embed(ctx, texts, llm.UserTag(first.team, first.agent))
	if err != nil {
		return 0, err
	}
	err = pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
		for i, p := range batch {
			if i >= len(res.Vectors) {
				break
			}
			if _, err := tx.Exec(ctx, `UPDATE gap_questions SET embedding = $2::text::vector, profile_id = $3,
				topic_id = CASE WHEN profile_id IS DISTINCT FROM $3 THEN NULL ELSE topic_id END, updated_at = now() WHERE id = $1`,
				p.id, agents.VectorText(res.Vectors[i]), p.profileID); err != nil {
				return err
			}
		}
		if res.Usage.TotalTokens <= 0 {
			return nil
		}
		return dbgen.New(tx).InsertUsage(ctx, usage("embed_tokens", int64(res.Usage.TotalTokens), first.teamID, first.agentID, target.Model.ID))
	})
	if err != nil {
		return 0, err
	}
	return min(len(batch), len(res.Vectors)), nil
}

// usage is a usage event of the job, metered to the team and agent.
func usage(kind string, n int64, teamID, agentID, modelID uuid.UUID) dbgen.InsertUsageParams {
	meta, _ := json.Marshal(map[string]any{"source": "gaps"})
	return dbgen.InsertUsageParams{Kind: kind, Quantity: n, TeamID: uuid.NullUUID{UUID: teamID, Valid: true},
		AgentID: uuid.NullUUID{UUID: agentID, Valid: true}, ModelID: uuid.NullUUID{UUID: modelID, Valid: true}, Metadata: meta}
}

// resolve closes open topics answered well ResolveAfter times since their
// last failure.
func (r *Runner) resolve(ctx context.Context) (int, error) {
	tag, err := r.Pool.Exec(ctx, `WITH done AS (
		UPDATE gap_topics SET state = 'resolved', state_reason = '', dismiss_kind = NULL, state_changed_at = now(), state_changed_by = NULL,
			updated_at = now()
		WHERE state = 'open' AND answered_since >= $1 AND last_answered_at > coalesce(last_failed_at, '-infinity'::timestamptz)
		RETURNING id)
		INSERT INTO gap_topic_events (topic_id, kind) SELECT id, 'resolved' FROM done`, ResolveAfter)
	return int(tag.RowsAffected()), err
}

// prune deletes topics older than a day whose questions are all gone
// (their conversations were deleted).
func (r *Runner) prune(ctx context.Context) (int, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM gap_topics t WHERE t.created_at < now() - interval '1 day'
		AND NOT EXISTS (SELECT 1 FROM gap_questions q WHERE q.topic_id = t.id)`)
	return int(tag.RowsAffected()), err
}
