package platform

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// count is "1 team" or "3 teams".
func count(n int64, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// levelInUse refuses deleting a level that something refers to, naming what
// (AD-05): teams approved for it, models and MCP servers allowed up to it,
// data sources classified at it.
func levelInUse(u dbgen.ClassificationUsageRow) error {
	uses := map[string]int64{"teams": u.Teams, "models": u.Models, "sources": u.Sources, "mcpServers": u.McpServers}
	var parts []string
	for _, p := range []struct {
		n         int64
		one, many string
	}{{u.Teams, "team", "teams"}, {u.Models, "model", "models"}, {u.Sources, "data source", "data sources"}, {u.McpServers, "MCP server", "MCP servers"}} {
		if p.n > 0 {
			parts = append(parts, count(p.n, p.one, p.many))
		}
	}
	if len(parts) == 0 {
		return nil
	}
	return &apperr.Error{Status: 409, Code: "classification_in_use",
		Message: "This level is in use by " + strings.Join(parts, ", ") + ". Move them to another level first.",
		Details: map[string]any{"uses": uses}}
}

// DeleteClassification deletes an unused level (platform admins; audited).
// A level in use is refused with what uses it, and the last level stays.
func (s *Service) DeleteClassification(ctx context.Context, a authz.Actor, key string, expectedRevision int64) error {
	if !a.IsPlatformAdmin() || a.Key != nil {
		return errAdminOnly
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockClassificationConfig(ctx); err != nil {
			return err
		}
		cur, err := q.GetClassification(ctx, key)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.NotFound("classification_not_found", "Classification level not found")
		} else if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		levels, err := q.ListClassifications(ctx)
		if err != nil {
			return err
		}
		if len(levels) <= 1 {
			return apperr.Conflict("last_classification", "The last classification level can't be deleted")
		}
		usage, err := q.ClassificationUsage(ctx, key)
		if err != nil {
			return err
		}
		if err := levelInUse(usage); err != nil {
			return err
		}
		if err := q.DeleteClassification(ctx, key); err != nil {
			return err
		}
		e := a.Audit("platform.classification_delete", "classification", key)
		e.Before = levelSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}
