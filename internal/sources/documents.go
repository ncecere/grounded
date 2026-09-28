package sources

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tags"
)

// allowedExtensions are the v1 upload formats (DESIGN.md §5.2). Content is
// verified again by the parser.
var allowedExtensions = map[string]bool{
	".pdf": true, ".docx": true, ".pptx": true, ".html": true, ".htm": true,
	".md": true, ".markdown": true, ".txt": true,
}

// UploadResult reports what happened to one uploaded file.
type UploadResult struct {
	Filename string
	Status   string // "created", "replaced", "unchanged" or "rejected"
	Document *dbgen.Document
	Error    *apperr.Error
}

// Uploader accepts files for one source. Obtain it with BeginUpload so
// access is checked once per request.
type Uploader struct {
	s    *Service
	a    authz.Actor
	sc   scope
	team uuid.NullUUID // invalid for shared sources
	src  dbgen.DataSource
}

func (s *Service) BeginUpload(ctx context.Context, a authz.Actor, o Owner, sourceID uuid.UUID) (*Uploader, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return nil, err
	}
	src, err := s.source(ctx, s.q, sc, sourceID, false)
	if err != nil {
		return nil, err
	}
	if src.Type != TypeUpload {
		return nil, apperr.Invalid("not_upload_source", "Files can only be uploaded to upload sources; web sources fetch their pages")
	}
	if src.Status == "paused" {
		return nil, apperr.Conflict("source_paused", "This source is paused. Resume it to upload files.")
	}
	if err := s.Maintenance.Check(ctx); err != nil {
		return nil, err
	}
	return &Uploader{s: s, a: a, sc: sc, team: sc.teamID(), src: src}, nil
}

// limitReject turns a team limit error into a rejected upload result.
func limitReject(filename string, err error) (UploadResult, bool) {
	var le *limits.Error
	if !errors.As(err, &le) {
		return UploadResult{}, false
	}
	e, _ := apperr.As(le)
	return UploadResult{Filename: filename, Status: "rejected", Error: e}, true
}

// cleanFilename keeps the base name, without directories or control characters.
func cleanFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(strings.TrimSpace(name))
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
	if !utf8.ValidString(name) {
		name = strings.ToValidUTF8(name, "_")
	}
	if len(name) > 255 {
		ext := path.Ext(name)
		name = name[:255-len(ext)] + ext
	}
	if name == "." || name == "/" {
		return ""
	}
	return name
}

// sniffer hashes and counts the stream and keeps its first bytes.
type sniffer struct {
	r    io.Reader
	h    hash.Hash
	n    int64
	head []byte
}

func (s *sniffer) Read(p []byte) (int, error) {
	n, err := s.r.Read(p)
	if n > 0 {
		s.h.Write(p[:n])
		s.n += int64(n)
		if len(s.head) < 1024 {
			s.head = append(s.head, p[:min(n, 1024-len(s.head))]...)
		}
	}
	return n, err
}

func reject(filename, code, msg string, status int) UploadResult {
	return UploadResult{Filename: filename, Status: "rejected", Error: apperr.New(status, code, msg)}
}

// headMatches checks that content matches the extension's format, so a
// renamed binary is refused before it reaches the queue.
func headMatches(ext string, head []byte) bool {
	switch ext {
	case ".pdf":
		return bytes.Contains(head, []byte("%PDF-"))
	case ".docx", ".pptx":
		return bytes.HasPrefix(head, []byte("PK\x03\x04"))
	default:
		if bytes.HasPrefix(head, []byte{0xFF, 0xFE}) || bytes.HasPrefix(head, []byte{0xFE, 0xFF}) {
			return true
		}
		return bytes.IndexByte(head, 0) < 0
	}
}

