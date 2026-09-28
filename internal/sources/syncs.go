// Web syncs: starting, listing and cancelling crawl runs of a web source.

package sources

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/web"
)

// Sync starts a crawl run of a web source (trigger "manual"). When a run is
// active it returns *web.InProgressError carrying that run.
func (s *Service) Sync(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID) (dbgen.WebCrawl, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return dbgen.WebCrawl{}, err
	}
	var out dbgen.WebCrawl
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		src, err := s.source(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		if out, err = s.Web.StartRun(ctx, tx, src, web.TriggerManual, a.UserID); err != nil {
			return err
		}
		e := a.Audit("source.sync", "data_source", id.String())
		e.TeamID, e.Metadata = sc.auditTeam(), mergeMeta(e.Metadata, map[string]any{"crawlId": out.ID.String()})
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// RefetchDocument fetches one page of a web source again now: a crawl run
// (trigger "page") of just that URL (docs/ui-review W3). Editors and above;
// when a run is active it returns *web.InProgressError carrying that run.
func (s *Service) RefetchDocument(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID) (dbgen.WebCrawl, error) {
	sc, _, doc, err := s.document(ctx, a, o, sourceID, docID, true)
	if err != nil {
		return dbgen.WebCrawl{}, err
	}
	if doc.URL == "" {
		return dbgen.WebCrawl{}, apperr.Invalid("not_web_document", "Only pages of web sources can be re-fetched")
	}
	var out dbgen.WebCrawl
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		src, err := s.source(ctx, q, sc, sourceID, true)
		if err != nil {
			return err
		}
		if src.Type != "web" {
			return apperr.Invalid("not_web_document", "Only pages of web sources can be re-fetched")
		}
		if out, err = s.Web.StartPageRun(ctx, tx, src, doc.URL, a.UserID); err != nil {
			return err
		}
		e := a.Audit("document.refetch", "document", docID.String())
		e.TeamID = sc.auditTeam()
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"sourceId": sourceID.String(), "crawlId": out.ID.String(), "url": doc.URL, "shared": !src.TeamID.Valid})
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// Crawls lists a source's crawl runs, newest first.
func (s *Service) Crawls(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID, limit int32) ([]dbgen.WebCrawl, error) {
	sc, err := s.readAccess(ctx, a, o, sourceRead(breakglass.ReadCrawls, id))
	if err != nil {
		return nil, err
	}
	if _, err := s.source(ctx, s.q, sc, id, false); err != nil {
		return nil, err
	}
	return s.Web.ListRuns(ctx, id, limit)
}

// CancelCrawl cancels an active crawl run.
func (s *Service) CancelCrawl(ctx context.Context, a authz.Actor, o Owner, sourceID, crawlID uuid.UUID) (dbgen.WebCrawl, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return dbgen.WebCrawl{}, err
	}
	var out dbgen.WebCrawl
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if _, err := s.source(ctx, q, sc, sourceID, false); err != nil {
			return err
		}
		var err error
		if out, err = s.Web.CancelRun(ctx, tx, sourceID, crawlID); err != nil {
			return err
		}
		e := a.Audit("source.sync_cancel", "data_source", sourceID.String())
		e.TeamID, e.Metadata = sc.auditTeam(), mergeMeta(e.Metadata, map[string]any{"crawlId": crawlID.String()})
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.Web.Promote(ctx, sc.teamID())
	}
	return out, err
}
