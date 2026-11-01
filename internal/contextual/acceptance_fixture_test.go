package contextual

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Explicit test-fixture options, not arbitrary provider JSON or model presets.
type acceptanceChatCompat struct {
	MaxTokensField string `json:"maxTokensField,omitempty"`
	ThinkingOff    string `json:"thinkingOff,omitempty"`
}

func (c acceptanceChatCompat) valid() bool {
	return (c.MaxTokensField == "" || c.MaxTokensField == "max_tokens" || c.MaxTokensField == "max_completion_tokens") &&
		(c.ThinkingOff == "" || c.ThinkingOff == "reasoning_effort_none")
}

type acceptanceConfig struct {
	ChatCompat    acceptanceChatCompat
	Endpoint      string
	Currency      string
	Dimensions    int
	ContextWindow int32
	Seconds       int
	Limits        acceptanceLimits
}

func acceptancePreflight(config acceptanceConfig, g *Generator) (acceptanceUsage, error) {
	if config.Dimensions < 1 || config.Dimensions > 4000 || config.Seconds < 1 || config.Seconds > 300 || config.ContextWindow < int32(MinContextWindow()) || !config.ChatCompat.valid() {
		return acceptanceUsage{}, errors.New("acceptance requires bounded time/dimensions and a sufficient known context window")
	}
	if len(config.Currency) != 3 {
		return acceptanceUsage{}, errors.New("acceptance requires explicit currency")
	}
	for _, r := range config.Currency {
		if r < 'A' || r > 'Z' {
			return acceptanceUsage{}, errors.New("acceptance requires explicit ISO currency")
		}
	}
	probe, err := newAcceptanceTransport(config.Endpoint, config.Limits, g.Counter)
	if err != nil {
		return acceptanceUsage{}, err
	}
	plain, contextual := 0, 0
	for _, doc := range acceptanceDocuments {
		chunks := acceptanceChunks(doc, g.Counter)
		in := BuildInput(doc.Title, chunks[0].HeadingPath, Opening(chunks, g.Counter), chunks[0].Content, g.Counter)
		input := WithMargin(g.Counter.Count(SystemPrompt) + g.Counter.Count(UserMessage(in)) + 16)
		if input+RequestMaxTokens > int(config.ContextWindow) {
			return acceptanceUsage{}, errors.New("acceptance corpus exceeds configured context window")
		}
		if err := probe.reserve("context", int64(input), RequestMaxTokens); err != nil {
			return acceptanceUsage{}, err
		}
		base := g.Counter.Count(chunks[0].Content) + g.Counter.Count(doc.Title) + 128
		plain += base
		// A conservative byte-based allowance for an unknown kept prefix:
		// at most500 Unicode characters, at most4 UTF-8 bytes each, plus separators.
		contextual += base + 4*ContextMaxChars + 128
	}
	query := 0
	for _, q := range acceptanceQuestions {
		query += g.Counter.Count(q.Text)
	}
	for _, input := range []int{plain, contextual, query} {
		if err := probe.reserve("embedding", int64(WithMargin(input)+32), 0); err != nil {
			return acceptanceUsage{}, err
		}
	}
	return probe.snapshot(), nil
}

type acceptanceResolver struct {
	pool   *pgxpool.Pool
	client *gateway.Client
}

func (r acceptanceResolver) ChatTarget(ctx context.Context, id uuid.UUID) (catalog.ChatTarget, error) {
	q := dbgen.New(r.pool)
	m, err := q.GetModel(ctx, id)
	if err != nil {
		return catalog.ChatTarget{}, err
	}
	conn, err := q.GetConnection(ctx, m.ConnectionID)
	if err != nil {
		return catalog.ChatTarget{}, err
	}
	if !m.Enabled || m.Kind != catalog.KindChat || !conn.Enabled || conn.BaseURL != r.client.BaseURL {
		return catalog.ChatTarget{}, catalog.ErrChatModelUnusable
	}
	return catalog.ChatTarget{Model: m, Client: r.client, ConnectionRevision: conn.Revision}, nil
}

func acceptanceClient(config acceptanceConfig, key string, guard *acceptanceTransport) *gateway.Client {
	client := gateway.New(config.Endpoint, key, min(time.Duration(config.Seconds)*time.Second, 30*time.Second))
	client.HTTP.Transport = guard
	client.HTTP.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("acceptance refuses redirects") }
	return client
}

func configureAcceptanceFixture(ctx context.Context, f settlementFixture, config acceptanceConfig, calls int64) error {
	exec := func(sql string, args ...any) error { _, err := f.pool.Exec(ctx, sql, args...); return err }
	compat, err := json.Marshal(config.ChatCompat)
	if err != nil {
		return err
	}
	if err := exec(`UPDATE models SET upstream_model = $2, context_window = $3, max_output_tokens = $4, compat = $5::jsonb WHERE id = $1`, f.res.ModelID, config.Limits.ContextModel, config.ContextWindow, RequestMaxTokens, compat); err != nil {
		return err
	}
	if err := exec(`UPDATE model_connections SET base_url = $2 WHERE id = (SELECT connection_id FROM models WHERE id = $1)`, f.res.ModelID, config.Endpoint); err != nil {
		return err
	}
	if err := exec(`UPDATE cost_settings SET currency = $1`, config.Currency); err != nil {
		return err
	}
	if err := exec(`UPDATE model_prices SET price = $2::numeric WHERE model_id = $1 AND unit = 'chat_tokens_in'`, f.res.ModelID, config.Limits.InputPrice); err != nil {
		return err
	}
	if err := exec(`UPDATE model_prices SET price = $2::numeric WHERE model_id = $1 AND unit = 'chat_tokens_out'`, f.res.ModelID, config.Limits.OutputPrice); err != nil {
		return err
	}
	return exec(`UPDATE source_contextual SET max_calls = $2, max_calls_per_day = $2, max_tokens = $3, max_tokens_per_day = $3,
		max_amount = $4::numeric, max_amount_per_day = $4::numeric, currency = $5 WHERE source_id = $1`, f.res.SourceID, calls,
		config.Limits.InputTokens+config.Limits.OutputTokens, config.Limits.Amount, config.Currency)
}