// Upload stores one file and queues it for processing. Uploading a file with
// the same name as an existing document replaces it (a new version);
// identical content is left unchanged.
func (u *Uploader) Upload(ctx context.Context, filename string, body io.Reader, contentType string) (UploadResult, error) {
	s := u.s
	name := cleanFilename(filename)
	if name == "" {
		return reject(filename, "invalid_filename", "The file needs a name", http.StatusBadRequest), nil
	}
	ext := strings.ToLower(path.Ext(name))
	if !allowedExtensions[ext] {
		return reject(name, "unsupported_format", "Supported formats are PDF, DOCX, PPTX, HTML, Markdown and plain text", http.StatusUnsupportedMediaType), nil
	}
	existing, err := s.q.FindDocumentByExternalID(ctx, dbgen.FindDocumentByExternalIDParams{SourceID: u.src.ID, ExternalID: name})
	found := err == nil
	if err != nil && !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return UploadResult{}, err
	}
	// A team that is already at its documents or storage limit is told
	// before the file is streamed (replacements may still fit).
	if !found {
		if err := u.checkRoom(ctx, limits.Need{Documents: 1, Bytes: 1}); err != nil {
			return limitResult(name, err)
		}
	}
	docID := uuid.New()
	if found {
		docID = existing.ID
	}
	key := ingest.NewOriginalKey(u.team, u.src.ID, docID)

	sn := &sniffer{r: io.LimitReader(body, s.MaxUploadBytes+1), h: sha256.New()}
	if err := s.Blob.Put(ctx, key, sn, -1, contentType); err != nil {
		return UploadResult{}, err
	}
	discard := func() { _ = s.Blob.Delete(context.WithoutCancel(ctx), key) }
	if r, ok := checkContent(name, ext, sn, s.MaxUploadBytes); !ok {
		discard()
		return r, nil
	}
	sum := hex.EncodeToString(sn.h.Sum(nil))
	if found && existing.Sha256 == sum && existing.Status != "failed" {
		discard()
		return UploadResult{Filename: name, Status: "unchanged", Document: &existing}, nil
	}

	need := limits.Need{Bytes: sn.n, Documents: 1}
	if found {
		need = limits.Need{Bytes: sn.n - existing.SizeBytes}
	}
	doc, inserted, err := u.store(ctx, need, dbgen.UpsertUploadedDocumentParams{
		ID: docID, SourceID: u.src.ID, TeamID: u.team,
		ExternalID: name, Filename: name, ContentType: contentType, SizeBytes: sn.n, Sha256: sum,
		BlobKey: key, UploadedBy: nullUser(u.a),
	})
	if err != nil {
		discard()
		return limitResult(name, err)
	}
	if found && existing.BlobKey != "" && existing.BlobKey != key {
		s.deleteBlobs(ctx, strings.TrimSuffix(existing.BlobKey, "original"))
	}
	status := "replaced"
	if inserted {
		status = "created"
	}
	return UploadResult{Filename: name, Status: status, Document: &doc}, nil
}

// checkRoom checks that the team has room for need (sources without a team,
// or without limits, always do).
func (u *Uploader) checkRoom(ctx context.Context, need limits.Need) error {
	if !u.team.Valid || u.s.Limits == nil {
		return nil
	}
	return u.s.Limits.CheckResources(ctx, u.s.q, u.team.UUID, need)
}

// limitResult reports a limit error as a rejected file; other errors fail
// the upload.
func limitResult(name string, err error) (UploadResult, error) {
	if r, ok := limitReject(name, err); ok {
		return r, nil
	}
	return UploadResult{}, err
}

// checkContent rejects a streamed file that is too large, empty or not in
// its extension's format.
func checkContent(name, ext string, sn *sniffer, maxBytes int64) (UploadResult, bool) {
	switch {
	case sn.n > maxBytes:
		return reject(name, "too_large", "The file is larger than the upload limit", http.StatusRequestEntityTooLarge), false
	case sn.n == 0:
		return reject(name, "empty_file", "The file is empty", http.StatusBadRequest), false
	case !headMatches(ext, sn.head):
		return reject(name, "content_mismatch", "The file's content does not match its "+ext+" extension", http.StatusUnsupportedMediaType), false
	}
	return UploadResult{}, true
}

// store records the uploaded document within the team's limits (need) and
// queues it for processing. inserted is false for a replacement.
func (u *Uploader) store(ctx context.Context, need limits.Need, p dbgen.UpsertUploadedDocumentParams) (doc dbgen.Document, inserted bool, err error) {
	s := u.s
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if u.team.Valid && s.Limits != nil {
			if err := s.Limits.LockUsage(ctx, q, u.team.UUID); err != nil {
				return err
			}
			if err := s.Limits.CheckResources(ctx, q, u.team.UUID, need); err != nil {
				return err
			}
		}
		row, err := q.UpsertUploadedDocument(ctx, p)
		if err != nil {
			return err
		}
		doc, inserted = documentFromUpsert(row), row.Inserted
		return ingest.Kick(ctx, s.Jobs, tx)
	})
	return doc, inserted, err
}

