package web

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var errPattern = apperr.Invalid("invalid_pattern",
	`Enter a host such as "example.edu" or a wildcard such as "*.example.edu"`)

// NormalizePattern lower-cases a host pattern and converts it to IDNA ASCII.
// Patterns are "*" (any host; only when allowStar), "*.example.edu"
// (example.edu and every subdomain) or "example.edu" (that host only).
func NormalizePattern(p string, allowStar bool) (string, error) {
	out, err := crawl.NormalizeHostPattern(p, allowStar)
	switch {
	case errors.Is(err, crawl.ErrStarPattern):
		return "", apperr.Invalid("invalid_pattern", "Teams cannot request every host")
	case err != nil:
		return "", errPattern
	}
	return out, nil
}

// MatchHost reports whether host (lower-case IDNA ASCII, as produced by
// crawl.Normalize) matches pattern.
func MatchHost(pattern, host string) bool {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	switch {
	case host == "":
		return false
	case pattern == "*":
		return true
	case strings.HasPrefix(pattern, "*."):
		base := pattern[2:]
		return host == base || strings.HasSuffix(host, "."+base)
	default:
		return host == pattern
	}
}

// Covers reports whether every host matched by b is also matched by a.
func Covers(a, b string) bool {
	switch {
	case a == "*":
		return true
	case b == "*":
		return false
	case strings.HasPrefix(b, "*."):
		return strings.HasPrefix(a, "*.") && MatchHost(a, b[2:])
	default:
		return MatchHost(a, b)
	}
}

// AllowlistTTL bounds how stale a cached allowlist may be. Changes made in
// this process take effect immediately; other processes see them within it.
const AllowlistTTL = 30 * time.Second

// Allowlist answers "may this team crawl this host?" from the platform
// allowlist plus the team's approved domain requests, cached per team.
type Allowlist struct {
	q   *dbgen.Queries
	ttl time.Duration

	mu     sync.Mutex
	global cached
	teams  map[uuid.UUID]cached
}

type cached struct {
	patterns []string
	at       time.Time
}

func (c cached) fresh(ttl time.Duration) bool { return !c.at.IsZero() && time.Since(c.at) < ttl }

// NewAllowlist returns an allowlist cache.
func NewAllowlist(q *dbgen.Queries) *Allowlist {
	return &Allowlist{q: q, ttl: AllowlistTTL, teams: map[uuid.UUID]cached{}}
}

// Patterns returns the patterns that apply to a team (platform allowlist
// plus approved requests) or, for platform-shared sources (team invalid),
// the platform allowlist only.
func (l *Allowlist) Patterns(ctx context.Context, team uuid.NullUUID) ([]string, error) {
	l.mu.Lock()
	g := l.global
	t, hasTeam := l.teams[team.UUID]
	l.mu.Unlock()
	if !g.fresh(l.ttl) {
		rows, err := l.q.ListAllowlist(ctx)
		if err != nil {
			return nil, err
		}
		g = cached{at: time.Now(), patterns: make([]string, len(rows))}
		for i, r := range rows {
			g.patterns[i] = r.Pattern
		}
		l.mu.Lock()
		l.global = g
		l.mu.Unlock()
	}
	if !team.Valid {
		return g.patterns, nil
	}
	if !hasTeam || !t.fresh(l.ttl) {
		p, err := l.q.ApprovedTeamPatterns(ctx, team.UUID)
		if err != nil {
			return nil, err
		}
		t = cached{patterns: p, at: time.Now()}
		l.mu.Lock()
		l.teams[team.UUID] = t
		l.mu.Unlock()
	}
	return append(append([]string{}, g.patterns...), t.patterns...), nil
}

// Allowed reports whether a team may crawl host.
func (l *Allowlist) Allowed(ctx context.Context, team uuid.NullUUID, host string) (bool, error) {
	patterns, err := l.Patterns(ctx, team)
	if err != nil {
		return false, err
	}
	for _, p := range patterns {
		if MatchHost(p, host) {
			return true, nil
		}
	}
	return false, nil
}

// Invalidate drops cached patterns: a team's approved requests, or (team
// invalid) the platform allowlist.
func (l *Allowlist) Invalidate(team uuid.NullUUID) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if team.Valid {
		delete(l.teams, team.UUID)
	} else {
		l.global = cached{}
	}
}

// Policy returns a crawl.HostPolicy for one team, consulted on every fetch
// and redirect hop. Lookup failures deny.
func (l *Allowlist) Policy(ctx context.Context, team uuid.NullUUID) crawl.HostPolicy {
	return policy{ctx: context.WithoutCancel(ctx), l: l, team: team}
}

type policy struct {
	ctx  context.Context
	l    *Allowlist
	team uuid.NullUUID
}

func (p policy) AllowHost(host string) bool {
	ok, err := p.l.Allowed(p.ctx, p.team, host)
	return err == nil && ok
}
