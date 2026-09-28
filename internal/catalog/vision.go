// Vision models (docs/ocr.md §2): the OCR backend "vision" sends page
// images to a model of kind vision over /chat/completions.

package catalog

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ErrVisionUnusable is returned when the vision model or its connection is
// missing or disabled.
var ErrVisionUnusable = apperr.New(503, "ocr_unavailable", "The OCR vision model is disabled or unavailable. Ask a platform admin.")

// VisionTarget returns a client for an enabled vision model on an enabled
// connection. Like every model it may only read data up to its maximum
// classification: callers check it (VisionAllows). The client honours the
// connection's request limit and the proxy's backoff.
func (s *Service) VisionTarget(ctx context.Context, modelID uuid.UUID) (ModerationTarget, error) {
	t, err := s.target(ctx, modelID, func(k string) bool { return k == KindVision })
	if errors.Is(err, errUnusable) {
		return t, ErrVisionUnusable
	}
	if err == nil && t.Client.Limiter == nil && s.Pacer != nil {
		t.Client.Limiter = &connLimiter{pacer: s.Pacer, key: "conn:" + t.Conn.ID.String(), log: s.Log}
	}
	return t, err
}

// ModelAllows reports whether a model may process data of the given
// classification (ADR-0006 rule 4): its ceiling's rank is at least the
// data's.
func ModelAllows(ctx context.Context, q *dbgen.Queries, m dbgen.Model, classification string) (bool, error) {
	ceiling, err := q.GetClassification(ctx, m.MaxClassification)
	if err != nil {
		return false, err
	}
	level, err := q.GetClassification(ctx, classification)
	if err != nil {
		return false, err
	}
	return ceiling.Rank >= level.Rank, nil
}

// ListUsableVisionModels returns the enabled vision models on enabled
// connections.
func (s *Service) ListUsableVisionModels(ctx context.Context) ([]dbgen.Model, error) {
	return s.q.ListUsableVisionModels(ctx)
}
