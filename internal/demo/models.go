package demo

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
)

// Model modes (docs/demo.md, "Models").
const (
	// ModelsExisting uses the install's default embedding profile and its
	// first usable chat model; the demo creates no model objects.
	ModelsExisting = ""
	// ModelsFake uses the built-in fake gateway (NewFakeModels) at FakeURL.
	ModelsFake = "fake"
	// ModelsOpenAI uses a real OpenAI-compatible gateway.
	ModelsOpenAI = "openai-compatible"
)

// Models selects the demo's models.
type Models struct {
	Mode string
	// FakeURL is the fake gateway's base URL, including /v1 (ModelsFake).
	FakeURL string
	// ModelsOpenAI: the chat model and the embedding model, each on its
	// gateway. The embedding URL and key default to the chat ones;
	// EmbedDims 0 asks the gateway.
	ChatURL, ChatKey, ChatModel    string
	EmbedURL, EmbedKey, EmbedModel string
	EmbedDims                      int
	// SystemOneModel optionally adds a SystemOne model on the chat gateway.
	SystemOneModel string
}

// Validate checks that the mode has what it needs.
func (m Models) Validate() error {
	switch m.Mode {
	case ModelsExisting:
		return nil
	case ModelsFake:
		if m.FakeURL == "" {
			return errors.New("--models=fake needs the fake gateway's URL (--fake-url)")
		}
		return nil
	case ModelsOpenAI:
		var missing []string
		for flag, v := range map[string]string{"--chat-url": m.ChatURL, "--chat-model": m.ChatModel, "--embed-model": m.EmbedModel} {
			if strings.TrimSpace(v) == "" {
				missing = append(missing, flag)
			}
		}
		if len(missing) > 0 {
			slices.Sort(missing)
			return fmt.Errorf("--models=openai-compatible needs %s (or the DEMO_* variables)", strings.Join(missing, ", "))
		}
		if m.EmbedDims < 0 {
			return errors.New("--embed-dims must be positive")
		}
		return nil
	}
	return fmt.Errorf("--models must be fake or openai-compatible (got %q)", m.Mode)
}

// modelChoice is what the demo's source, KB and agents use.
type modelChoice struct {
	chat, profile uuid.UUID
}

// catalogPlan names the connections, models and profile to ensure.
type catalogPlan struct {
	chatConn, embedConn    connSpec
	chat, embed, systemOne modelSpec
	profileKey, profile    string
}

type connSpec struct{ name, url, key string }

type modelSpec struct {
	key, kind, upstream, name string
	dims                      int32
}

// ensureModels returns the chat model and embedding profile to use,
// creating the model objects the mode asks for when they are missing.
func (s *seeder) ensureModels(ctx context.Context, level string) (modelChoice, error) {
	m := s.opts.Models
	switch m.Mode {
	case ModelsFake:
		s.res.FakeModels = true
		conn := connSpec{name: "Demo models (fake)", url: m.FakeURL, key: FakeAPIKey}
		return s.ensureCatalog(ctx, level, catalogPlan{
			chatConn: conn, embedConn: conn, profileKey: "demo-fake", profile: "Demo (fake embeddings)",
			chat:  modelSpec{key: "demo-fake-chat", kind: catalog.KindChat, upstream: FakeChatModel, name: "Demo model (canned answers)"},
			embed: modelSpec{key: "demo-fake-embed", kind: catalog.KindEmbedding, upstream: FakeEmbedModel, name: "Demo embeddings (fake)", dims: FakeEmbedDims},
		})
	case ModelsOpenAI:
		return s.ensureOpenAI(ctx, level)
	}
	return s.existingModels(ctx)
}

func (s *seeder) ensureOpenAI(ctx context.Context, level string) (modelChoice, error) {
	m := s.opts.Models
	chatConn := connSpec{name: "Demo models", url: m.ChatURL, key: m.ChatKey}
	embedConn := chatConn
	if (m.EmbedURL != "" && m.EmbedURL != m.ChatURL) || (m.EmbedKey != "" && m.EmbedKey != m.ChatKey) {
		chatConn.name = "Demo chat models"
		embedConn = connSpec{name: "Demo embedding models", url: or(m.EmbedURL, m.ChatURL), key: or(m.EmbedKey, m.ChatKey)}
	}
	plan := catalogPlan{
		chatConn: chatConn, embedConn: embedConn, profileKey: "demo", profile: "Demo embeddings",
		chat:  modelSpec{key: "demo-chat", kind: catalog.KindChat, upstream: m.ChatModel, name: "Demo chat (" + m.ChatModel + ")"},
		embed: modelSpec{key: "demo-embed", kind: catalog.KindEmbedding, upstream: m.EmbedModel, name: "Demo embeddings (" + m.EmbedModel + ")", dims: int32(m.EmbedDims)},
	}
	if m.SystemOneModel != "" {
		plan.systemOne = modelSpec{key: "demo-systemone", kind: catalog.KindSystemOne, upstream: m.SystemOneModel, name: "Demo SystemOne (" + m.SystemOneModel + ")"}
	}
	return s.ensureCatalog(ctx, level, plan)
}

