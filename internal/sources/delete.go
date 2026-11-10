package sources

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Delete removes a source, its documents, chunks, vectors and crawl runs;
// its stored files go when the deleted-files retention says, unless a legal
// hold keeps them (docs/operations/retention.md). Sources used by knowledge
// bases must be detached first.
func (s *Service) Delete(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID) error {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return err
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.source(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		kbs, err := q.SourceKnowledgeBases(ctx, id)
		if err != nil {
			return err
		}
		if len(kbs) > 0 {
			names := make([]string, len(kbs))
			for i, kb := range kbs {
				names[i] = kb.Name
			}
			return apperr.Conflict("source_in_use", "Remove this source from these knowledge bases first: "+strings.Join(names, ", "))
		}
		if err := q.DeleteSource(ctx, id); err != nil {
			return err
		}
		if err := retention.RecordDeletedFiles(ctx, q, retention.DeletedContent{
			TeamID: sc.teamID(), SourceID: id, Prefix: ingest.SourcePrefix(sc.teamID(), id), CreatedAt: cur.CreatedAt,
		}); err != nil {
			return err
		}
		e := a.Audit("source.delete", "data_source", id.String())
		e.TeamID, e.Before = sc.auditTeam(), sourceSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.Web.Promote(ctx, sc.teamID()) // its runs no longer hold crawl slots
	}
	return err
}

// deleteBlobs removes stored files after the database change committed. A
// failure only leaks storage, so it is logged rather than returned.
func (s *Service) deleteBlobs(ctx context.Context, prefix string) {
	if err := s.Blob.DeletePrefix(context.WithoutCancel(ctx), prefix); err != nil {
		s.Log.WarnContext(ctx, "could not delete stored files", "prefix", prefix, "err", err)
	}
}
