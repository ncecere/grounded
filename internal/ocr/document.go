// What ingestion and uploads need: the OCR to use for a source's document,
// whether an image upload can be read at all, the daily page limit and the
// usage ledger.

package ocr

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Plan is OCR for one document: the parser's options and, for the vision
// backend, the model (for the usage ledger).
type Plan struct {
	Options *parse.OCROptions
	ModelID uuid.NullUUID
}

// Why OCR can't run for a source (Unavailable reasons).
var (
	errOff            = errors.New("OCR is off")
	errClassification = errors.New("the OCR vision model isn't approved for this source's classification")
)

// engine resolves the settings' backend to an engine: errOff when it isn't
// configured, catalog.ErrVisionUnusable when the vision model or its
// connection is disabled, errClassification when the vision model may not
// read data of the source's classification. classification "" skips that
// check (the admin Test reads a built-in sample).
func (s *Service) engine(ctx context.Context, st Settings, classification string, background bool, user string) (parse.OCR, uuid.NullUUID, error) {
	switch st.Backend {
	case BackendTesseract:
		if s.tesseract != nil {
			return s.tesseract, uuid.NullUUID{}, nil
		}
	case BackendTika:
		if s.Config.Tika != nil {
			return s.Config.Tika, uuid.NullUUID{}, nil
		}
	case BackendVision:
		if st.VisionModelID == nil {
			return nil, uuid.NullUUID{}, errOff
		}
		t, err := s.Catalog.VisionTarget(ctx, *st.VisionModelID)
		if err != nil {
			return nil, uuid.NullUUID{}, err
		}
		if classification != "" {
			ok, err := catalog.ModelAllows(ctx, s.q, t.Model, classification)
			if err != nil {
				return nil, uuid.NullUUID{}, err
			}
			if !ok {
				return nil, uuid.NullUUID{}, errClassification
			}
		}
		return &vision{target: t, user: user, background: background}, uuid.NullUUID{UUID: t.Model.ID, Valid: true}, nil
	}
	return nil, uuid.NullUUID{}, errOff
}

// ForDocument returns OCR for a document of src, or a nil Plan.Options when
// OCR is off for the platform or the source, or its backend can't read
// this source (then parsing is as without OCR). An error means the
// settings could not be read.
func (s *Service) ForDocument(ctx context.Context, src dbgen.DataSource, doc dbgen.Document) (Plan, error) {
	if s == nil || !src.OcrEnabled {
		return Plan{}, nil
	}
	st, err := s.Load(ctx)
	if err != nil || !st.Enabled {
		return Plan{}, err
	}
	eng, model, err := s.engine(ctx, st.Settings, src.Classification, true, userOf(doc.TeamID))
	if err != nil {
		if errors.Is(err, errOff) || errors.Is(err, errClassification) || errors.Is(err, catalog.ErrVisionUnusable) {
			s.Log.InfoContext(ctx, "OCR not used for document", "document", doc.ID, "reason", err)
			return Plan{}, nil
		}
		return Plan{}, err
	}
	team := doc.TeamID
	return Plan{ModelID: model, Options: &parse.OCROptions{
		Engine: limited{OCR: eng, sem: s.sem}, Backend: st.Backend, Languages: st.Languages,
		MaxPages: s.Config.MaxPagesPerDocument, Concurrency: s.Config.Concurrency,
		Reserve: func(ctx context.Context, pages int) (int, error) { return s.reserve(ctx, team, pages) },
	}}, nil
}

// userOf attributes gateway requests to the team (as embeddings are).
func userOf(team uuid.NullUUID) string {
	if team.Valid {
		return "team:" + team.UUID.String()
	}
	return "platform"
}

// UnavailableMessage is why an image can't be uploaded to a source: images
// need OCR (docs/ocr.md §5a).
const UnavailableMessage = "Images need OCR, which is off for this source"

// Unavailable returns "" when src's images can be read with OCR, or the
// reason they can't, for people.
func (s *Service) Unavailable(ctx context.Context, src dbgen.DataSource) (string, error) {
	if s == nil || !src.OcrEnabled {
		return UnavailableMessage, nil
	}
	st, err := s.Load(ctx)
	if err != nil {
		return "", err
	}
	if !st.Enabled {
		return UnavailableMessage, nil
	}
	_, _, err = s.engine(ctx, st.Settings, src.Classification, true, "")
	switch {
	case err == nil:
		return "", nil
	case errors.Is(err, errClassification):
		return "Images need OCR, and the OCR vision model isn't approved for this source's classification", nil
	case errors.Is(err, errOff), errors.Is(err, catalog.ErrVisionUnusable):
		return UnavailableMessage, nil
	}
	return "", err
}

// reserve admits pages of a team's document under ocr_pages_per_day (UTC
// day, counted from the usage ledger). A document needing more than the
// whole limit reads as many pages as the limit allows; one that would pass
// what is left of today waits until tomorrow (*parse.OCRWait) or until the
// limit is raised. Documents running at the same moment are not counted
// against each other, so a day may end a few documents over the limit.
// Platform-shared sources count against no limit.
func (s *Service) reserve(ctx context.Context, team uuid.NullUUID, pages int) (int, error) {
	if !team.Valid || s.Limits == nil {
		return pages, nil
	}
	set, err := s.Limits.Effective(ctx, nil, team.UUID)
	if err != nil {
		return 0, err
	}
	limit := set.Get(limits.OCRPagesPerDay)
	if limit == nil {
		return pages, nil
	}
	if *limit <= 0 {
		return 0, nil
	}
	need := min(int64(pages), *limit)
	used, err := s.Limits.UsageToday(ctx, nil, team.UUID, limits.UsageOCRPages)
	if err != nil {
		return 0, err
	}
	if used+need > *limit {
		s.Limits.ReachedDaily(ctx, team.UUID, limits.OCRPagesPerDay, *limit)
		return 0, &parse.OCRWait{Until: limits.NextDay(s.Now()), Pages: int(need)}
	}
	return int(need), nil
}

// UsageEvents are a document's OCR usage for the ledger: the pages read
// (ocr_pages, with the backend) and a vision model's tokens.
func UsageEvents(info *parse.OCRInfo, model uuid.NullUUID) []dbgen.InsertUsageParams {
	if info == nil {
		return nil
	}
	meta, _ := json.Marshal(map[string]any{"backend": info.Backend})
	var out []dbgen.InsertUsageParams
	if len(info.Pages) > 0 {
		out = append(out, dbgen.InsertUsageParams{Kind: limits.UsageOCRPages, Quantity: int64(len(info.Pages)), Metadata: meta})
	}
	if info.Backend == BackendVision {
		if info.TokensIn > 0 {
			out = append(out, dbgen.InsertUsageParams{Kind: limits.UsageVisionIn, Quantity: int64(info.TokensIn), ModelID: model, Metadata: meta})
		}
		if info.TokensOut > 0 {
			out = append(out, dbgen.InsertUsageParams{Kind: limits.UsageVisionOut, Quantity: int64(info.TokensOut), ModelID: model, Metadata: meta})
		}
	}
	return out
}
