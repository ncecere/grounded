package ingest

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type documentLockRow struct {
	version int32
	status  string
	err     error
}

func (r documentLockRow) Scan(dst ...any) error {
	if r.err != nil {
		return r.err
	}
	*dst[0].(*int32), *dst[1].(*string) = r.version, r.status
	return nil
}

type documentLockTx struct {
	pgx.Tx
	t   *testing.T
	id  uuid.UUID
	ctx context.Context
	row pgx.Row
}

func (tx documentLockTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	tx.t.Helper()
	if ctx != tx.ctx || sql != "SELECT version, status FROM documents WHERE id = $1 FOR UPDATE" || len(args) != 1 || args[0] != tx.id {
		tx.t.Fatal("document guard changed its context, identity, selected fields or FOR UPDATE lock")
	}
	return tx.row
}

func TestLockDocumentVersionPreservesStaleAndErrorOutcomes(t *testing.T) {
	fault := errors.New("database unavailable")
	for _, tc := range []struct {
		name    string
		row     documentLockRow
		current bool
		err     error
	}{
		{"current", documentLockRow{version: 3, status: StatusReady}, true, nil},
		{"replaced", documentLockRow{version: 4, status: StatusReady}, false, nil},
		{"different stage", documentLockRow{version: 3, status: "processing"}, false, nil},
		{"deleted", documentLockRow{err: pgx.ErrNoRows}, false, nil},
		{"wrapped no rows", documentLockRow{err: fmt.Errorf("row: %w", pgx.ErrNoRows)}, false, nil},
		{"database fault", documentLockRow{err: fault}, false, fault},
		{"cancelled", documentLockRow{err: context.Canceled}, false, context.Canceled},
		{"deadline", documentLockRow{err: context.DeadlineExceeded}, false, context.DeadlineExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			id := uuid.New()
			tx := documentLockTx{t: t, id: id, ctx: ctx, row: tc.row}
			current, err := lockDocumentVersion(ctx, tx, id, 3, StatusReady)
			if current != tc.current || !errors.Is(err, tc.err) {
				t.Fatalf("current=%v err=%v; want %v, %v", current, err, tc.current, tc.err)
			}
		})
	}
}
