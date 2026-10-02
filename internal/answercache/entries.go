// Finding, storing and evicting entries.

package answercache

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Key locates an agent's entries for one question.
type Key struct {
	AgentID uuid.UUID
	// Conditions is the hash of the key's conditions other than the question.
	Conditions string
	// Question is normalised (Normalize).
	Question string
	// Expiry is the agent's time limit now (an entry older than it is not
	// served even if it was stored with a longer one).
	Expiry time.Duration
}

// QuestionHash is the hash of the normalised question.
func (k Key) QuestionHash() string { return Hash(k.Question) }

// Entry is a stored answer.
type Entry struct {
	ID       uuid.UUID
	Question string
	// Answer is the stored answer (the chat pipeline's format).
	Answer json.RawMessage
	// Tokens are the original answer's model tokens.
	Tokens int
	// Similarity is the question's cosine similarity (near-identical
	// matches; 1 for exact ones).
	Similarity float64
}

const entryColumns = `id, question, answer, tokens`

// live: not expired, and not older than the agent's time limit now.
const live = `expires_at > now() AND created_at > now() - make_interval(secs => $3)`

// Exact finds the entry for the exact (normalised) question; nil when none.
func (s *Service) Exact(ctx context.Context, k Key) (*Entry, error) {
	e := Entry{Similarity: 1}
	err := s.pool.QueryRow(ctx, `SELECT `+entryColumns+` FROM answer_cache
		WHERE agent_id = $1 AND conditions = $2 AND `+live+` AND question_hash = $4`,
		k.AgentID, k.Conditions, k.Expiry.Seconds(), k.QuestionHash()).Scan(&e.ID, &e.Question, &e.Answer, &e.Tokens)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &e, err
}

// Nearest finds the entry whose question is nearest to vec in profile, if
// its similarity reaches NearSimilarity; nil when none.
func (s *Service) Nearest(ctx context.Context, k Key, profile uuid.UUID, vec []float32) (*Entry, error) {
	var e Entry
	err := s.pool.QueryRow(ctx, `SELECT `+entryColumns+`, 1 - (embedding <=> $5::text::vector) FROM answer_cache
		WHERE agent_id = $1 AND conditions = $2 AND `+live+` AND profile_id = $4 AND embedding IS NOT NULL
		  AND vector_dims(embedding) = $6
		ORDER BY embedding <=> $5::text::vector LIMIT 1`,
		k.AgentID, k.Conditions, k.Expiry.Seconds(), profile, vectorText(vec), len(vec)).Scan(&e.ID, &e.Question, &e.Answer, &e.Tokens, &e.Similarity)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && e.Similarity < NearSimilarity) {
		return nil, nil
	}
	return &e, err
}

// Hit counts a served entry.
func (s *Service) Hit(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE answer_cache SET hits = hits + 1, last_hit_at = now() WHERE id = $1`, id)
	return err
}

// StoreInput is a clean answer to keep.
type StoreInput struct {
	Key
	TeamID, AgentVersionID uuid.UUID
	Audience               string
	KBRevisions            map[string]int64
	SettingsRevision       string
	// Profile and Vector are the question's embedding (nil: none, so it
	// only matches exactly).
	Profile *uuid.UUID
	Vector  []float32
	Answer  json.RawMessage
	Tokens  int
	// SourceMessageID is the stored answer (nil for stateless callers).
	SourceMessageID *uuid.UUID
	// Retention caps the entry's life at the transcript retention of the
	// agent's classification (0: none).
	Retention time.Duration
}

// Store keeps an answer, replacing an entry with the same key. It returns
// the entry's ID, or uuid.Nil when the platform switch is off by now (read
// in the statement, not the switch's short cache: an answer that started
// before an admin turned saved answers off isn't saved after).
func (s *Service) Store(ctx context.Context, in StoreInput) (uuid.UUID, error) {
	life := in.Expiry
	if in.Retention > 0 && in.Retention < life {
		life = in.Retention
	}
	revs, _ := json.Marshal(in.KBRevisions)
	var vec *string
	if in.Profile != nil && in.Vector != nil {
		v := vectorText(in.Vector)
		vec = &v
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `INSERT INTO answer_cache (team_id, agent_id, agent_version_id, audience, conditions, kb_revisions, settings_revision,
			question, question_hash, profile_id, embedding, answer, tokens, source_message_id, expires_at)
		SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text::vector, $12, $13, $14, now() + make_interval(secs => $15)
		WHERE coalesce((SELECT enabled FROM answer_cache_settings), true)
		ON CONFLICT ON CONSTRAINT answer_cache_key DO UPDATE SET agent_version_id = EXCLUDED.agent_version_id, audience = EXCLUDED.audience,
			kb_revisions = EXCLUDED.kb_revisions, settings_revision = EXCLUDED.settings_revision, question = EXCLUDED.question,
			profile_id = EXCLUDED.profile_id, embedding = EXCLUDED.embedding, answer = EXCLUDED.answer, tokens = EXCLUDED.tokens,
			source_message_id = EXCLUDED.source_message_id, created_at = now(), expires_at = EXCLUDED.expires_at, hits = 0, last_hit_at = NULL
		RETURNING id`,
		in.TeamID, in.AgentID, in.AgentVersionID, in.Audience, in.Conditions, revs, in.SettingsRevision, in.Question, in.QuestionHash(),
		in.Profile, vec, in.Answer, in.Tokens, in.SourceMessageID, life.Seconds()).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil // switched off meanwhile
	}
	return id, err
}

// EvictMessage removes the entry an answer was stored as or served from
// (a thumbs-down), in tx. It returns how many entries went.
func EvictMessage(ctx context.Context, tx pgx.Tx, messageID uuid.UUID) (int64, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM answer_cache WHERE source_message_id = $1
		OR id = (SELECT cache_entry_id FROM message_events WHERE message_id = $1)`, messageID)
	return tag.RowsAffected(), err
}

// vectorText is a vector in pgvector's text form.
func vectorText(vec []float32) string {
	var b strings.Builder
	b.WriteByte('[')
	for i, f := range vec {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', -1, 32))
	}
	b.WriteByte(']')
	return b.String()
}
