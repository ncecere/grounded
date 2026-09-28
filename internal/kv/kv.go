// Package kv connects to Valkey, the shared fast-state store (ADR-0015).
//
// Valkey is never the source of truth for durable data: budgets, usage and
// job state live in PostgreSQL. Anything stored here must be safe to lose.
package kv

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/observability"
)

// Store wraps a Valkey client with a key prefix so several deployments (or
// parallel tests) can share one Valkey without colliding.
type Store struct {
	Client *redis.Client
	Prefix string
}

// Open parses a redis:// or rediss:// URL and verifies connectivity.
func Open(ctx context.Context, rawURL, prefix string) (*Store, error) {
	opts, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, fmt.Errorf("VALKEY_URL: %w", err)
	}
	client := redis.NewClient(opts)
	client.AddHook(errorHook{})
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("valkey ping: %w", err)
	}
	return &Store{Client: client, Prefix: prefix}, nil
}

// Key returns the prefixed key.
func (s *Store) Key(parts ...string) string {
	k := s.Prefix
	for i, p := range parts {
		if i > 0 {
			k += ":"
		}
		k += p
	}
	return k
}

func (s *Store) Ping(ctx context.Context) error { return s.Client.Ping(ctx).Err() }

func (s *Store) Close() error { return s.Client.Close() }

// errorHook counts failed commands and dials (grounded_valkey_errors_total).
// A missing key (redis.Nil) is an answer, not an error.
type errorHook struct{}

func countValkeyError(command string, err error) {
	if err != nil && !errors.Is(err, redis.Nil) {
		observability.ValkeyErrors.WithLabelValues(command).Inc()
	}
}

func (errorHook) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		c, err := next(ctx, network, addr)
		countValkeyError("dial", err)
		return c, err
	}
}

func (errorHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		err := next(ctx, cmd)
		countValkeyError(cmd.Name(), err)
		return err
	}
}

func (errorHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		err := next(ctx, cmds)
		for _, c := range cmds {
			countValkeyError(c.Name(), c.Err())
		}
		return err
	}
}
