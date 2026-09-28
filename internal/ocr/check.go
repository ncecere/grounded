// Admin -> Parsing's Test button and its counts of documents to retry.

package ocr

import (
	"context"
	_ "embed"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/parse"
)

// SamplePNG is the built-in page the Test button reads (gen_sample.go).
//
//go:embed sample.png
var SamplePNG []byte

// SampleText is what SamplePNG says.
const SampleText = "Grounded OCR test page\nThe quick brown fox jumps over the lazy dog.\nInvoice 2026-0142: total 318.50"

// TestInput chooses what to test; empty fields use the saved settings, so
// an admin can test a backend before turning it on.
type TestInput struct {
	Backend       string
	VisionModelID *uuid.UUID
	Languages     string
}

// TestResult is what the backend read from the sample page.
type TestResult struct {
	OK         bool
	Backend    string
	Text       string
	Confidence float64
	Latency    time.Duration
	// TokensIn and TokensOut: a vision model's usage.
	TokensIn, TokensOut int
	// Error is why the backend failed (OK false).
	Error string
}

// Test reads the built-in sample page with a backend (platform admins; it
// may cost a vision model's tokens). Backend failures are results, not
// errors, so the page can show them.
func (s *Service) Test(ctx context.Context, a authz.Actor, in TestInput) (TestResult, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return TestResult{}, errAdminOnly
	}
	st, err := s.Load(ctx)
	if err != nil {
		return TestResult{}, err
	}
	set := st.Settings
	if in.Backend != "" {
		set.Backend = in.Backend
	}
	if in.VisionModelID != nil {
		set.VisionModelID = in.VisionModelID
	}
	if in.Languages != "" {
		set.Languages = in.Languages
	}
	set.Enabled = true
	if err := s.check(ctx, s.q, set); err != nil {
		return TestResult{}, err
	}
	eng, _, err := s.engine(ctx, set, "", false, "grounded-admin-test:"+a.UserID.String())
	if errors.Is(err, catalog.ErrVisionUnusable) {
		return TestResult{}, apperr.Invalid("model_unusable", "The vision model or its connection is disabled")
	} else if err != nil {
		return TestResult{}, err
	}
	start := time.Now()
	res, err := eng.Recognize(ctx, SamplePNG, set.Languages)
	out := TestResult{Backend: set.Backend, Latency: time.Since(start)}
	if err != nil {
		var ge *gateway.Error
		if errors.As(err, &ge) {
			out.Error = ge.Message
		} else {
			out.Error = err.Error()
		}
		return out, nil
	}
	out.OK, out.Confidence, out.TokensIn, out.TokensOut = true, res.Confidence, res.TokensIn, res.TokensOut
	out.Text = parse.CleanOCRText(res.Text)
	return out, nil
}

// TeamCount is how many documents of a team were skipped as scanned
// (needs_ocr); TeamID is null for platform-shared sources.
type TeamCount struct {
	TeamID    uuid.NullUUID
	TeamSlug  string
	TeamName  string
	Documents int64
}

// NeedsOCR counts the documents per team that OCR could now read
// (platform admins and auditors).
func (s *Service) NeedsOCR(ctx context.Context, a authz.Actor) ([]TeamCount, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	rows, err := s.q.CountNeedsOCRByTeam(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]TeamCount, len(rows))
	for i, r := range rows {
		out[i] = TeamCount{TeamID: r.TeamID, TeamSlug: r.TeamSlug, TeamName: r.TeamName, Documents: r.Documents}
	}
	return out, nil
}
