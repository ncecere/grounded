// Document handlers: listing, uploading (multipart, streamed to object
// storage), updating, deleting and retrying documents of a source.

package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tags"
)

// maxFilesPerUpload bounds one multipart request.
const maxFilesPerUpload = 100

func toAPIDocument(d dbgen.Document) apitypes.Document {
	warnings := []string{}
	_ = json.Unmarshal(d.Warnings, &warnings)
	msg, detail := documentError(d.Status, d.ErrorCode, d.ErrorMessage, d.Kind, d.Filename)
	return apitypes.Document{
		Id: d.ID, SourceId: d.SourceID, Title: d.Title, Filename: d.Filename, Url: d.URL, Kind: d.Kind,
		SizeBytes: d.SizeBytes, Version: d.Version, Status: apitypes.DocumentStatus(d.Status),
		ErrorCode: d.ErrorCode, ErrorMessage: msg, ErrorDetail: detail, Pages: d.Pages, ChunkCount: d.ChunkCount,
		TokenCount: d.TokenCount, Warnings: warnings, Tags: nonNilStrings(d.Tags), CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
		ProcessedAt: d.ProcessedAt, Ocr: documentOCR(d.Metadata),
	}
}

func (a *api) listDocuments(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		limit, ok := pageLimit(w, r)
		if !ok {
			return
		}
		keys, ok := decodeCursor(w, r, 2)
		if !ok {
			return
		}
		var after *sources.DocumentCursor
		if keys != nil {
			t, terr := time.Parse(time.RFC3339Nano, keys[0])
			did, ierr := uuid.Parse(keys[1])
			if terr != nil || ierr != nil {
				httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
				return
			}
			after = &sources.DocumentCursor{CreatedAt: t, ID: did}
		}
		var status *string
		if st := r.URL.Query().Get("status"); st != "" {
			status = &st
		}
		text, ok := search(w, r)
		if !ok {
			return
		}
		f := sources.DocumentFilter{Status: status, Search: text}
		if k := r.URL.Query().Get("kind"); k != "" {
			if !documentKinds[k] {
				httpx.Error(w, http.StatusBadRequest, "invalid_kind", "kind must be pdf, docx, pptx, html, markdown, text or image")
				return
			}
			f.Kind = &k
		}
		if code := r.URL.Query().Get("errorCode"); code != "" {
			f.ErrorCode = &code
		}
		if raw := r.URL.Query().Get("tag"); raw != "" {
			tag, ok := tags.One(raw)
			if !ok {
				httpx.Error(w, http.StatusBadRequest, "invalid_tag", "tag must be 1-64 characters without commas")
				return
			}
			f.Tag = &tag
		}
		page, err := a.Sources.ListDocuments(r.Context(), a.actor(r), owner(r), id, f, after, limit)
		if failed(w, r, err) {
			return
		}
		out := apitypes.DocumentPage{Items: make([]apitypes.Document, len(page.Documents))}
		for i, d := range page.Documents {
			out.Items[i] = toAPIDocument(d)
		}
		if page.Next != nil {
			out.NextCursor = encodeCursor(page.Next.CreatedAt.Format(time.RFC3339Nano), page.Next.ID.String())
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

// uploadDocuments streams each file part straight to object storage; files
// are never held in memory.
func (a *api) uploadDocuments(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		mr, err := r.MultipartReader()
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_upload", "Send files as multipart/form-data in a field named \"files\"")
			return
		}
		up, err := a.Sources.BeginUpload(r.Context(), a.actor(r), owner(r), id)
		if failed(w, r, err) {
			return
		}
		u := &multipartUpload{w: w, r: r, up: up, results: []apitypes.UploadResult{}}
		if !u.readParts(mr) || !u.applyTags() {
			return
		}
		if err := up.Finish(r.Context(), u.done); err != nil {
			httpx.Internal(w, r, err)
			return
		}
		u.respond()
	}
}

// multipartUpload is one document upload request in progress. Its methods
// write the response and return false when the request fails.
type multipartUpload struct {
	w         http.ResponseWriter
	r         *http.Request
	up        *sources.Uploader
	results   []apitypes.UploadResult
	done      []sources.UploadResult
	tagValues []string
}

// abort ends the upload after a failure: stored files keep their results.
func (u *multipartUpload) abort() { _ = u.up.Finish(u.r.Context(), u.done) }

// readParts reads the tags fields and stores the files fields.
func (u *multipartUpload) readParts(mr *multipart.Reader) bool {
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			return true
		}
		if err != nil {
			httpx.Error(u.w, http.StatusBadRequest, "invalid_upload", "The upload was interrupted or malformed")
			return false
		}
		if part.FormName() == "tags" && part.FileName() == "" {
			if !u.readTags(part) {
				return false
			}
			continue
		}
		if part.FormName() != "files" || part.FileName() == "" {
			_ = part.Close()
			continue
		}
		if !u.storeFile(part) {
			return false
		}
	}
}

// readTags reads one tags field.
func (u *multipartUpload) readTags(part *multipart.Part) bool {
	raw, err := io.ReadAll(io.LimitReader(part, 4096))
	_ = part.Close()
	if err != nil {
		httpx.Error(u.w, http.StatusBadRequest, "invalid_upload", "The upload was interrupted or malformed")
		return false
	}
	u.tagValues = append(u.tagValues, string(raw))
	// Validate on arrival: when tags come first (as documented), a bad
	// value fails before any file is stored.
	if _, err := tags.Normalize(tags.Split(u.tagValues)); err != nil {
		u.abort()
		httpx.Fail(u.w, u.r, err)
		return false
	}
	return true
}

