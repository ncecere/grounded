package httpapi_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/testutil"
)

// Failure-only synthetic fixture metadata; no passage, generated text or credential.
func logContextualSharedIndexState(t *testing.T, env *ctxEnv, source, candidate uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), testutil.Scale(5*time.Second))
	defer cancel()
	var state string
	err := env.app.Pool.QueryRow(ctx, `SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)::text FROM (
		SELECT d.filename, d.status, d.version,
		 (SELECT count(*) FROM chunks c WHERE c.document_id=d.id AND c.profile_id=$2) AS plain_chunks,
		 (SELECT count(*) FROM chunks c WHERE c.document_id=d.id AND c.profile_id=$3) AS candidate_chunks
		FROM documents d WHERE d.source_id=$1 ORDER BY d.filename) x`, source, env.from.Id, candidate).Scan(&state)
	t.Logf("shared-source failure metadata: actual embedding inputs=%d document/profile state=%s queryErr=%v", len(env.proxy.EmbedInputs()), state, err)
}
