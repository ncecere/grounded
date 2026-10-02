// OCR for a source's documents (docs/ocr.md §5, §5a): image uploads are
// refused at once where OCR can't read them, and documents skipped as
// scanned are retried together.

package sources

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var imageExtensions = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".tif": true, ".tiff": true}

// checkType refuses, before the file is streamed, a file type that can't
// be uploaded, and an image when OCR can't read the source's images (off
// for the platform or the source, or the vision model is above the source's
// classification). ok is false with the rejection (or an error).
func (u *Uploader) checkType(ctx context.Context, name, ext string) (UploadResult, bool, error) {
	if !allowedExtensions[ext] {
		return reject(name, "unsupported_format", unsupportedFormat, http.StatusUnsupportedMediaType), false, nil
	}
	if !imageExtensions[ext] {
		return UploadResult{}, true, nil
	}
	if !u.checkedOCR {
		if u.s.OCR == nil {
			u.noOCR = ocr.UnavailableMessage
		} else {
			why, err := u.s.OCR.Unavailable(ctx, u.src)
			if err != nil {
				return UploadResult{}, false, err
			}
			u.noOCR = why
		}
		u.checkedOCR = true
	}
	if u.noOCR != "" {
		return reject(name, "ocr_off", u.noOCR, http.StatusUnprocessableEntity), false, nil
	}
	return UploadResult{}, true, nil
}

// retryableCodes are the error codes documents can be retried by together.
var retryableCodes = map[string]bool{ingest.ErrorNeedsOCR: true}

// RetryDocuments queues a source's failed or skipped documents with the
// error code again, e.g. every document skipped as scanned once OCR is on.
// While OCR can read the source, partly scanned PDFs (ready, needs_ocr)
// are queued too, to read their pages without text; they aren't while it
// can't, since they would only be indexed again without them. It returns
// how many were queued; the retry is audited (document.retry_bulk).
func (s *Service) RetryDocuments(ctx context.Context, a authz.Actor, o Owner, sourceID uuid.UUID, errorCode string) (int, error) {
	errorCode = strings.TrimSpace(errorCode)
	if !retryableCodes[errorCode] {
		return 0, apperr.Invalid("invalid_error_code", "Documents can be retried together by the error code needs_ocr")
	}
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return 0, err
	}
	src, err := s.source(ctx, s.q, sc, sourceID, false)
	if err != nil {
		return 0, err
	}
	if err := s.Maintenance.Check(ctx); err != nil {
		return 0, err
	}
	state, err := s.OCR.State(ctx, src)
	if err != nil {
		return 0, err
	}
	var n int
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		ids, err := q.RetryDocumentsByError(ctx, dbgen.RetryDocumentsByErrorParams{SourceID: src.ID, ErrorCode: errorCode,
			IncludeReady: state == ocr.StateOn})
		if err != nil || len(ids) == 0 {
			return err
		}
		n = len(ids)
		e := a.Audit("document.retry_bulk", "data_source", src.ID.String())
		e.TeamID = sc.auditTeam()
		e.Metadata = map[string]any{"sourceName": src.Name, "errorCode": errorCode, "count": n, "shared": !src.TeamID.Valid}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return ingest.Kick(ctx, s.Jobs, tx)
	})
	return n, err
}

// checkPartlyScannedRetry refuses (409 ocr_off, saying why) to retry a
// partly scanned PDF (ready, needs_ocr) while OCR can't read its source:
// it would only be indexed again without its scanned pages.
func (s *Service) checkPartlyScannedRetry(ctx context.Context, src dbgen.DataSource, doc dbgen.Document) error {
	if doc.Status != ingest.StatusReady || doc.ErrorCode != ingest.ErrorNeedsOCR {
		return nil
	}
	state, err := s.OCR.State(ctx, src)
	if err != nil || state == ocr.StateOn {
		return err
	}
	return apperr.Conflict("ocr_off", retryOCROff[state])
}

// retryOCROff explains why a partly scanned PDF can't be retried yet.
var retryOCROff = map[string]string{
	ocr.StateSourceOff:   "OCR is off for this source, so the pages without text would be skipped again. Turn it on in the source's settings first.",
	ocr.StatePlatformOff: "OCR is off for the platform, so the pages without text would be skipped again. A platform admin can turn it on.",
	ocr.StateNotApproved: "The OCR vision model isn't approved for this source's classification, so the pages without text would be skipped again.",
}
