package public

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/ratelimit"
)

// Public guardrails (docs/phase4-publishing.md §7, ADR-0009): per-address
// and per-session questions per minute, per-agent daily question and token
// caps, and per-agent concurrency, for anonymous public-page and widget
// traffic. Per-minute counters and concurrency slots live in Valkey and
// fail closed: when Valkey is unavailable, anonymous questions are refused
// (ADR-0015). Daily caps come from the usage ledger.

// Counters are the Valkey operations the guard needs.
type Counters interface {
	// Allow counts one event in a fixed window.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (ratelimit.Result, error)
	// Acquire takes one of limit slots (held until Release or ttl).
	Acquire(ctx context.Context, key string, limit int64, ttl time.Duration) (bool, error)
	Release(ctx context.Context, key string)
}

// KeyLimits are a publishable key's overrides of the per-minute limits
// (nil: the agent's team value).
type KeyLimits struct {
	PerIPPerMinute      *int64 `json:"perIpPerMinute,omitempty"`
	PerSessionPerMinute *int64 `json:"perSessionPerMinute,omitempty"`
}

// Admission is one anonymous question to admit.
type Admission struct {
	AgentID   uuid.UUID
	IPPrefix  string
	SessionID uuid.UUID
	// Limits are the effective limits of the agent's team.
	Limits limits.Set
	Key    KeyLimits
	// Usage returns the agent's public questions and chat tokens today.
	Usage func(context.Context) (queries, tokens int64, err error)
}

// Guard admits anonymous questions.
type Guard struct {
	Counters Counters // nil: Valkey is not configured (fails closed)
	Now      func() time.Time
	// OnBackendError is called when Valkey fails (a metric).
	OnBackendError func()
}

// slotTTL bounds how long a crashed process can hold a concurrency slot.
const slotTTL = 10 * time.Minute

// Admit checks every public limit in order (address, session, daily
// questions, daily tokens, concurrency) and takes a concurrency slot;
// release frees it. Errors are 429 rate_limited / quota_exceeded with
// Retry-After, or 503 limits_unavailable when Valkey fails.
func (g *Guard) Admit(ctx context.Context, in Admission) (release func(), err error) {
	release = func() {}
	agent := in.AgentID.String()
	if err := g.perMinute(ctx, in, "pub:"); err != nil {
		return nil, err
	}
	if err := g.daily(ctx, in); err != nil {
		return nil, err
	}
	maxChats := in.Limits.Get(limits.PublicConcurrentChatsPerAgent)
	if maxChats == nil {
		return release, nil
	}
	if *maxChats == 0 {
		return nil, busy(0)
	}
	if g.Counters == nil {
		return nil, unavailable()
	}
	slot := "pub:chats:" + agent
	ok, err := g.Counters.Acquire(ctx, slot, *maxChats, slotTTL)
	if err != nil {
		g.backendFailed()
		return nil, unavailable()
	}
	if !ok {
		return nil, busy(*maxChats)
	}
	return func() { g.Counters.Release(ctx, slot) }, nil
}

// AdmitFeedback checks a visitor's rating against the per-minute limits of
// questions (per address and session, with a key's overrides), counted
// apart from questions so rating an answer never costs the next question.
func (g *Guard) AdmitFeedback(ctx context.Context, in Admission) error {
	return feedbackTooFast(g.perMinute(ctx, in, "pub:fb:"))
}

// feedbackTooFast words a feedback refusal as one: the limits are the
// questions' numbers, but feedback has its own counters (v0.4.2 US-12), and
// details.counter says which was full.
func feedbackTooFast(err error) error {
	var e *apperr.Error
	if !errors.As(err, &e) || e.Code != "rate_limited" {
		return err
	}
	f := *e
	details := map[string]any{"counter": "feedback"}
	if d, ok := e.Details.(map[string]any); ok {
		for k, v := range d {
			details[k] = v
		}
	}
	f.Details = details
	if limit, _ := details["max"].(int64); limit > 0 {
		f.Message = fmt.Sprintf("You're rating answers too quickly (limit: %d per minute). Try again in a moment.", limit)
	} else {
		f.Message = "This assistant isn't taking feedback from visitors right now."
	}
	return &f
}

// perMinute applies the per-address and per-session limits, with counters
// under prefix.
func (g *Guard) perMinute(ctx context.Context, in Admission, prefix string) error {
	rates := []struct {
		key     limits.Key
		counter string
		max     *int64
	}{
		{limits.PublicQueriesPerIPPerMinute, prefix + "ip:" + in.AgentID.String() + ":" + in.IPPrefix, pick(in.Key.PerIPPerMinute, in.Limits.Get(limits.PublicQueriesPerIPPerMinute))},
		{limits.PublicQueriesPerSessionPerMinute, prefix + "sess:" + in.SessionID.String(), pick(in.Key.PerSessionPerMinute, in.Limits.Get(limits.PublicQueriesPerSessionPerMinute))},
	}
	for _, r := range rates {
		if r.max == nil {
			continue
		}
		if err := g.rate(ctx, r.key, r.counter, *r.max); err != nil {
			return err
		}
	}
	return nil
}

