// Package ocr is OCR for scanned documents (docs/ocr.md): the platform's
// parsing settings (Admin -> Parsing), the backends (the grounded-ocr
// Tesseract sidecar, Apache Tika, a vision model) and what ingestion needs
// to read a document's pages without text: the engine, the per-document
// cap and the team's daily page limit.
package ocr

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Backends.
const (
	BackendTesseract = "tesseract"
	BackendTika      = "tika"
	BackendVision    = "vision"
)

// Backends lists every backend in display order.
var Backends = []string{BackendTesseract, BackendTika, BackendVision}

// BackendLabel names a backend for people ("Pages 3-7 were read with OCR
// (Tesseract)").
func BackendLabel(b string) string {
	switch b {
	case BackendTesseract:
		return "Tesseract"
	case BackendTika:
		return "Apache Tika"
	case BackendVision:
		return "a vision model"
	}
	return b
}

// Settings are Admin -> Parsing. OCR is off until an admin turns it on.
type Settings struct {
	Enabled       bool
	Backend       string
	VisionModelID *uuid.UUID
	// Languages are Tesseract language codes joined with "+" (Tesseract and
	// Tika backends).
	Languages string
}

// Stored are the settings with their revision. Settings never saved have
// revision 1 and no UpdatedAt.
type Stored struct {
	Settings
	Revision  int64
	UpdatedAt *time.Time
	UpdatedBy uuid.NullUUID
}

// DefaultLanguages is the language until an admin sets others.
const DefaultLanguages = "eng"

var languagesRE = regexp.MustCompile(`^[a-z_]{3,16}(\+[a-z_]{3,16}){0,9}$`)

// ValidLanguages reports whether langs is a "+"-joined list of up to ten
// Tesseract language codes (lower-case letters and underscores).
func ValidLanguages(langs string) bool { return languagesRE.MatchString(langs) }

func fromRow(row dbgen.ParsingSetting) Stored {
	out := Stored{Settings: Settings{Enabled: row.OcrEnabled, Backend: row.OcrBackend, Languages: row.Languages},
		Revision: row.Revision, UpdatedAt: &row.UpdatedAt, UpdatedBy: row.UpdatedBy}
	if row.VisionModelID.Valid {
		id := row.VisionModelID.UUID
		out.VisionModelID = &id
	}
	return out
}

// defaults are the settings before an admin saves any: off, with the first
// configured backend preselected.
func (s *Service) defaults() Stored {
	b := BackendTesseract
	for _, k := range Backends {
		if s.configured(k) {
			b = k
			break
		}
	}
	return Stored{Settings: Settings{Backend: b, Languages: DefaultLanguages}, Revision: 1}
}

func (s *Service) load(ctx context.Context, q *dbgen.Queries, lock bool) (Stored, error) {
	var (
		row dbgen.ParsingSetting
		err error
	)
	if lock {
		row, err = q.LockParsingSettings(ctx)
	} else {
		row, err = q.GetParsingSettings(ctx)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return s.defaults(), nil
	} else if err != nil {
		return Stored{}, err
	}
	return fromRow(row), nil
}

var (
	errAdminOnly = apperr.Forbidden("Only platform admins can do this")
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see this")
)

// Get returns the settings (platform admins and auditors).
func (s *Service) Get(ctx context.Context, a authz.Actor) (Stored, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return Stored{}, errReadOnly
	}
	return s.load(ctx, s.q, false)
}

// check validates settings to save: the languages, a known backend, and
// for OCR on, a configured backend (for vision, an enabled vision model).
func (s *Service) check(ctx context.Context, q *dbgen.Queries, in Settings) error {
	if !ValidLanguages(in.Languages) {
		return apperr.Invalid("invalid_languages", "Languages are Tesseract codes joined with +, for example eng or eng+spa")
	}
	known := false
	for _, b := range Backends {
		known = known || b == in.Backend
	}
	if !known {
		return apperr.Invalid("invalid_backend", "The OCR backend must be tesseract, tika or vision")
	}
	if in.VisionModelID != nil {
		m, err := q.GetModel(ctx, *in.VisionModelID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && m.Kind != catalog.KindVision) {
			return apperr.Invalid("invalid_model", "Choose a model of kind vision")
		} else if err != nil {
			return err
		}
	}
	if !in.Enabled {
		return nil
	}
	switch {
	case in.Backend == BackendVision && in.VisionModelID == nil:
		return apperr.Invalid("backend_not_configured", "Choose a vision model to use the vision backend")
	case in.Backend != BackendVision && !s.configured(in.Backend):
		return apperr.Invalid("backend_not_configured", fmt.Sprintf("The %s backend isn't configured: set %s", BackendLabel(in.Backend), s.configKey(in.Backend)))
	}
	return nil
}

func snapshot(st Settings) map[string]any {
	return map[string]any{"ocrEnabled": st.Enabled, "backend": st.Backend, "visionModelId": st.VisionModelID, "languages": st.Languages}
}

// Put replaces the settings (platform admins), audited in the same
// transaction (platform.parsing_settings_update). expectedRevision is the
// If-Match revision (1 for settings never saved).
func (s *Service) Put(ctx context.Context, a authz.Actor, in Settings, expectedRevision int64) (Stored, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Stored{}, errAdminOnly
	}
	var out Stored
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.load(ctx, q, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if err := s.check(ctx, q, in); err != nil {
			return err
		}
		row, err := save(ctx, q, cur, in, a)
		if err != nil {
			return err
		}
		out = fromRow(row)
		e := a.Audit("platform.parsing_settings_update", "parsing_settings", "platform")
		e.Before, e.After = snapshot(cur.Settings), snapshot(out.Settings)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.forget()
	}
	return out, err
}

func save(ctx context.Context, q *dbgen.Queries, cur Stored, in Settings, a authz.Actor) (dbgen.ParsingSetting, error) {
	model := uuid.NullUUID{}
	if in.VisionModelID != nil {
		model = uuid.NullUUID{UUID: *in.VisionModelID, Valid: true}
	}
	by := uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
	if cur.UpdatedAt == nil {
		row, err := q.InsertParsingSettings(ctx, dbgen.InsertParsingSettingsParams{OcrEnabled: in.Enabled, OcrBackend: in.Backend,
			VisionModelID: model, Languages: in.Languages, UpdatedBy: by})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return row, apperr.Stale() // saved concurrently
		}
		return row, err
	}
	return q.UpdateParsingSettings(ctx, dbgen.UpdateParsingSettingsParams{OcrEnabled: in.Enabled, OcrBackend: in.Backend,
		VisionModelID: model, Languages: in.Languages, UpdatedBy: by})
}
