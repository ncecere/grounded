package sources

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tags"
)

// documentLabel is a document's name as lists show it: its title, else its
// file name, else its address.
func documentLabel(d dbgen.Document) string {
	for _, v := range []string{d.Title, d.Filename, d.URL} {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return d.ID.String()
}

func documentSnapshot(d dbgen.Document) map[string]any {
	return map[string]any{
		"sourceId": d.SourceID.String(), "filename": d.Filename, "url": d.URL, "title": d.Title,
		"sizeBytes": d.SizeBytes, "version": d.Version,
	}
}

// DocumentPage is one page of documents, newest first.
type DocumentPage struct {
	Documents []dbgen.Document
	Next      *DocumentCursor
}

// DocumentCursor is the position after the last returned document.
type DocumentCursor struct {
	CreatedAt time.Time
	ID        uuid.UUID
}

// DocumentFilter narrows a document list: by status, and by a case-insensitive
// substring of the title, URL or file name.
type DocumentFilter struct {
	Status *string
	Search *string
	// ErrorCode narrows to documents with this error code (e.g. needs_ocr).
	ErrorCode *string
	// Kind and Tag narrow to one document kind and one (normalised) tag.
	Kind *string
	Tag  *string
	// PIIReview narrows to documents waiting for a review of possible personal data (flagged or held).
	PIIReview bool
}

func (s *Service) ListDocuments(ctx context.Context, a authz.Actor, o Owner, sourceID uuid.UUID, f DocumentFilter, after *DocumentCursor, limit int32) (DocumentPage, error) {
	sc, err := s.readAccess(ctx, a, o, sourceRead(breakglass.ReadDocumentList, sourceID))
	if err != nil {
		return DocumentPage{}, err
	}
	if _, err := s.source(ctx, s.q, sc, sourceID, false); err != nil {
		return DocumentPage{}, err
	}
	docs, err := s.listDocuments(ctx, sourceID, f, after, limit+1)
	if err != nil {
		return DocumentPage{}, err
	}
	page := DocumentPage{Documents: docs}
	if len(docs) > int(limit) {
		page.Documents = docs[:limit]
		last := page.Documents[len(page.Documents)-1]
		page.Next = &DocumentCursor{CreatedAt: last.CreatedAt, ID: last.ID}
	}
	return page, nil
}

// listDocuments runs SearchDocuments when there is search text (so the
// trigram index can serve it) and ListDocuments otherwise.
func (s *Service) listDocuments(ctx context.Context, sourceID uuid.UUID, f DocumentFilter, after *DocumentCursor, size int32) ([]dbgen.Document, error) {
	var beforeCreated *time.Time
	var beforeID uuid.NullUUID
	if after != nil {
		beforeCreated, beforeID = &after.CreatedAt, uuid.NullUUID{UUID: after.ID, Valid: true}
	}
	if f.Search != nil {
		return s.q.SearchDocuments(ctx, dbgen.SearchDocumentsParams{
			SourceID: sourceID, Search: store.EscapeLike(*f.Search), Status: f.Status, Kind: f.Kind, Tag: f.Tag,
			ErrorCode: f.ErrorCode, PiiReview: f.PIIReview, BeforeCreated: beforeCreated, BeforeID: beforeID, PageSize: size,
		})
	}
	return s.q.ListDocuments(ctx, dbgen.ListDocumentsParams{
		SourceID: sourceID, Status: f.Status, Kind: f.Kind, Tag: f.Tag, ErrorCode: f.ErrorCode, PiiReview: f.PIIReview,
		BeforeCreated: beforeCreated, BeforeID: beforeID, PageSize: size,
	})
}

func (s *Service) document(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID, write bool) (scope, dbgen.DataSource, dbgen.Document, error) {
	sc, err := s.access(ctx, a, o, write)
	if err != nil {
		return sc, dbgen.DataSource{}, dbgen.Document{}, err
	}
	return s.lookupDocument(ctx, sc, sourceID, docID)
}

// readDocument is document for a read (kind) that break-glass may allow.
func (s *Service) readDocument(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID, kind string) (dbgen.Document, error) {
	sc, err := s.readAccess(ctx, a, o, breakglass.Read{Kind: kind, TargetType: "document", TargetID: docID.String()})
	if err != nil {
		return dbgen.Document{}, err
	}
	_, _, doc, err := s.lookupDocument(ctx, sc, sourceID, docID)
	return doc, err
}

func (s *Service) lookupDocument(ctx context.Context, sc scope, sourceID, docID uuid.UUID) (scope, dbgen.DataSource, dbgen.Document, error) {
	src, err := s.source(ctx, s.q, sc, sourceID, false)
	if err != nil {
		return sc, src, dbgen.Document{}, err
	}
	doc, err := s.q.GetDocument(ctx, docID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && doc.SourceID != sourceID) {
		return sc, src, doc, errNoDocument
	}
	return sc, src, doc, err
}

func (s *Service) GetDocument(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID) (dbgen.Document, error) {
	return s.readDocument(ctx, a, o, sourceID, docID, breakglass.ReadDocument)
}

// SourceTags lists the tags a source's documents use (at most 200), for filters.
func (s *Service) SourceTags(ctx context.Context, a authz.Actor, o Owner, sourceID uuid.UUID) ([]string, error) {
	sc, err := s.readAccess(ctx, a, o, sourceRead(breakglass.ReadTags, sourceID))
	if err != nil {
		return nil, err
	}
	if _, err := s.source(ctx, s.q, sc, sourceID, false); err != nil {
		return nil, err
	}
	out, err := s.q.ListSourceTags(ctx, sourceID)
	if out == nil {
		out = []string{}
	}
	return out, err
}

// DeleteDocument removes a document with its chunks and vectors at once;
// its stored files go when the deleted-files retention says, unless a legal
// hold keeps them (docs/operations/retention.md). A page of a web source
// comes back on the next sync if it still exists.
func (s *Service) DeleteDocument(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID) error {
	sc, src, doc, err := s.document(ctx, a, o, sourceID, docID, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if _, err := q.DeleteDocument(ctx, docID); err != nil {
			if errors.Is(store.NotFound(err), store.ErrNotFound) {
				return errNoDocument
			}
			return err
		}
		if err := retention.RecordDeletedFiles(ctx, q, retention.DeletedContent{
			TeamID: sc.teamID(), SourceID: sourceID, DocumentID: uuid.NullUUID{UUID: docID, Valid: true},
			Prefix: ingest.DocumentPrefix(sc.teamID(), sourceID, docID), CreatedAt: doc.CreatedAt,
		}); err != nil {
			return err
		}
		e := a.Audit("document.delete", "document", docID.String())
		e.TeamID, e.Before = sc.auditTeam(), documentSnapshot(doc)
		// Its name stays with the entry: the log names a deleted document by it, not by its ID (v0.4.2 BU2-10).
		e.Metadata = audit.MergeMeta(e.Metadata, map[string]any{"sourceId": src.ID.String(), "sourceName": src.Name, "shared": !src.TeamID.Valid,
			"name": documentLabel(doc)})
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return s.requestBoilerplate(ctx, q, tx, src)
	})
}