func pick(override, team *int64) *int64 {
	if override != nil {
		return override
	}
	return team
}

func (g *Guard) backendFailed() {
	if g.OnBackendError != nil {
		g.OnBackendError()
	}
}

func (g *Guard) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

// rate counts one question against a per-minute limit.
func (g *Guard) rate(ctx context.Context, key limits.Key, counter string, limit int64) error {
	if limit == 0 {
		return tooFast(key, 0, time.Minute)
	}
	if g.Counters == nil {
		return unavailable()
	}
	res, err := g.Counters.Allow(ctx, counter, int(min(limit, int64(1)<<31-1)), time.Minute)
	if err != nil {
		g.backendFailed()
		return unavailable() // fail closed: anonymous traffic (ADR-0015)
	}
	if !res.Allowed {
		return tooFast(key, limit, res.RetryAfter)
	}
	return nil
}

// daily applies the per-agent question and token caps from the ledger.
func (g *Guard) daily(ctx context.Context, in Admission) error {
	maxQ, maxT := in.Limits.Get(limits.PublicQueriesPerAgentPerDay), in.Limits.Get(limits.PublicTokensPerAgentPerDay)
	if maxQ == nil && maxT == nil {
		return nil
	}
	now := g.now()
	retry := limits.NextDay(now).Sub(now)
	var queries, tokens int64
	if (maxQ == nil || *maxQ > 0) && (maxT == nil || *maxT > 0) && in.Usage != nil {
		var err error
		if queries, tokens, err = in.Usage(ctx); err != nil {
			return err
		}
	}
	if maxQ != nil && queries >= *maxQ {
		return dailyCap(limits.PublicQueriesPerAgentPerDay, *maxQ, queries, retry)
	}
	if maxT != nil && tokens >= *maxT {
		return dailyCap(limits.PublicTokensPerAgentPerDay, *maxT, tokens, retry)
	}
	return nil
}

func limitDetails(k limits.Key, limit, current int64) map[string]any {
	return map[string]any{"limit": string(k), "max": limit, "current": current}
}

func tooFast(k limits.Key, limit int64, retry time.Duration) error {
	msg := fmt.Sprintf("You're sending questions too quickly (limit: %d per minute). Try again in a moment.", limit)
	if limit == 0 {
		msg = "This assistant isn't taking questions from visitors right now."
	}
	return &apperr.Error{Status: http.StatusTooManyRequests, Code: "rate_limited", Message: msg,
		Details: limitDetails(k, limit, limit), RetryAfter: max(retry, time.Second)}
}

func dailyCap(k limits.Key, limit, current int64, retry time.Duration) error {
	return &apperr.Error{Status: http.StatusTooManyRequests, Code: "quota_exceeded",
		Message: "This assistant has answered as many visitor questions as it can today. Try again tomorrow.",
		Details: limitDetails(k, limit, current), RetryAfter: retry}
}

func busy(limit int64) error {
	return &apperr.Error{Status: http.StatusTooManyRequests, Code: "rate_limited",
		Message: "This assistant is busy answering other visitors. Try again in a moment.",
		Details: limitDetails(limits.PublicConcurrentChatsPerAgent, limit, limit), RetryAfter: 5 * time.Second}
}

func unavailable() error {
	return &apperr.Error{Status: http.StatusServiceUnavailable, Code: "limits_unavailable",
		Message: "The assistant can't take questions right now. Try again shortly.", RetryAfter: 30 * time.Second}
}

// ---- Valkey ---------------------------------------------------------------------------

// ValkeyCounters implements Counters with Valkey.
type ValkeyCounters struct {
	KV *kv.Store
}

// Allow is ratelimit.Limiter.Allow.
func (v ValkeyCounters) Allow(ctx context.Context, key string, limit int, window time.Duration) (ratelimit.Result, error) {
	return (&ratelimit.Limiter{KV: v.KV}).Allow(ctx, key, limit, window)
}

var acquireSlot = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return -1
end
return n`)

// Acquire takes a slot of a counter with a TTL.
func (v ValkeyCounters) Acquire(ctx context.Context, key string, limit int64, ttl time.Duration) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	n, err := acquireSlot.Run(ctx, v.KV.Client, []string{v.KV.Key(key)}, limit, int(ttl/time.Second)).Int64()
	if err != nil {
		return false, err
	}
	return n >= 0, nil
}

// Release frees a slot (best effort).
func (v ValkeyCounters) Release(ctx context.Context, key string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 500*time.Millisecond)
	defer cancel()
	k := v.KV.Key(key)
	if n, err := v.KV.Client.Decr(ctx, k).Result(); err == nil && n <= 0 {
		v.KV.Client.Del(ctx, k)
	}
}
