package retention

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Deleted documents and sources (docs/operations/retention.md): the
// database rows go at once (with their passages and vectors, so the content
// leaves retrieval immediately), and their stored files (originals and
// parsed text) are recorded here in the same transaction. The deleted-files
// rule removes the files after the grace period, unless a legal hold on the
// team covers them.

// DeletedContent describes the stored files of a deleted document or source.
type DeletedContent struct {
	TeamID   uuid.NullUUID // unset for platform-shared sources
	SourceID uuid.UUID
	// DocumentID is unset when a whole source was deleted.
	DocumentID uuid.NullUUID
	// Prefix is the object-store prefix holding the files.
	Prefix string
	// CreatedAt is when the content was first stored (for date-limited holds).
	CreatedAt time.Time
}

// RecordDeletedFiles records deleted content's files for the retention job.
// Call it in the transaction that deletes the rows.
func RecordDeletedFiles(ctx context.Context, q *dbgen.Queries, f DeletedContent) error {
	var from *time.Time
	if !f.CreatedAt.IsZero() {
		from = &f.CreatedAt
	}
	return q.InsertDeletedFiles(ctx, dbgen.InsertDeletedFilesParams{
		TeamID: f.TeamID, SourceID: f.SourceID, DocumentID: f.DocumentID, Prefix: f.Prefix, ContentFrom: from,
	})
}

// purgeFiles removes the stored files of a batch of due, unheld records,
// then the records. A storage failure rolls the batch back; removing a
// prefix again is harmless, so the next run retries it.
func purgeFiles(ctx context.Context, r *Runner, tx pgx.Tx, candidates string, now time.Time, batch int) (int64, error) {
	if r.Blob == nil {
		return 0, errors.New("no object store configured")
	}
	rows, err := tx.Query(ctx, fmt.Sprintf(`SELECT f.id, f.prefix FROM deleted_files f
WHERE f.id IN (SELECT c.key FROM (%s) c WHERE NOT c.held LIMIT $2)
FOR UPDATE OF f SKIP LOCKED`, candidates), now, batch)
	if err != nil {
		return 0, err
	}
	type file struct {
		id     uuid.UUID
		prefix string
	}
	files, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (file, error) {
		var f file
		return f, row.Scan(&f.id, &f.prefix)
	})
	if err != nil {
		return 0, err
	}
	ids := make([]uuid.UUID, 0, len(files))
	for _, f := range files {
		if err := r.Blob.DeletePrefix(ctx, f.prefix); err != nil {
			return 0, fmt.Errorf("delete stored files: %w", err)
		}
		ids = append(ids, f.id)
	}
	return dbgen.New(tx).DeleteDeletedFiles(ctx, ids)
}
