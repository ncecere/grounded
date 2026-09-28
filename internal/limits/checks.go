// Enforcement: resource checks (documents, storage, agents, ...), query
// rates, daily chat tokens and concurrent chat slots.

package limits

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Need is what a change adds to a team's resources.
type Need struct {
	DataSources, KnowledgeBases, Documents, Agents int64
	// EvalSets are evaluation sets (evaluation_sets).
	EvalSets int64
	// Bytes is the storage the change adds; zero or negative (a smaller
	// replacement) is never refused.
	Bytes int64
}

// LockUsage serialises resource-cap checks for a team until the
// transaction ends. Call it before CheckResources inside the transaction
// that creates the resource.
func (s *Service) LockUsage(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID) error {
	return q.LockTeamUsage(ctx, teamID)
}

// CheckResources returns a *Error (409 limit_reached) when adding need
// would take the team past a resource cap.
func (s *Service) CheckResources(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, need Need) error {
	set, err := s.Effective(ctx, q, teamID)
	if err != nil {
		return err
	}
	team := uuid.NullUUID{UUID: teamID, Valid: true}
	check := func(k Key, add int64, current func() (int64, error)) error {
		max := set.Get(k)
		if max == nil || add <= 0 {
			return nil
		}
		cur, err := current()
		if err != nil {
			return err
		}
		if cur+add > *max {
			d, _ := Lookup(k)
			return reached(d, *max, cur)
		}
		return nil
	}
	if err := check(DataSources, need.DataSources, func() (int64, error) { return q.CountTeamSources(ctx, team) }); err != nil {
		return err
	}
	if err := check(KnowledgeBases, need.KnowledgeBases, func() (int64, error) { return q.CountTeamKBs(ctx, teamID) }); err != nil {
		return err
	}
	if err := check(Agents, need.Agents, func() (int64, error) { return q.CountTeamAgents(ctx, teamID) }); err != nil {
		return err
	}
	if err := check(EvaluationSets, need.EvalSets, func() (int64, error) { return q.CountTeamEvalSets(ctx, teamID) }); err != nil {
		return err
	}
	var docs *dbgen.TeamDocumentUsageRow
	docUsage := func() (dbgen.TeamDocumentUsageRow, error) {
		if docs == nil {
			u, err := q.TeamDocumentUsage(ctx, team)
			if err != nil {
				return u, err
			}
			docs = &u
		}
		return *docs, nil
	}
	if err := check(Documents, need.Documents, func() (int64, error) { u, err := docUsage(); return u.Documents, err }); err != nil {
		return err
	}
	return check(StorageBytes, need.Bytes, func() (int64, error) { u, err := docUsage(); return u.StorageBytes, err })
}

// CheckSetQuestions returns a *Error (409 limit_reached) when adding add
// questions to an evaluation set holding current would pass
// evaluation_questions_per_set. Call it under the set's row lock.
func (s *Service) CheckSetQuestions(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, current, add int64) error {
	set, err := s.Effective(ctx, q, teamID)
	if err != nil {
		return err
	}
	max := set.Get(EvaluationQuestionsPerSet)
	if max == nil || add <= 0 || current+add <= *max {
		return nil
	}
	d, _ := Lookup(EvaluationQuestionsPerSet)
	return reached(d, *max, current)
}

// UsageToday sums a usage kind for a team since UTC midnight.
func (s *Service) UsageToday(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, kind string) (int64, error) {
	if q == nil {
		q = s.q
	}
	return q.TeamUsageSince(ctx, dbgen.TeamUsageSinceParams{
		TeamID: uuid.NullUUID{UUID: teamID, Valid: true}, Kind: kind, Since: StartOfDay(s.Now()),
	})
}

// CheckQuery admits one retrieval query for a team, in this order: the
// team's monthly budget (429 budget_exhausted, when enforced), the daily
// team cap (from the usage ledger), then the per-minute team, API key and
// user rates (Valkey). It returns a *Error (429 rate_limited, with
// Retry-After) when a limit is reached. When Valkey is unavailable the
// per-minute checks fail open.
func (s *Service) CheckQuery(ctx context.Context, teamID uuid.UUID, a authz.Actor) error {
	if s.Budget != nil {
		if err := s.Budget.Check(ctx, teamID); err != nil {
			return err
		}
	}
	set, err := s.Effective(ctx, nil, teamID)
	if err != nil {
		return err
	}
	now := s.Now()
	if max := set.Get(QueriesPerDay); max != nil {
		d, _ := Lookup(QueriesPerDay)
		if *max == 0 {
			return rateLimited(d, 0, 0, NextDay(now).Sub(now))
		}
		used, err := s.UsageToday(ctx, nil, teamID, UsageQuery)
		if err != nil {
			return err
		}
		if used >= *max {
			s.ReachedDaily(ctx, teamID, QueriesPerDay, *max)
			return rateLimited(d, *max, used, NextDay(now).Sub(now))
		}
	}
	type rate struct {
		key     Key
		counter string
	}
	rates := []rate{{QueriesPerMinute, "q:team:" + teamID.String()}}
	if a.Key != nil {
		rates = append(rates, rate{APIKeyQueriesPerMinute, "q:key:" + a.Key.ID.String()})
	} else if a.UserID != uuid.Nil {
		rates = append(rates, rate{UserQueriesPerMinute, "q:user:" + teamID.String() + ":" + a.UserID.String()})
	}
	for _, r := range rates {
		lim := set.Get(r.key)
		if lim == nil {
			continue
		}
		d, _ := Lookup(r.key)
		if *lim == 0 {
			return rateLimited(d, 0, 0, time.Minute)
		}
		if s.limiter == nil {
			continue
		}
		res, err := s.limiter.Allow(ctx, r.counter, int(min(*lim, int64(1)<<31-1)), time.Minute)
		if err != nil {
			if s.OnBackendError != nil {
				s.OnBackendError()
			}
			continue // fail open: authenticated traffic (ADR-0015)
		}
		if !res.Allowed {
			return rateLimited(d, *lim, *lim, max(res.RetryAfter, time.Second))
		}
	}
	return nil
}

