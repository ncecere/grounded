// Admin operations: reading and changing policies (audited), and testing
// providers.

package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var (
	errAdminOnly = apperr.Forbidden("Only platform admins can do this")
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see this")
)

// GetPolicy returns an audience's policy (platform admins and auditors).
func (s *Service) GetPolicy(ctx context.Context, a authz.Actor, audience string) (Stored, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return Stored{}, errReadOnly
	}
	return load(ctx, s.q, audience, false)
}

// PolicyInput is a complete policy to save.
type PolicyInput struct {
	ModelID *uuid.UUID
	Policy  Policy
}

func invalidPolicy(p []Problem) error {
	list := make([]map[string]string, len(p))
	for i, pr := range p {
		list[i] = map[string]string{"field": pr.Field, "problem": pr.Problem}
	}
	return &apperr.Error{Status: 400, Code: "invalid_policy", Message: "The moderation policy is invalid: " + p[0].String(),
		Details: map[string]any{"problems": list}}
}

// normalizeInput fills categories the input left out (off) and checks it.
func normalizeInput(audience string, in *PolicyInput) error {
	cats := map[string]CategoryRules{}
	for _, c := range Categories {
		cats[c] = CategoryRules{Input: Rule{ActionOff, DefaultThreshold}, Output: Rule{ActionOff, DefaultThreshold}}
	}
	for c, r := range in.Policy.Categories {
		cats[c] = r
	}
	in.Policy.Categories = cats
	in.Policy.Notice = strings.TrimSpace(in.Policy.Notice)
	if in.Policy.Notice == "" {
		in.Policy.Notice = DefaultNotice
	}
	in.Policy.SupportMessage = strings.TrimSpace(in.Policy.SupportMessage)
	if in.Policy.SupportMessage == "" {
		in.Policy.SupportMessage = DefaultSupportMessage
	}
	probs := in.Policy.Validate(audience)
	if in.Policy.Active(StageInput) || in.Policy.Active(StageOutput) {
		if in.ModelID == nil {
			probs = append(probs, Problem{"modelId", "Choose a moderation provider to moderate anything"})
		}
	}
	if len(probs) > 0 {
		return invalidPolicy(probs)
	}
	return nil
}

func policySnapshot(st Stored) map[string]any {
	return map[string]any{"modelId": st.ModelID, "policy": st.Policy}
}

// PutPolicy replaces an audience's policy (platform admins), audited in the
// same transaction. expectedRevision is the If-Match revision (1 for the
// defaults of a policy never saved).
func (s *Service) PutPolicy(ctx context.Context, a authz.Actor, audience string, in PolicyInput, expectedRevision int64) (Stored, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Stored{}, errAdminOnly
	}
	if !authz.ValidAudience(audience) {
		return Stored{}, errUnknownAudience()
	}
	if err := normalizeInput(audience, &in); err != nil {
		return Stored{}, err
	}
	var out Stored
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := load(ctx, q, audience, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if in.Policy.ReasoningEffort == "" { // not sent (an older client): keep the current one
			in.Policy.ReasoningEffort = cur.Policy.ReasoningEffort
		}
		if in.ModelID != nil {
			m, err := q.GetModel(ctx, *in.ModelID)
			if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && !catalog.IsModerationProvider(m.Kind)) {
				return apperr.Invalid("invalid_model", "The provider must be a moderation or SystemOne model")
			} else if err != nil {
				return err
			}
		}
		raw, _ := json.Marshal(in.Policy)
		model := uuid.NullUUID{}
		if in.ModelID != nil {
			model = uuid.NullUUID{UUID: *in.ModelID, Valid: true}
		}
		by := uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
		var row dbgen.ModerationPolicy
		if cur.UpdatedAt == nil {
			row, err = q.InsertModerationPolicy(ctx, dbgen.InsertModerationPolicyParams{Audience: audience, ModelID: model, Policy: raw, UpdatedBy: by})
			if errors.Is(store.NotFound(err), store.ErrNotFound) {
				return apperr.Stale() // saved concurrently
			}
		} else {
			row, err = q.UpdateModerationPolicy(ctx, dbgen.UpdateModerationPolicyParams{Audience: audience, ModelID: model, Policy: raw, UpdatedBy: by})
		}
		if err != nil {
			return err
		}
		out = Stored{Audience: audience, ModelID: in.ModelID, Policy: in.Policy, Revision: row.Revision, UpdatedAt: &row.UpdatedAt, UpdatedBy: row.UpdatedBy}
		e := a.Audit("platform.moderation_policy_update", "moderation_policy", audience)
		e.Before, e.After = policySnapshot(cur), policySnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// MaxTestChars bounds the test box's text.
const MaxTestChars = 8000

// Test runs a moderation model on a text (platform admins). Provider
// failures are errors (503 moderation_unavailable, with the proxy's
// message).
func (s *Service) Test(ctx context.Context, a authz.Actor, modelID uuid.UUID, stage, text string) (Result, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Result{}, errAdminOnly
	}
	if strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > MaxTestChars {
		return Result{}, apperr.Invalid("invalid_text", "The text must be 1-8000 characters")
	}
	if stage == "" {
		stage = StageInput
	}
	if stage != StageInput && stage != StageOutput {
		return Result{}, apperr.Invalid("invalid_stage", "Stage must be input or output")
	}
	prov, err := s.provider(ctx, modelID)
	if err != nil {
		return Result{}, err
	}
	res, err := s.run(ctx, prov, Input{Stage: stage, Text: text, Question: "(test)"})
	if err != nil {
		return res, providerError(err)
	}
	return res, nil
}

// providerError reports a provider failure to an admin.
func providerError(err error) error {
	msg := err.Error()
	var ge *gateway.Error
	if errors.As(err, &ge) {
		msg = ge.Message
		if ge.Backpressure() {
			return apperr.New(503, "model_busy", "The moderation provider is busy: "+msg)
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		msg = "timed out"
	}
	return apperr.New(503, "moderation_unavailable", "The moderation provider failed: "+msg)
}

// ModelTest is "Test model" for a moderation model: one benign and one
// harmful fixed sample.
type ModelTest struct {
	OK                      bool
	Latency                 time.Duration
	Benign, Harmful         Result
	BenignText, HarmfulText string
	Error                   *catalog.ProbeError
}

// TestModel runs the two samples (platform admins). A provider failure is
// reported in Error, not as an error.
func (s *Service) TestModel(ctx context.Context, a authz.Actor, modelID uuid.UUID) (ModelTest, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return ModelTest{}, errAdminOnly
	}
	t, err := s.Catalog.ModerationTarget(ctx, modelID)
	if err != nil {
		return ModelTest{}, err
	}
	prov, err := s.bind(t)
	if err != nil {
		return ModelTest{}, err
	}
	out := ModelTest{BenignText: defs.Samples.Benign, HarmfulText: defs.Samples.Harmful}
	start := time.Now()
	for _, c := range []struct {
		text string
		dst  *Result
	}{{defs.Samples.Benign, &out.Benign}, {defs.Samples.Harmful, &out.Harmful}} {
		if *c.dst, err = s.run(ctx, prov, Input{Stage: StageInput, Text: c.text}); err != nil {
			out.Latency = time.Since(start)
			out.Error = &catalog.ProbeError{Kind: gateway.KindUnavailable, Message: err.Error()}
			var ge *gateway.Error
			if errors.As(err, &ge) {
				out.Error = &catalog.ProbeError{Kind: ge.Kind, Status: ge.Status, Message: ge.Message}
			}
			return out, nil
		}
	}
	out.Latency, out.OK = time.Since(start), true
	return out, nil
}
