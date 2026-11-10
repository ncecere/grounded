package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// insertUsageSQL is dbgen's InsertUsage for any number of rows: one array per
// column, kept in the rows' order (the ledger's IDs follow it).
const insertUsageSQL = `
INSERT INTO usage_events (kind, quantity, team_id, user_id, api_key_id, source_id, kb_id, document_id, model_id, agent_id, metadata)
SELECT u.kind, u.quantity, u.team_id, u.user_id, u.api_key_id, u.source_id, u.kb_id, u.document_id, u.model_id, u.agent_id, u.metadata::jsonb
FROM unnest($1::text[], $2::bigint[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[], $7::uuid[], $8::uuid[], $9::uuid[], $10::uuid[], $11::text[])
     WITH ORDINALITY AS u(kind, quantity, team_id, user_id, api_key_id, source_id, kb_id, document_id, model_id, agent_id, metadata, n)
ORDER BY u.n`

// InsertUsage writes usage ledger rows in one statement. An answer records
// six to eight of them (the query, tokens in and out, embeddings, checks);
// one by one, each was a round trip between the last word of the answer and
// the event that ends it.
func InsertUsage(ctx context.Context, db dbgen.DBTX, rows []dbgen.InsertUsageParams) error {
	if len(rows) == 0 {
		return nil
	}
	n := len(rows)
	kinds, quantities, metadata := make([]string, n), make([]int64, n), make([]*string, n)
	var ids [8][]pgtype.UUID
	for c := range ids {
		ids[c] = make([]pgtype.UUID, n)
	}
	for i, r := range rows {
		kinds[i], quantities[i] = r.Kind, r.Quantity
		if r.Metadata != nil { // nil stays NULL and is refused by the column, as for a single row
			m := string(r.Metadata)
			metadata[i] = &m
		}
		for c, id := range [8]uuid.NullUUID{r.TeamID, r.UserID, r.APIKeyID, r.SourceID, r.KBID, r.DocumentID, r.ModelID, r.AgentID} {
			ids[c][i] = pgtype.UUID{Bytes: id.UUID, Valid: id.Valid}
		}
	}
	_, err := db.Exec(ctx, insertUsageSQL, kinds, quantities, ids[0], ids[1], ids[2], ids[3], ids[4], ids[5], ids[6], ids[7], metadata)
	return err
}
