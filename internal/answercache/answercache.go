// Package answercache stores answers to reuse (docs/v0.4.0.md §1, roadmap
// A8, docs/answer-cache.md): a question answered recently under the same
// conditions gets the stored answer again instead of the whole pipeline.
//
// An entry is keyed by its agent, a hash of the key's conditions (the
// published version, the audience, the knowledge bases' content revisions,
// the settings revision and, for questions about relative dates, the day)
// and the normalised question. Near-identical matching finds the nearest
// entry by the question's embedding; the chat pipeline (internal/agents)
// confirms it with SystemOne. The pipeline decides what is eligible and
// replays a hit; this package stores, finds, evicts and clears entries and
// holds the platform switch and the agents' settings. Retention deletes
// expired entries (internal/retention, kind answer_cache).
package answercache

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/authz"
)

// Expiry bounds (hours).
const (
	DefaultExpiryHours = 24
	MinExpiryHours     = 1
	MaxExpiryHours     = 720
)

// NearSimilarity is the cosine similarity a near-identical question must
// reach before SystemOne is asked whether it asks the same thing.
const NearSimilarity = 0.92

// Service stores cached answers and the cache's settings.
type Service struct {
	pool *pgxpool.Pool
	log  *slog.Logger

	mu sync.Mutex
	on bool
	at time.Time
}

// New returns a Service.
func New(pool *pgxpool.Pool, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{pool: pool, log: log}
}

// Normalize is the form a question is matched in: lower case, whitespace
// collapsed, trailing punctuation and spaces removed.
func Normalize(q string) string {
	s := strings.Join(strings.Fields(strings.ToLower(q)), " ")
	return strings.TrimRightFunc(s, func(r rune) bool { return unicode.IsPunct(r) || unicode.IsSpace(r) })
}

// Hash is a hex SHA-256 of parts joined with a separator no part contains.
func Hash(parts ...string) string {
	h := sha256.New()
	for i, p := range parts {
		if i > 0 {
			h.Write([]byte{0})
		}
		h.Write([]byte(p))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// relativeWords make a question depend on the day it is asked: the system
// prompt gives the model today's date, so the day joins its key.
var relativeWords = map[string]bool{
	"today": true, "tonight": true, "tomorrow": true, "yesterday": true, "now": true, "currently": true, "current": true,
	"week": true, "weekend": true, "month": true, "year": true, "next": true, "last": true, "upcoming": true,
	"open": true, "closed": true, "date": true, "day": true, "days": true, "monday": true, "tuesday": true, "wednesday": true,
	"thursday": true, "friday": true, "saturday": true, "sunday": true, "hours": true, "deadline": true, "deadlines": true,
	"soon": true, "still": true, "yet": true, "ago": true, "age": true, "old": true, "latest": true, "recent": true,
}

// DependsOnDay reports whether a question's answer may depend on today's
// date (relative dates and times, opening hours, deadlines).
func DependsOnDay(normalized string) bool {
	for _, w := range strings.FieldsFunc(normalized, func(r rune) bool { return !unicode.IsLetter(r) }) {
		if relativeWords[w] {
			return true
		}
	}
	return false
}

// AgentSettings are an agent's cache settings.
type AgentSettings struct {
	// Enabled nil follows the default: on for agents published to the public.
	Enabled       *bool
	NearIdentical bool
	ExpiryHours   int
	Revision      int64
	UpdatedAt     *time.Time
}

// DefaultAgentSettings are an agent's settings before anyone saved them.
func DefaultAgentSettings() AgentSettings {
	return AgentSettings{ExpiryHours: DefaultExpiryHours, Revision: 1}
}

// On reports whether the cache is on for an agent published to audience.
func (s AgentSettings) On(audience string) bool {
	if s.Enabled != nil {
		return *s.Enabled
	}
	return audience == authz.AudiencePublic
}

// Expiry is the time limit of the agent's entries.
func (s AgentSettings) Expiry() time.Duration { return time.Duration(s.ExpiryHours) * time.Hour }
