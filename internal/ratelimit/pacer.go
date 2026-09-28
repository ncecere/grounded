package ratelimit

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/kv"
)

// Pacer spaces requests to a shared resource evenly across every process
// (the generic cell rate algorithm): one request per interval, with no
// bursts. It suits upstream limits such as "120 requests per minute per API
// key", which a fixed window would overshoot at window boundaries.
//
// Each key holds the earliest time the next request may start (the
// theoretical arrival time), in Valkey's clock so process clocks don't
// matter.
type Pacer struct {
	KV *kv.Store
}

// reserveScript: KEYS[1] = arrival time key; ARGV = interval_us, max_wait_us.
// Returns {reserved (0/1), delay_us}. A reservation moves the arrival time
// one interval past max(now, arrival).
var reserveScript = redis.NewScript(`
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000000 + tonumber(t[2])
local interval = tonumber(ARGV[1])
local maxwait = tonumber(ARGV[2])
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now then tat = now end
local delay = tat - now
if delay > maxwait then return {0, delay} end
redis.call('SET', KEYS[1], tat + interval, 'PX', math.ceil((delay + interval) / 1000) + 1000)
return {1, delay}`)

// blockScript: KEYS[1] = arrival time key; ARGV = pause_us. Moves the
// arrival time to at least now + pause.
var blockScript = redis.NewScript(`
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000000 + tonumber(t[2])
local pause = tonumber(ARGV[1])
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now + pause then
  redis.call('SET', KEYS[1], now + pause, 'PX', math.ceil(pause / 1000) + 1000)
end
return 1`)

// Reserve claims the next request slot for key if it starts within maxWait.
// It returns how long the caller must wait before sending (0 = now) and
// whether the slot was reserved. When it was not, delay is when the next
// slot would start; nothing is claimed, so a caller can come back later
// without pushing others back.
func (p *Pacer) Reserve(ctx context.Context, key string, interval, maxWait time.Duration) (delay time.Duration, reserved bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	res, err := reserveScript.Run(ctx, p.KV.Client, []string{p.KV.Key("pace", key)},
		interval.Microseconds(), maxWait.Microseconds()).Int64Slice()
	if err != nil {
		return 0, false, err
	}
	return time.Duration(res[1]) * time.Microsecond, res[0] == 1, nil
}

// Block keeps key's next slot at least d away (for example after the
// upstream answered 429 with Retry-After d).
func (p *Pacer) Block(ctx context.Context, key string, d time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	return blockScript.Run(ctx, p.KV.Client, []string{p.KV.Key("pace", key)}, d.Microseconds()).Err()
}
