package audit

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Log reads the audit log. It does not decide who may read which part: the
// caller resolves the scope (a team, with or without its cost entries, or
// the whole platform) and checks the reader first (DESIGN.md §3.5).
type Log struct{ q *dbgen.Queries }

// NewLog reads the audit log through pool.
func NewLog(pool *pgxpool.Pool) *Log { return &Log{q: dbgen.New(pool)} }

// Page lists up to limit entries in scope, newest first; p carries the scope,
// the filters and the cursor (BeforeID). next is the last entry when more
// follow (nil at the end).
func (l *Log) Page(ctx context.Context, p dbgen.ListAuditParams, limit int32) (rows []dbgen.ListAuditRow, next *dbgen.ListAuditRow, err error) {
	p.PageSize = limit + 1
	if rows, err = l.q.ListAudit(ctx, p); err != nil {
		return nil, nil, err
	}
	rows, next = store.Page(rows, limit)
	return rows, next, nil
}

// Entry is one entry by ID within scope (store.ErrNotFound when it is not
// there or outside the scope).
func (l *Log) Entry(ctx context.Context, scope dbgen.ListAuditParams, id int64) (dbgen.ListAuditRow, error) {
	// The list query, newest first below id+1, one row: exactly this entry if it is in scope.
	before := id + 1
	scope.BeforeID, scope.PageSize = &before, 1
	rows, err := l.q.ListAudit(ctx, scope)
	if err != nil {
		return dbgen.ListAuditRow{}, err
	}
	if len(rows) == 0 || rows[0].ID != id {
		return dbgen.ListAuditRow{}, store.ErrNotFound
	}
	return rows[0], nil
}
