package gaps_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gaps"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/testutil"
)

// fixture is a database with a team (an owner, an editor and a member), an
// agent published on a knowledge base whose profile embeds with the fake
// gateway's bag-of-words model, the gap service and the topics job with a
// fake label model.
type fixture struct {
	t                     *testing.T
	ctx                   context.Context
	pool                  *pgxpool.Pool
	svc                   *gaps.Service
	runner                *gaps.Runner
	labels                *fakeLabeler
	team, agent, kb       uuid.UUID
	profile, systemOne    uuid.UUID
	cat                   *catalog.Service
	owner, editor, member authz.Actor
	admin                 authz.Actor
	slug                  string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	f := &fixture{t: t, ctx: context.Background(), pool: pool, slug: "registrar", labels: &fakeLabeler{reply: `"Parking permits."`}}
	proxy := testutil.NewFakeProxy(t)
	proxy.AddEmbeddingModel("bow-64", 64)
	proxy.AddChatModel("chat")
	key, _ := secrets.ParseKey("MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=")
	box, err := secrets.New(key)
	if err != nil {
		t.Fatal(err)
	}
	cat := catalog.NewService(pool, box)
	f.admin = authz.Actor{UserID: f.user("admin", "platform_admin"), PlatformRole: authz.PlatformAdmin}
	conn, err := cat.CreateConnection(f.ctx, f.admin, catalog.ConnectionInput{Name: "Proxy", BaseURL: proxy.BaseURL(), APIKey: proxy.APIKey, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	embed := f.id(`INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
		VALUES ($1, 'bow', 'bow-64', 'BoW', 'embedding', 'restricted', 64) RETURNING id`, conn.ID)
	chat := f.id(`INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification)
		VALUES ($1, 'chat', 'chat', 'Chat', 'chat', 'restricted') RETURNING id`, conn.ID)
	f.systemOne = f.id(`INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification)
		VALUES ($1, 's1', 'systemone-1', 'SystemOne', 'systemone', 'restricted') RETURNING id`, conn.ID)
	f.cat = cat
	profile := f.id(`INSERT INTO embedding_profiles (key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
		VALUES ('bow', 'BoW', $1, 64, 'vector', 128, 0) RETURNING id`, embed)
	f.team = f.id(`INSERT INTO teams (slug, name, max_classification) VALUES ('registrar', 'Registrar', 'restricted') RETURNING id`)
	f.profile = profile
	f.kb = f.id(`INSERT INTO knowledge_bases (team_id, name, embedding_profile_id) VALUES ($1, 'Handbook', $2) RETURNING id`, f.team, profile)
	f.agent = f.id(`INSERT INTO agents (team_id, slug, name) VALUES ($1, 'helper', 'Helper') RETURNING id`, f.team)
	version := f.id(`INSERT INTO agent_versions (agent_id, version, config, chat_model_id, effective_rank) VALUES ($1, 1, '{}', $2, 0) RETURNING id`, f.agent, chat)
	f.exec(`INSERT INTO agent_version_kbs (version_id, kb_id) VALUES ($1, $2)`, version, f.kb)
	f.exec(`UPDATE agents SET published_version_id = $1 WHERE id = $2`, version, f.agent)
	f.owner, f.editor, f.member = f.memberAs("owner"), f.memberAs("editor"), f.memberAs("member")
	f.svc = gaps.New(pool, teams.NewService(pool), nil, testutil.Logger())
	f.runner = &gaps.Runner{Pool: pool, Catalog: cat, Log: testutil.Logger(), NewProvider: func(*gateway.Client) llm.Provider { return f.labels }}
	return f
}

func (f *fixture) id(sql string, args ...any) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) count(sql string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (f *fixture) user(name, role string) uuid.UUID {
	return f.id(`INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, platform_role) VALUES ('test', $1, $2, $1, $3) RETURNING id`,
		name, name+"@example.edu", role)
}

func (f *fixture) memberAs(role string) authz.Actor {
	id := f.user(role, "none")
	f.exec(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)`, f.team, id, role)
	return authz.Actor{UserID: id}
}

// ask stores a conversation of a new person whose answer failed with the
// signals, and returns the conversation (the question has no vector yet,
// as after a thumbs-down or in tool mode).
func (f *fixture) ask(asker, question string, shared bool, signals ...string) uuid.UUID {
	f.t.Helper()
	user := f.user(asker+"-"+uuid.NewString()[:8], "none")
	conv := f.id(`INSERT INTO conversations (agent_id, user_id, title) VALUES ($1, $2, 'Chat') RETURNING id`, f.agent, user)
	f.exec(`INSERT INTO messages (conversation_id, seq, role, content) VALUES ($1, 1, 'user', jsonb_build_object('text', $2::text))`, conv, question)
	msg := f.id(`INSERT INTO messages (conversation_id, seq, role, content) VALUES ($1, 2, 'assistant', '[]') RETURNING id`, conv)
	f.exec(`INSERT INTO gap_questions (team_id, agent_id, conversation_id, message_id, question, signals, asker_key, shared)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, f.team, f.agent, conv, msg, question, signals, asker, shared)
	return conv
}

func (f *fixture) run() gaps.Summary {
	f.t.Helper()
	sum, err := f.runner.Run(f.ctx)
	if err != nil {
		f.t.Fatalf("run: %v", err)
	}
	return sum
}

// fakeLabeler is the chat model writing labels: it records the requests.
type fakeLabeler struct {
	mu       sync.Mutex
	reply    string
	requests []llm.Context
}

func (p *fakeLabeler) Stream(_ context.Context, model llm.Model, c llm.Context, _ llm.Options) <-chan llm.Event {
	p.mu.Lock()
	p.requests = append(p.requests, c)
	p.mu.Unlock()
	ch := make(chan llm.Event, 1)
	ch <- llm.Event{Type: llm.EventDone, Reason: llm.StopReasonStop, Message: llm.AssistantMessage{Model: model.ID,
		Content: []llm.Block{llm.Text{Text: p.reply}}, Usage: llm.Usage{Input: 40, Output: 4, Total: 44}, StopReason: llm.StopReasonStop}}
	close(ch)
	return ch
}

func (p *fakeLabeler) sent() []llm.Context {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]llm.Context(nil), p.requests...)
}

// userText is a request's only user message.
func userText(c llm.Context) string {
	var b strings.Builder
	for _, m := range c.Messages {
		if u, ok := m.(llm.UserMessage); ok {
			b.WriteString(u.Content)
		}
	}
	return b.String()
}
