package contextual

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Snapshot records, for the sets of a knowledge base that are about to be built for profileID, the settings of each source that opted in
// (model, failure policy, prompt version). A source that did not opt in gets no row and is embedded as it is; a source whose own profile
// is profileID is already built and is left alone. It runs in the transaction that starts the migration, before its jobs can run. It
// returns how many sources have context.
func Snapshot(ctx context.Context, q *dbgen.Queries, kbID, profileID uuid.UUID) (int, error) {
	rows, err := q.KBContextualSources(ctx, kbID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, r := range rows {
		if r.EmbeddingProfileID == profileID {
			continue
		}
		if err := q.InsertSetContextual(ctx, dbgen.InsertSetContextualParams{SourceID: r.SourceID, ProfileID: profileID, ModelID: r.ModelID.UUID,
			FailurePolicy: r.FailurePolicy, PromptVersion: PromptVersion}); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
