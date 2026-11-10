package web

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func allowSnapshot(e dbgen.CrawlAllowlist) map[string]any {
	return map[string]any{"pattern": e.Pattern, "note": e.Note}
}

// ListAllowlist returns the platform allowlist (platform admins and auditors).
func (s *Service) ListAllowlist(ctx context.Context, a authz.Actor) ([]dbgen.CrawlAllowlist, error) {
	if err := requirePlatformRead(a); err != nil {
		return nil, err
	}
	return s.q.ListAllowlist(ctx)
}

// AddAllowlist adds a host pattern ("*" allows every public host).
func (s *Service) AddAllowlist(ctx context.Context, a authz.Actor, pattern, note string) (dbgen.CrawlAllowlist, error) {
	if err := requireAdmin(a); err != nil {
		return dbgen.CrawlAllowlist{}, err
	}
	p, err := NormalizePattern(pattern, true)
	if err != nil {
		return dbgen.CrawlAllowlist{}, err
	}
	if s.Fetcher.BlocksPattern(p) {
		return dbgen.CrawlAllowlist{}, errBlockedAddress
	}
	note = strings.TrimSpace(note)
	if len(note) > 500 {
		return dbgen.CrawlAllowlist{}, apperr.Invalid("invalid_note", "The note must be at most 500 characters")
	}
	var out dbgen.CrawlAllowlist
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		out, err = q.InsertAllowlist(ctx, dbgen.InsertAllowlistParams{Pattern: p, Note: note, CreatedBy: a.NullUser()})
		if apperr.IsUniqueViolation(err, "") {
			return apperr.Conflict("pattern_exists", "That pattern is already on the allowlist")
		} else if err != nil {
			return err
		}
		e := a.Audit("crawl.allowlist_add", "crawl_allowlist", out.ID.String())
		e.After = allowSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.Allow.Invalidate(uuid.NullUUID{})
	}
	return out, err
}

// RemoveAllowlist deletes a pattern. Running crawls stop fetching its hosts
// within AllowlistTTL.
func (s *Service) RemoveAllowlist(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if err := requireAdmin(a); err != nil {
		return err
	}
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		old, err := q.DeleteAllowlist(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.NotFound("pattern_not_found", "Allowlist entry not found")
		} else if err != nil {
			return err
		}
		e := a.Audit("crawl.allowlist_remove", "crawl_allowlist", id.String())
		e.Before = allowSnapshot(old)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.Allow.Invalidate(uuid.NullUUID{})
	}
	return err
}