func (s *Service) chatTokensToday(ctx context.Context, teamID uuid.UUID) (int64, error) {
	in, err := s.UsageToday(ctx, nil, teamID, UsageChatIn)
	if err != nil {
		return 0, err
	}
	out, err := s.UsageToday(ctx, nil, teamID, UsageChatOut)
	return in + out, err
}

// CheckChat admits one chat answer: the team's daily chat token quota (429
// quota_exceeded, from the usage ledger), then the query limits
// (CheckQuery: chat counts as a query).
func (s *Service) CheckChat(ctx context.Context, teamID uuid.UUID, a authz.Actor) error {
	set, err := s.Effective(ctx, nil, teamID)
	if err != nil {
		return err
	}
	if max := set.Get(ChatTokensPerDay); max != nil {
		now := s.Now()
		used := int64(0)
		if *max > 0 {
			if used, err = s.chatTokensToday(ctx, teamID); err != nil {
				return err
			}
		}
		if used >= *max {
			s.ReachedDaily(ctx, teamID, ChatTokensPerDay, *max)
			d, _ := Lookup(ChatTokensPerDay)
			return quotaExceeded(d, *max, used, NextDay(now).Sub(now))
		}
	}
	return s.CheckQuery(ctx, teamID, a)
}

// ChatSlot is a held concurrent-chat slot; Release it when the answer ends.
type ChatSlot struct {
	s   *Service
	key string
}

// chatSlotTTL bounds how long a crashed process can hold a slot.
const chatSlotTTL = 10 * time.Minute

var acquireScript = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return -1
end
return n`)

// AcquireChat takes one of the principal's concurrent chat slots
// (concurrent_chats_per_user; a Valkey counter with a TTL). principal is a
// user ID or, for service keys, the key ID. It returns 429 rate_limited when
// all slots are taken and fails open when Valkey is unavailable.
func (s *Service) AcquireChat(ctx context.Context, teamID uuid.UUID, principal string) (*ChatSlot, error) {
	set, err := s.Effective(ctx, nil, teamID)
	if err != nil {
		return nil, err
	}
	lim := set.Get(ConcurrentChatsPerUser)
	if lim == nil {
		return &ChatSlot{}, nil
	}
	d, _ := Lookup(ConcurrentChatsPerUser)
	if *lim == 0 {
		return nil, concurrentChats(d, 0)
	}
	if s.limiter == nil {
		return &ChatSlot{}, nil
	}
	key := s.limiter.KV.Key("chats", principal)
	rctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	n, err := acquireScript.Run(rctx, s.limiter.KV.Client, []string{key}, *lim, int(chatSlotTTL/time.Second)).Int64()
	if err != nil {
		if s.OnBackendError != nil {
			s.OnBackendError()
		}
		return &ChatSlot{}, nil // fail open (ADR-0015)
	}
	if n < 0 {
		return nil, concurrentChats(d, *lim)
	}
	return &ChatSlot{s: s, key: key}, nil
}

// Release frees the slot. It is safe to call on a nil or empty slot.
func (c *ChatSlot) Release(ctx context.Context) {
	if c == nil || c.s == nil || c.key == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 500*time.Millisecond)
	defer cancel()
	cl := c.s.limiter.KV.Client
	if n, err := cl.Decr(ctx, c.key).Result(); err == nil && n <= 0 {
		cl.Del(ctx, c.key)
	}
	c.key = ""
}

// IngestJobCap returns the platform default and ceiling of
// concurrent_ingest_jobs, for the ingestion dispatcher (which applies team
// overrides in SQL).
func (s *Service) IngestJobCap(ctx context.Context, q *dbgen.Queries) (Setting, error) {
	p, err := s.platform(ctx, q, false)
	if err != nil {
		return Setting{}, err
	}
	return p.Settings[ConcurrentIngestJobs], nil
}
