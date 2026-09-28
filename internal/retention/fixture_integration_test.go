package retention

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/testutil"
)

// fixture is a database with one team, two users and a Sensitive agent
// (rank 1) with a published version, for the retention tests.
type fixture struct {
	t     *testing.T
	ctx   context.Context
	pool  *pgxpool.Pool
	admin authz.Actor
	user  uuid.UUID
	other uuid.UUID
	team  uuid.UUID
	agent uuid.UUID
	// version is the agent's published version (rank 1).
	version uuid.UUID
	// open is a second agent at rank 0.
	open, openVersion uuid.UUID
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	f := &fixture{t: t, ctx: context.Background(), pool: pool}
	adminID := f.newUser("pat@example.edu", "platform_admin")
	f.admin = authz.Actor{UserID: adminID, PlatformRole: authz.PlatformAdmin}
	f.user = f.newUser("sam@example.edu", "none")
	f.other = f.newUser("lee@example.edu", "none")
	f.team = f.id(`INSERT INTO teams (slug, name, max_classification) VALUES ('registrar', 'Registrar', 'restricted') RETURNING id`)
	conn := f.id(`INSERT INTO model_connections (name, base_url) VALUES ('gw', 'http://gw.example.edu/v1') RETURNING id`)
	model := f.id(`INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification)
		VALUES ($1, 'chat', 'chat', 'Chat', 'chat', 'restricted') RETURNING id`, conn)
	f.agent, f.version = f.newAgent("advisor", "Advisor", model, 1)
	f.open, f.openVersion = f.newAgent("helpdesk", "Help desk", model, 0)
	return f
}

func (f *fixture) newUser(email, role string) uuid.UUID {
	return f.id(`INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, platform_role) VALUES ('test', $1, $2, $1, $3) RETURNING id`, email, email, role)
}

func (f *fixture) newAgent(slug, name string, model uuid.UUID, rank int) (agent, version uuid.UUID) {
	agent = f.id(`INSERT INTO agents (team_id, slug, name) VALUES ($1, $2, $3) RETURNING id`, f.team, slug, name)
	version = f.id(`INSERT INTO agent_versions (agent_id, version, config, chat_model_id, effective_rank) VALUES ($1, 1, '{}', $2, $3) RETURNING id`, agent, model, rank)
	f.exec(`UPDATE agents SET published_version_id = $1 WHERE id = $2`, version, agent)
	return agent, version
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

func (f *fixture) count(sql string, args ...any) int64 {
	f.t.Helper()
	var n int64
	if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// conversation adds a conversation with two messages whose last activity
// was idle ago. user uuid.Nil makes it anonymous.
func (f *fixture) conversation(agent, version, user uuid.UUID, idle time.Duration) uuid.UUID {
	f.t.Helper()
	at := time.Now().Add(-idle)
	var id uuid.UUID
	if user == uuid.Nil {
		id = f.id(`INSERT INTO conversations (agent_id, user_id, anonymous, last_version_id, created_at, updated_at)
			VALUES ($1, NULL, true, $2, $3, $3) RETURNING id`, agent, version, at)
	} else {
		id = f.id(`INSERT INTO conversations (agent_id, user_id, last_version_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $4) RETURNING id`, agent, user, version, at)
	}
	f.exec(`INSERT INTO messages (conversation_id, seq, role, content, created_at) VALUES ($1, 1, 'user', '{"text":"q"}', $2), ($1, 2, 'assistant', '[]', $2)`, id, at)
	return id
}

// setPeriods stores platform periods directly (the service is tested separately).
func (f *fixture) setPeriods(periods string) {
	f.exec(`UPDATE retention_settings SET periods = $1::jsonb, revision = revision + 1`, periods)
}

// hold places an active hold directly.
func (f *fixture) hold(scopeType string, scope uuid.UUID, from, to *time.Time) uuid.UUID {
	return f.id(`INSERT INTO legal_holds (scope_type, scope_id, reason, covers_from, covers_to, created_by)
		VALUES ($1, $2, 'Records request 2026-14', $3, $4, $5) RETURNING id`, scopeType, scope, from, to, f.admin.UserID)
}

func (f *fixture) runner() *Runner {
	return &Runner{Pool: f.pool, Env: config.RetentionDefaults(), Log: testutil.Logger()}
}

func (f *fixture) apply(r *Runner, kinds ...Kind) Results {
	f.t.Helper()
	res, err := r.Apply(f.ctx, kinds)
	if err != nil {
		f.t.Fatalf("apply: %v (%v)", err, res)
	}
	return res
}

func (f *fixture) exists(table string, id uuid.UUID) bool {
	return f.count(`SELECT count(*) FROM `+table+` WHERE id = $1`, id) == 1
}

// service is the admin service over the fixture's database.
func (f *fixture) service() *Service {
	return New(f.pool, nil, config.RetentionDefaults(), testutil.Logger())
}