func or(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (s *seeder) ensureCatalog(ctx context.Context, level string, p catalogPlan) (modelChoice, error) {
	chatConn, err := s.ensureConnection(ctx, p.chatConn)
	if err != nil {
		return modelChoice{}, err
	}
	embedConn := chatConn
	if p.embedConn.name != p.chatConn.name {
		if embedConn, err = s.ensureConnection(ctx, p.embedConn); err != nil {
			return modelChoice{}, err
		}
	}
	chat, err := s.ensureModel(ctx, chatConn, level, p.chat)
	if err != nil {
		return modelChoice{}, err
	}
	if p.embed.dims == 0 {
		if p.embed.dims, err = probeDims(ctx, p.embedConn, p.embed.upstream); err != nil {
			return modelChoice{}, err
		}
	}
	embed, err := s.ensureModel(ctx, embedConn, level, p.embed)
	if err != nil {
		return modelChoice{}, err
	}
	if p.systemOne.key != "" {
		if _, err := s.ensureModel(ctx, chatConn, level, p.systemOne); err != nil {
			return modelChoice{}, err
		}
	}
	profile, err := s.ensureProfile(ctx, p.profileKey, p.profile, embed)
	return modelChoice{chat: chat, profile: profile}, err
}

func (s *seeder) ensureConnection(ctx context.Context, c connSpec) (uuid.UUID, error) {
	list, err := s.svc.Catalog.ListConnections(ctx, s.actor)
	if err != nil {
		return uuid.Nil, err
	}
	for _, conn := range list {
		if conn.Name == c.name {
			return conn.ID, nil
		}
	}
	out, err := s.svc.Catalog.CreateConnection(ctx, s.actor, catalog.ConnectionInput{
		Name: c.name, Description: "Added by grounded demo", BaseURL: c.url, APIKey: c.key, Enabled: true,
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("model connection %q: %w", c.name, err)
	}
	s.created("model connection %q (%s)", c.name, out.BaseURL)
	return out.ID, nil
}

func (s *seeder) ensureModel(ctx context.Context, conn uuid.UUID, level string, m modelSpec) (uuid.UUID, error) {
	list, err := s.svc.Catalog.ListModels(ctx, s.actor, catalog.ModelFilter{})
	if err != nil {
		return uuid.Nil, err
	}
	for _, have := range list {
		if have.Key == m.key {
			return have.ID, nil
		}
	}
	spec := catalog.ModelSpec{UpstreamModel: m.upstream, DisplayName: m.name, MaxClassification: level, Enabled: true,
		Description: "Added by grounded demo"}
	if m.dims > 0 {
		spec.Dimensions = &m.dims
	}
	out, err := s.svc.Catalog.CreateModel(ctx, s.actor, catalog.ModelInput{ConnectionID: conn, Key: m.key, Kind: m.kind, ModelSpec: spec})
	if err != nil {
		return uuid.Nil, fmt.Errorf("%s model %q: %w", m.kind, m.upstream, err)
	}
	s.created("%s model %q", m.kind, m.name)
	return out.ID, nil
}

// ensureProfile creates the demo's embedding profile. It becomes the
// platform default only when it is the first profile (catalog rule), so an
// existing default is never replaced.
func (s *seeder) ensureProfile(ctx context.Context, key, name string, model uuid.UUID) (uuid.UUID, error) {
	list, err := s.svc.Catalog.ListProfiles(ctx, s.actor)
	if err != nil {
		return uuid.Nil, err
	}
	for _, p := range list {
		if p.Key == key {
			return p.ID, nil
		}
	}
	p, err := s.svc.Catalog.CreateProfile(ctx, s.actor, catalog.ProfileInput{
		Key: key, Name: name, Description: "Added by grounded demo", ModelID: model,
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("embedding profile: %w", err)
	}
	s.created("embedding profile %q", name)
	return p.ID, nil
}

// existingModels picks the install's default embedding profile and first
// usable chat model.
func (s *seeder) existingModels(ctx context.Context) (modelChoice, error) {
	profiles, err := s.svc.Catalog.ListUsableProfiles(ctx)
	if err != nil {
		return modelChoice{}, err
	}
	var out modelChoice
	for _, p := range profiles {
		if p.IsDefault {
			out.profile = p.ID
		}
	}
	chats, err := s.svc.Catalog.ListUsableChatModels(ctx)
	if err != nil {
		return modelChoice{}, err
	}
	if len(chats) > 0 {
		out.chat = chats[0].ID
	}
	if out.profile == uuid.Nil || out.chat == uuid.Nil {
		return out, errors.New("this install has no usable chat model or default embedding profile: " +
			"run grounded demo with --models=fake (no keys needed) or --models=openai-compatible (see grounded demo --help)")
	}
	return out, nil
}

// probeDims asks the gateway for one embedding to learn the model's
// dimensions.
func probeDims(ctx context.Context, c connSpec, model string) (int32, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	res, err := gateway.New(strings.TrimRight(c.url, "/"), c.key, time.Minute).Embed(ctx, gateway.EmbedRequest{
		Model: model, Input: []string{"Grounded demo dimension probe."}, User: "grounded-demo",
	})
	if err != nil {
		return 0, fmt.Errorf("embedding model %q: can't detect its dimensions (pass --embed-dims): %w", model, err)
	}
	if len(res.Vectors) == 0 || len(res.Vectors[0]) == 0 {
		return 0, fmt.Errorf("embedding model %q returned no vector: pass --embed-dims", model)
	}
	return int32(len(res.Vectors[0])), nil
}