// storeFile stores one file and records its result.
func (u *multipartUpload) storeFile(part *multipart.Part) bool {
	if len(u.results) >= maxFilesPerUpload {
		httpx.Error(u.w, http.StatusRequestEntityTooLarge, "too_many_files", "Upload at most 100 files per request")
		return false
	}
	res, err := u.up.Upload(u.r.Context(), part.FileName(), part, part.Header.Get("Content-Type"))
	_ = part.Close()
	if err != nil {
		u.abort()
		httpx.Internal(u.w, u.r, err)
		return false
	}
	u.done = append(u.done, res)
	out := apitypes.UploadResult{Filename: res.Filename, Status: apitypes.UploadResultStatus(res.Status)}
	if res.Document != nil {
		d := toAPIDocument(*res.Document)
		out.Document = &d
	}
	if res.Error != nil {
		out.Error = &struct {
			Code    string                      `json:"code"`
			Details *apitypes.LimitErrorDetails `json:"details,omitempty"`
			Message string                      `json:"message"`
		}{Code: res.Error.Code, Message: res.Error.Message, Details: limitDetails(res.Error.Details)}
	}
	u.results = append(u.results, out)
	return true
}

// applyTags applies the tags to every stored document of the request: they
// may come before or after the files.
func (u *multipartUpload) applyTags() bool {
	if u.tagValues == nil {
		return true
	}
	list, err := tags.Normalize(tags.Split(u.tagValues))
	if err != nil {
		u.abort()
		httpx.Fail(u.w, u.r, err)
		return false
	}
	if err := u.up.SetTags(u.r.Context(), u.done, list); err != nil {
		u.abort()
		httpx.Internal(u.w, u.r, err)
		return false
	}
	for i := range u.results {
		if u.results[i].Document != nil {
			u.results[i].Document.Tags = list
		}
	}
	return true
}

// respond writes the per-file results.
func (u *multipartUpload) respond() {
	if len(u.results) == 0 {
		httpx.Error(u.w, http.StatusBadRequest, "no_files", "No files were sent. Use a multipart field named \"files\".")
		return
	}
	// Nothing was accepted because the team is at a limit: answer like any
	// other create (409 limit_reached) rather than per file.
	if first := u.done[0].Error; first != nil && first.Code == "limit_reached" {
		all := true
		for _, d := range u.done {
			all = all && d.Error != nil && d.Error.Code == "limit_reached"
		}
		if all {
			httpx.Fail(u.w, u.r, first)
			return
		}
	}
	httpx.JSON(u.w, http.StatusOK, u.results)
}

func (a *api) documentIDs(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	src, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	doc, ok := pathUUID(w, r, "documentId")
	return src, doc, ok
}

func (a *api) getDocument(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, doc, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		d, err := a.Sources.GetDocument(r.Context(), a.actor(r), owner(r), src, doc)
		if failed(w, r, err) {
			return
		}
		httpx.JSON(w, http.StatusOK, toAPIDocument(d))
	}
}

// documentKinds are the values of Document.kind (the ?kind= filter).
var documentKinds = map[string]bool{"pdf": true, "docx": true, "pptx": true, "html": true, "markdown": true, "text": true, "image": true}

// listDocumentPassages returns a document's first passages (?limit=, 1-100, default 20).
func (a *api) listDocumentPassages(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, docID, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		limit := int32(20)
		if raw := r.URL.Query().Get("limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > 100 {
				httpx.Error(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 100")
				return
			}
			limit = int32(n)
		}
		doc, rows, err := a.Sources.DocumentPassages(r.Context(), a.actor(r), owner(r), src, docID, limit)
		if failed(w, r, err) {
			return
		}
		out := apitypes.DocumentPassagePage{Items: make([]apitypes.DocumentPassage, len(rows)), Total: doc.ChunkCount}
		for i, c := range rows {
			hp := c.HeadingPath
			if hp == nil {
				hp = []string{}
			}
			out.Items[i] = apitypes.DocumentPassage{
				Ordinal: c.Ordinal, Content: c.Content, HeadingPath: hp,
				PageStart: c.PageStart, PageEnd: c.PageEnd, TokenCount: c.TokenCount,
			}
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

// listSourceTags returns the tags used by a source's documents.
func (a *api) listSourceTags(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		out, err := a.Sources.SourceTags(r.Context(), a.actor(r), owner(r), src)
		if failed(w, r, err) {
			return
		}
		httpx.JSON(w, http.StatusOK, out)
	}
}

func (a *api) updateDocument(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		srcID, docID, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		var in apitypes.DocumentUpdate
		if !httpx.Decode(w, r, &in) {
			return
		}
		doc, err := a.Sources.SetDocumentTags(r.Context(), a.actor(r), owner(r), srcID, docID, in.Tags)
		if failed(w, r, err) {
			return
		}
		httpx.JSON(w, http.StatusOK, toAPIDocument(doc))
	}
}

func (a *api) deleteDocument(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, doc, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		writeOK(w, r, a.Sources.DeleteDocument(r.Context(), a.actor(r), owner(r), src, doc))
	}
}

func (a *api) retryDocument(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, doc, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		d, err := a.Sources.RetryDocument(r.Context(), a.actor(r), owner(r), src, doc)
		if failed(w, r, err) {
			return
		}
		httpx.JSON(w, http.StatusOK, toAPIDocument(d))
	}
}

// refetchDocument starts a crawl run of one page of a web source (W3).
func (a *api) refetchDocument(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		src, doc, ok := a.documentIDs(w, r)
		if !ok {
			return
		}
		c, err := a.Sources.RefetchDocument(r.Context(), a.actor(r), owner(r), src, doc)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		httpx.JSON(w, http.StatusAccepted, toAPICrawl(c))
	}
}
