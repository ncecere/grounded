package contextual

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Store is where the generator keeps what it makes and what it spends. The real one is PGStore; the real-model acceptance harness uses
// an in-memory one, so it needs no database.
type Store interface {
	// CacheFor returns the cached contexts of a document under the keys.
	CacheFor(ctx context.Context, documentID uuid.UUID, keys [][32]byte) (map[[32]byte]string, error)
	// PutCache is a setup primitive; generated contexts must be published by Settle, with their usage.
	PutCache(ctx context.Context, e CacheEntry) error
	// RetainCachePlan installs a bounded current document/profile plan before
	// generation, preserving the union of current plans when pruning artifacts.
	RetainCachePlan(ctx context.Context, plan CachePlan) error
	// Reserve records an attempt before it is sent, unless the cap is reached (ErrCapReached).
	Reserve(ctx context.Context, r Reservation) (int64, error)
	// Settle records a terminal outcome and its usage once. Replays and missing attempts are no-ops.
	Settle(ctx context.Context, s Settlement) error
	// Release removes only a proven-unsent local reservation. Remote 429/503 usage is unknown and must retain admission.
	Release(ctx context.Context, id int64) error
}

// ErrCapReached: the number of attempts allowed in the scope (a build, or a day) is used up.
var ErrCapReached = errors.New("the model-call cap is reached")

// CacheEntry is one generated context.
type CacheEntry struct {
	DocumentID, SourceID, ProfileID uuid.UUID
	Version                         int32
	Key                             [32]byte
	Text                            string
	TokensIn, TokensOut             *int32
}

// Reservation is an attempt about to be made. Cap is how many attempts the scope may hold; Since starts the day of a live scope.
type Reservation struct {
	SourceID, ProfileID, DocumentID, ModelID uuid.UUID
	Phase                                    string
	Cap                                      int
	Since                                    time.Time
	// Local prompt/reply headroom; PG derives the current caps, prices and UTC bucket itself.
	InputTokens, OutputTokens int64
}

// Settlement ends an attempt. Tokens are what the provider reported (nil: unknown).
type Settlement struct {
	ID                  int64
	Outcome             string
	TokensIn, TokensOut *int32
	// Usage is recorded in the ledger with an ok attempt (and with an unusable reply, which was billed): what the team spent.
	Usage *Usage
	// Cache publishes a successful reply in the same transaction as its terminal outcome and usage.
	// Nil records usage only (an unusable or stopped reply must not be cached).
	Cache *CacheEntry
}

// Usage is what a call is recorded as in the usage ledger: chat tokens of the model (docs/contextual-chunks.md section 5).
type Usage struct {
	Team, User          uuid.NullUUID
	Source, Document    uuid.UUID
	Model               uuid.UUID
	TokensIn, TokensOut int
	// Reported is false when the gateway sent no usage and the figures are Grounded's own count.
	Reported bool
	Phase    string
}

// PGStore is the Store over Postgres.
type PGStore struct {
	Pool *pgxpool.Pool
	// Recorded is told of usage written to the ledger (the budget's cached spend); may be nil.
	Recorded func(team uuid.UUID, usage []dbgen.InsertUsageParams)
}

func (s *PGStore) CacheFor(ctx context.Context, documentID uuid.UUID, keys [][32]byte) (map[[32]byte]string, error) {
	rows, err := dbgen.New(s.Pool).ContextualCacheFor(ctx, dbgen.ContextualCacheForParams{DocumentID: documentID, Keys: byteKeys(keys)})
	if err != nil {
		return nil, err
	}
	out := make(map[[32]byte]string, len(rows))
	for _, r := range rows {
		var k [32]byte
		copy(k[:], r.Key)
		out[k] = r.Context
	}
	return out, nil
}

func byteKeys(keys [][32]byte) [][]byte {
	out := make([][]byte, len(keys))
	for i := range keys {
		out[i] = keys[i][:]
	}
	return out
}

func (s *PGStore) PutCache(ctx context.Context, e CacheEntry) error {
	return insertCache(ctx, dbgen.New(s.Pool), e)
}