// SetTags replaces the tags of the stored documents among results.
func (u *Uploader) SetTags(ctx context.Context, results []UploadResult, list []string) error {
	var ids []uuid.UUID
	for _, r := range results {
		if r.Document != nil && r.Status != "rejected" {
			ids = append(ids, r.Document.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return u.s.q.SetDocumentsTags(ctx, dbgen.SetDocumentsTagsParams{Ids: ids, Tags: list})
}

// Finish records the upload request in the audit log: one entry naming the
// document when a single document was created or replaced, otherwise one
// entry for the source with counts. Requests that changed nothing are not
// recorded.
func (u *Uploader) Finish(ctx context.Context, results []UploadResult) error {
	counts := map[string]int{}
	var changed []UploadResult
	for _, r := range results {
		counts[r.Status]++
		if r.Status == "created" || r.Status == "replaced" {
			changed = append(changed, r)
		}
	}
	if len(changed) == 0 {
		return nil
	}
	meta := map[string]any{
		"sourceId": u.src.ID.String(), "sourceName": u.src.Name, "shared": !u.src.TeamID.Valid,
		"created": counts["created"], "replaced": counts["replaced"], "unchanged": counts["unchanged"], "rejected": counts["rejected"],
	}
	var e audit.Entry
	if len(changed) == 1 {
		d := changed[0].Document
		e = u.a.Audit("document.upload", "document", d.ID.String())
		e.After = documentSnapshot(*d)
	} else {
		names := make([]string, 0, min(len(changed), 50))
		for _, r := range changed[:min(len(changed), 50)] {
			names = append(names, r.Filename)
		}
		e = u.a.Audit("document.upload", "data_source", u.src.ID.String())
		meta["count"], meta["filenames"] = len(changed), names
	}
	e.TeamID, e.Metadata = u.sc.auditTeam(), mergeMeta(e.Metadata, meta)
	return store.InTx(ctx, u.s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		// An upload batch changes which blocks repeat (ADR-0021).
		return u.s.requestBoilerplate(ctx, q, tx, u.src)
	})
}

func documentSnapshot(d dbgen.Document) map[string]any {
	return map[string]any{
		"sourceId": d.SourceID.String(), "filename": d.Filename, "url": d.URL, "title": d.Title,
		"sizeBytes": d.SizeBytes, "version": d.Version,
	}
}

func documentFromUpsert(r dbgen.UpsertUploadedDocumentRow) dbgen.Document {
	return dbgen.Document{
		ID: r.ID, SourceID: r.SourceID, TeamID: r.TeamID, ExternalID: r.ExternalID, Title: r.Title,
		Filename: r.Filename, URL: r.URL, Kind: r.Kind, ContentType: r.ContentType, SizeBytes: r.SizeBytes,
		Sha256: r.Sha256, Version: r.Version, BlobKey: r.BlobKey, Status: r.Status, ErrorCode: r.ErrorCode,
		ErrorMessage: r.ErrorMessage, Parser: r.Parser, Pages: r.Pages, Warnings: r.Warnings,
		ChunkCount: r.ChunkCount, TokenCount: r.TokenCount, Metadata: r.Metadata, Tags: r.Tags, Acl: r.Acl,
		Attempts: r.Attempts, UploadedBy: r.UploadedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		ProcessedAt: r.ProcessedAt, HttpEtag: r.HttpEtag, HttpLastModified: r.HttpLastModified, LastSeenCrawlID: r.LastSeenCrawlID,
		WaitingUntil: r.WaitingUntil,
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
	// Kind and Tag narrow to one document kind and one (normalised) tag.
	Kind *string
	Tag  *string
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
			BeforeCreated: beforeCreated, BeforeID: beforeID, PageSize: size,
		})
	}
	return s.q.ListDocuments(ctx, dbgen.ListDocumentsParams{
		SourceID: sourceID, Status: f.Status, Kind: f.Kind, Tag: f.Tag, BeforeCreated: beforeCreated, BeforeID: beforeID, PageSize: size,
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

// DocumentPassages returns a document's first passages (chunks) in order,
// with the document for the total count. Readers of the source may see them.
func (s *Service) DocumentPassages(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID, limit int32) (dbgen.Document, []dbgen.ListDocumentChunksRow, error) {
	doc, err := s.readDocument(ctx, a, o, sourceID, docID, breakglass.ReadPassages)
	if err != nil {
		return doc, nil, err
	}
	rows, err := s.q.ListDocumentChunks(ctx, dbgen.ListDocumentChunksParams{DocumentID: docID, PageSize: limit})
	return doc, rows, err
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
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"sourceId": src.ID.String(), "sourceName": src.Name, "shared": !src.TeamID.Valid})
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
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"sourceId": src.ID.String(), "shared": !src.TeamID.Valid})
		return audit.Record(ctx, q, e)
	})
	return doc, err
}

// RetryDocument re-queues a failed or skipped document.
func (s *Service) RetryDocument(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID) (dbgen.Document, error) {
	if _, _, _, err := s.document(ctx, a, o, sourceID, docID, true); err != nil {
		return dbgen.Document{}, err
	}
	if err := s.Maintenance.Check(ctx); err != nil {
		return dbgen.Document{}, err
	}
	var doc dbgen.Document
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var err error
		doc, err = dbgen.New(tx).RetryDocument(ctx, docID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.Conflict("not_retryable", "Only failed or skipped documents can be retried")
		} else if err != nil {
			return err
		}
		return ingest.Kick(ctx, s.Jobs, tx)
	})
	return doc, err
}
