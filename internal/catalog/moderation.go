// Moderation models (ADR-0019, docs/phase4-publishing.md §4): the provider
// kind and guardrail family of a model of kind moderation, and a client for
// calling one. The adapters themselves live in internal/moderation.

package catalog

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Moderation provider kinds.
const (
	ModerationEndpoint   = "moderations_endpoint" // OpenAI-style POST /moderations
	ModerationGuardrail  = "guardrail_chat"       // a guardrail model over /chat/completions
	ModerationClassifier = "chat_classifier"      // any chat model with our JSON prompt
	// ModerationSystemOne is the provider of a SystemOne model (kind
	// systemone, ADR-0020). Moderation models no longer take it: the
	// migration to 00018 turned such models into SystemOne models.
	ModerationSystemOne = "system_one"
)

// Guardrail families of ModerationGuardrail.
const (
	FamilyLlamaGuard      = "llama_guard"
	FamilyGraniteGuardian = "granite_guardian"
	FamilyShieldGemma     = "shieldgemma"
)

var (
	moderationProviders = map[string]bool{ModerationEndpoint: true, ModerationGuardrail: true, ModerationClassifier: true}
	guardrailFamilies   = map[string]bool{FamilyLlamaGuard: true, FamilyGraniteGuardian: true, FamilyShieldGemma: true}
)

// normalizeModeration checks the moderation provider of a moderation model
// and clears it for other kinds. The family applies to guardrail_chat only.
func normalizeModeration(kind string, s *ModelSpec) error {
	if kind != KindModeration {
		s.ModerationProvider, s.ModerationFamily, s.ModerationTimeoutSeconds = "", "", nil
		return nil
	}
	if t := s.ModerationTimeoutSeconds; t != nil && *t == 0 {
		s.ModerationTimeoutSeconds = nil
	} else if t != nil && (*t < 1 || *t > 120) {
		return apperr.Invalid("invalid_moderation_timeout", "The moderation timeout must be 1-120 seconds")
	}
	if s.ModerationProvider == "" {
		s.ModerationProvider = ModerationEndpoint
	}
	if s.ModerationProvider == ModerationSystemOne {
		return apperr.Invalid("invalid_moderation_provider",
			"Add System One judgment APIs as SystemOne models (kind systemone); moderation policies can use them directly")
	}
	if !moderationProviders[s.ModerationProvider] {
		return apperr.Invalid("invalid_moderation_provider",
			"Moderation provider must be moderations_endpoint, guardrail_chat or chat_classifier")
	}
	if s.ModerationProvider != ModerationGuardrail {
		s.ModerationFamily = ""
		return nil
	}
	if !guardrailFamilies[s.ModerationFamily] {
		return apperr.Invalid("invalid_moderation_family", "Guardrail models need a family: llama_guard, granite_guardian or shieldgemma")
	}
	return nil
}

// ModerationProviderOf returns a moderation model's provider kind (models
// added before providers existed use the /moderations endpoint). SystemOne
// models are the system_one provider.
func ModerationProviderOf(m dbgen.Model) string {
	if m.Kind == KindSystemOne {
		return ModerationSystemOne
	}
	if m.ModerationProvider == nil || *m.ModerationProvider == "" {
		return ModerationEndpoint
	}
	return *m.ModerationProvider
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ModerationTarget is a moderation or SystemOne model with a client for its
// connection.
type ModerationTarget struct {
	Model  dbgen.Model
	Client *gateway.Client
	Conn   dbgen.ModelConnection
}

// ErrModerationUnusable is returned when a moderation model or its
// connection is missing or disabled.
var ErrModerationUnusable = apperr.New(503, "moderation_unavailable", "The moderation provider is disabled or unavailable. Ask a platform admin.")

// IsModerationProvider reports whether a model of this kind can be a
// moderation policy's provider.
func IsModerationProvider(kind string) bool { return kind == KindModeration || kind == KindSystemOne }

// ModerationTarget returns a client for an enabled moderation or SystemOne
// model on an enabled connection.
func (s *Service) ModerationTarget(ctx context.Context, modelID uuid.UUID) (ModerationTarget, error) {
	t, err := s.target(ctx, modelID, IsModerationProvider)
	if errors.Is(err, errUnusable) {
		return t, ErrModerationUnusable
	}
	return t, err
}

// ErrSystemOneUnusable is returned when a SystemOne model or its
// connection is missing or disabled.
var ErrSystemOneUnusable = apperr.New(503, "systemone_unavailable", "The SystemOne model is disabled or unavailable. Ask a platform admin.")

// SystemOneTarget returns a client for an enabled SystemOne model on an
// enabled connection. The client always honours the connection pacer's
// backoff (429, 529, 503 with Retry-After), even without a request limit.
func (s *Service) SystemOneTarget(ctx context.Context, modelID uuid.UUID) (ModerationTarget, error) {
	t, err := s.target(ctx, modelID, func(k string) bool { return k == KindSystemOne })
	if errors.Is(err, errUnusable) {
		return t, ErrSystemOneUnusable
	}
	return t, err
}

var errUnusable = errors.New("unusable")

// target loads an enabled model of an accepted kind on an enabled
// connection, with a client.
func (s *Service) target(ctx context.Context, modelID uuid.UUID, kind func(string) bool) (ModerationTarget, error) {
	m, err := s.q.GetModel(ctx, modelID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return ModerationTarget{}, errUnusable
	} else if err != nil {
		return ModerationTarget{}, err
	}
	if !kind(m.Kind) || !m.Enabled {
		return ModerationTarget{}, errUnusable
	}
	conn, err := s.q.GetConnection(ctx, m.ConnectionID)
	if err != nil {
		return ModerationTarget{}, err
	}
	if !conn.Enabled {
		return ModerationTarget{}, errUnusable
	}
	cl, err := s.observedClient(conn, m.Kind)
	if err != nil {
		return ModerationTarget{}, err
	}
	if m.Kind == KindSystemOne && cl.Limiter == nil && s.Pacer != nil {
		cl.Limiter = &connLimiter{pacer: s.Pacer, key: "conn:" + conn.ID.String(), log: s.Log}
	}
	return ModerationTarget{Model: m, Client: cl, Conn: conn}, nil
}

// ListUsableSystemOneModels returns the enabled SystemOne models on
// enabled connections (platform admins and auditors).
func (s *Service) ListUsableSystemOneModels(ctx context.Context) ([]dbgen.Model, error) {
	return s.q.ListUsableSystemOneModels(ctx)
}