func insertCache(ctx context.Context, q *dbgen.Queries, e CacheEntry) error {
	return q.InsertContextualCache(ctx, dbgen.InsertContextualCacheParams{
		DocumentID: e.DocumentID, Key: e.Key[:], SourceID: e.SourceID, Context: e.Text, TokensIn: e.TokensIn, TokensOut: e.TokensOut})
}

// Reserve admits call/token/configured-price headroom in both source windows atomically.
func (s *PGStore) Reserve(ctx context.Context, r Reservation) (int64, error) {
	return s.reserveAdmission(ctx, r)
}

func (s *PGStore) Release(ctx context.Context, id int64) error {
	return dbgen.New(s.Pool).DeleteContextualCall(ctx, id)
}

func (s *PGStore) Settle(ctx context.Context, st Settlement) error {
	if err := validateSettlement(st); err != nil {
		return err
	}
	var recorded []dbgen.InsertUsageParams
	stopReason := ""
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		params, cacheAllowed, err := settlementAdmission(ctx, q, st)
		if err != nil || params == nil {
			return err
		}
		n, err := q.SettleContextualCall(ctx, *params)
		if err != nil || n == 0 {
			return err
		}
		if st.Usage == nil {
			return nil
		}
		recorded = usageEvents(*st.Usage)
		for _, u := range recorded {
			if err := q.InsertUsage(ctx, u); err != nil {
				return err
			}
		}
		if st.Cache != nil {
			if !cacheAllowed {
				stopReason = "the source is switched off"
				return nil // usage was real; an off source must not regain cached text
			}
			allowed, err := cachePlanAllows(ctx, q, *st.Cache)
			if err != nil {
				return err
			}
			if !allowed {
				stopReason = "the contextual cache plan is no longer current"
				return nil // paid usage survives a discarded/replaced plan
			}
			return insertCache(ctx, q, *st.Cache)
		}
		return nil
	})
	if err == nil && len(recorded) > 0 && s.Recorded != nil && st.Usage != nil && st.Usage.Team.Valid {
		s.Recorded(st.Usage.Team.UUID, recorded)
	}
	if err == nil && stopReason != "" {
		return &StopError{Reason: stopReason}
	}
	return err
}

func validateSettlement(st Settlement) error {
	if !terminalOutcome(st.Outcome) {
		return errors.New("contextual settlement requires a terminal outcome")
	}
	if e := st.Cache; e != nil && (st.Outcome != OutcomeOK || st.Usage == nil || e.SourceID != st.Usage.Source || e.DocumentID != st.Usage.Document) {
		return errors.New("contextual cache requires a successful settlement with matching document and source usage")
	}
	if e := st.Cache; e != nil && (e.ProfileID == uuid.Nil || e.Version <= 0) {
		return errors.New("contextual cache requires current profile and document version")
	}
	return nil
}

func terminalOutcome(outcome string) bool {
	switch outcome {
	case OutcomeOK, OutcomeRefused, OutcomeInvalid, OutcomeError, OutcomeTimeout, OutcomeCancelled:
		return true
	}
	return false
}

// usageEvents are the ledger rows of a call: input and output tokens of the model, as chat tokens, so the existing prices, budgets and
// reports apply. The metadata says what they were for; it holds no text.
func usageEvents(u Usage) []dbgen.InsertUsageParams {
	meta, _ := json.Marshal(map[string]any{"source": "contextual_chunks", "phase": u.Phase, "reportedByProxy": u.Reported})
	model := uuid.NullUUID{UUID: u.Model, Valid: true}
	var out []dbgen.InsertUsageParams
	for _, e := range []struct {
		kind string
		n    int
	}{{limits.UsageChatIn, u.TokensIn}, {limits.UsageChatOut, u.TokensOut}} {
		if e.n <= 0 {
			continue
		}
		out = append(out, dbgen.InsertUsageParams{Kind: e.kind, Quantity: int64(e.n), ModelID: model, Metadata: meta,
			TeamID: u.Team, UserID: u.User, SourceID: uuid.NullUUID{UUID: u.Source, Valid: true},
			DocumentID: uuid.NullUUID{UUID: u.Document, Valid: u.Document != uuid.Nil}})
	}
	return out
}