// SetDocumentTags replaces a document's tags (editors; platform admins for
// shared sources). Tags take effect in retrieval at once.
func (s *Service) SetDocumentTags(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID, in []string) (dbgen.Document, error) {
	list, err := tags.Normalize(in)
	if err != nil {
		return dbgen.Document{}, err
	}
	sc, src, cur, err := s.document(ctx, a, o, sourceID, docID, true)
	if err != nil {
		return dbgen.Document{}, err
	}
	var doc dbgen.Document
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		var err error
		if doc, err = q.SetDocumentTags(ctx, dbgen.SetDocumentTagsParams{ID: docID, Tags: list}); err != nil {
			return err
		}
		e := a.Audit("document.tags", "document", docID.String())
		e.TeamID, e.Before, e.After = sc.auditTeam(), map[string]any{"tags": cur.Tags}, map[string]any{"tags": list}
		e.Metadata = audit.MergeMeta(e.Metadata, map[string]any{"sourceId": src.ID.String(), "shared": !src.TeamID.Valid})
		return audit.Record(ctx, q, e)
	})
	return doc, err
}

// RetryDocument re-queues a failed or skipped document, or a partly scanned
// PDF (ready, needs_ocr) while OCR can read its source.
func (s *Service) RetryDocument(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID) (dbgen.Document, error) {
	_, src, cur, err := s.document(ctx, a, o, sourceID, docID, true)
	if err != nil {
		return dbgen.Document{}, err
	}
	if err := s.Maintenance.Check(ctx); err != nil {
		return dbgen.Document{}, err
	}
	if err := s.checkPartlyScannedRetry(ctx, src, cur); err != nil {
		return dbgen.Document{}, err
	}
	var doc dbgen.Document
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var err error
		doc, err = dbgen.New(tx).RetryDocument(ctx, docID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.Conflict("not_retryable", "Only failed or skipped documents, and documents that need OCR, can be retried")
		} else if err != nil {
			return err
		}
		return ingest.Kick(ctx, s.Jobs, tx)
	})
	return doc, err
}
