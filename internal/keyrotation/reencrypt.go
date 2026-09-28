package keyrotation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ColumnStats counts one column's stored values.
type ColumnStats struct {
	Column   string // table.column
	Total    int    // non-NULL values
	Current  int    // on ENCRYPTION_KEY (before this run)
	Previous int    // on ENCRYPTION_KEY_PREVIOUS (before this run)
	// Reencrypted is how many values this run moved to the current key.
	Reencrypted int
	// Undecryptable rows open with neither key; nothing is written while
	// any exist.
	Undecryptable []BadRow
}

// BadRow names a value that cannot be decrypted (never its contents).
type BadRow struct {
	Column string
	ID     uuid.UUID
	Reason string // "unknown key", "malformed" or "authentication failed"
}

// UndecryptableError lists every value that opens with neither key.
type UndecryptableError struct{ Rows []BadRow }

func (e *UndecryptableError) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d stored secret(s) cannot be decrypted with ENCRYPTION_KEY or ENCRYPTION_KEY_PREVIOUS; nothing was re-encrypted:", len(e.Rows))
	for _, r := range e.Rows {
		fmt.Fprintf(&b, "\n  %s id=%s (%s)", r.Column, r.ID, r.Reason)
	}
	b.WriteString("\nSet the key these were written with as ENCRYPTION_KEY_PREVIOUS, or re-enter them in the admin portal, then run again.")
	return b.String()
}

type row struct {
	id uuid.UUID
	ct []byte
}

func collect(rows pgx.Rows) ([]row, error) {
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		err := r.Scan(&x.id, &x.ct)
		return x, err
	})
}

func reason(box *secrets.Box, ct []byte) string {
	switch box.Which(ct) {
	case secrets.SlotMalformed:
		return "malformed"
	case secrets.SlotUnknown:
		return "unknown key"
	}
	return "authentication failed"
}

// scan reads every value of a column (without locks) and checks that each
// one decrypts, counting which key it is on.
func scan(ctx context.Context, pool *pgxpool.Pool, box *secrets.Box, c Column, batch int) (ColumnStats, error) {
	st := ColumnStats{Column: c.Name()}
	q := fmt.Sprintf("SELECT id, %[2]s FROM %[1]s WHERE %[2]s IS NOT NULL AND id > $1 ORDER BY id LIMIT $2", c.table(), c.col())
	for after := uuid.Nil; ; {
		rows, err := pool.Query(ctx, q, after, batch)
		if err != nil {
			return st, fmt.Errorf("%s: %w", c.Name(), err)
		}
		items, err := collect(rows)
		if err != nil {
			return st, fmt.Errorf("%s: %w", c.Name(), err)
		}
		for _, it := range items {
			st.Total++
			plain, err := box.Open(it.ct, c.AAD(it.id))
			clear(plain)
			switch {
			case err != nil:
				st.Undecryptable = append(st.Undecryptable, BadRow{Column: c.Name(), ID: it.id, Reason: reason(box, it.ct)})
			case box.Which(it.ct) == secrets.SlotCurrent:
				st.Current++
			default:
				st.Previous++
			}
			after = it.id
		}
		if len(items) < batch {
			return st, nil
		}
	}
}

// reencryptBatch moves up to batch values of a column that are not on the
// current key (and sort after `after`) to the current key, in one
// transaction with row locks, audited with the count. It returns how many
// it moved and the last id seen.
func reencryptBatch(ctx context.Context, pool *pgxpool.Pool, box *secrets.Box, c Column, after uuid.UUID, batch int) (int, uuid.UUID, error) {
	sel := fmt.Sprintf("SELECT id, %[2]s FROM %[1]s WHERE %[2]s IS NOT NULL AND substring(%[2]s FROM %[3]d FOR %[4]d) IS DISTINCT FROM $1 "+
		"AND id > $2 ORDER BY id LIMIT $3 FOR UPDATE", c.table(), c.col(), secrets.IDOffset+1, secrets.IDLen)
	upd := fmt.Sprintf("UPDATE %s SET %s = $1 WHERE id = $2", c.table(), c.col())
	n, last := 0, after
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, sel, box.CurrentKeyID(), after, batch)
		if err != nil {
			return err
		}
		items, err := collect(rows)
		if err != nil || len(items) == 0 {
			return err
		}
		for _, it := range items {
			plain, err := box.Open(it.ct, c.AAD(it.id))
			if err != nil {
				return &UndecryptableError{Rows: []BadRow{{Column: c.Name(), ID: it.id, Reason: reason(box, it.ct)}}}
			}
			sealed, err := box.Seal(plain, c.AAD(it.id))
			clear(plain)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, upd, sealed, it.id); err != nil {
				return err
			}
			n, last = n+1, it.id
		}
		return audit.Record(ctx, dbgen.New(tx), audit.Entry{
			ActorKind: audit.ActorSystem, Action: "platform.secrets_reencrypt", TargetType: "platform_keys", TargetID: "encryption_key",
			Metadata: map[string]any{"column": c.Name(), "rows": n},
		})
	})
	var bad *UndecryptableError
	if err != nil && !errors.As(err, &bad) {
		err = fmt.Errorf("%s: %w", c.Name(), err)
	}
	return n, last, err
}

// reencrypt moves every value of a column to the current key, batch by
// batch, calling progress after each batch.
func reencrypt(ctx context.Context, pool *pgxpool.Pool, box *secrets.Box, c Column, batch int, progress func(done int)) (int, error) {
	done := 0
	for after := uuid.Nil; ; {
		n, last, err := reencryptBatch(ctx, pool, box, c, after, batch)
		done += n
		if err != nil || n == 0 {
			return done, err
		}
		progress(done)
		after = last
		if n < batch {
			return done, nil
		}
	}
}
