package ingest

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// lockDocumentVersion claims the current document before an index transaction
// writes. A deleted, replaced or differently staged document is not current;
// callers retain their existing stale-result outcome. Other database errors
// remain errors, never permission to overwrite a newer document.
func lockDocumentVersion(ctx context.Context, tx pgx.Tx, id uuid.UUID, expectedVersion int32, expectedStatus string) (bool, error) {
	var version int32
	var status string
	err := tx.QueryRow(ctx, "SELECT version, status FROM documents WHERE id = $1 FOR UPDATE", id).Scan(&version, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return version == expectedVersion && status == expectedStatus, nil
}
