package contenthealth

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/testutil"
)

// fixture is a database with two teams (A and B), each with an owner, and A also with an editor, an admin and a member; a
// platform admin and auditor who are in no team; and the report service. The platform switch is on.
type fixture struct {
	t       *testing.T
	ctx     context.Context
	pool    *pgxpool.Pool
	svc     *Service
	profile uuid.UUID

	teamA, teamB uuid.UUID
	slugA, slugB string

	ownerA, adminA, editorA, memberA authz.Actor
	ownerB                           authz.Actor
	platformAdmin, auditor           authz.Actor
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	f := &fixture{t: t, ctx: context.Background(), pool: pool, slugA: "registrar", slugB: "library"}
	conn, model := uuid.New(), uuid.New()
	f.exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, conn)
	f.exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, model, conn)
	f.profile = f.id(`INSERT INTO embedding_profiles (key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ('p', 'P', $1, 4, 'halfvec', 512, 0) RETURNING id`, model)
	f.teamA = f.id(`INSERT INTO teams (slug, name, max_classification) VALUES ($1, 'Registrar', 'restricted') RETURNING id`, f.slugA)
	f.teamB = f.id(`INSERT INTO teams (slug, name, max_classification) VALUES ($1, 'Library', 'restricted') RETURNING id`, f.slugB)
	f.ownerA, f.adminA = f.person("owner-a", f.teamA, "owner"), f.person("admin-a", f.teamA, "admin")
	f.editorA, f.memberA = f.person("editor-a", f.teamA, "editor"), f.person("member-a", f.teamA, "member")
	f.ownerB = f.person("owner-b", f.teamB, "owner")
	f.platformAdmin = authz.Actor{UserID: f.user("platform-admin", "platform_admin"), PlatformRole: authz.PlatformAdmin}
	f.auditor = authz.Actor{UserID: f.user("auditor", "platform_auditor"), PlatformRole: authz.PlatformAuditor}
	f.svc = New(pool, teams.NewService(pool), nil, testutil.Logger())
	f.svc.Cooldown = -1 // no pause between reports, except in the test about it
	f.exec(`UPDATE content_health_settings SET enabled = true`)
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

func (f *fixture) user(name, platformRole string) uuid.UUID {
	return f.id(`INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, platform_role) VALUES ('test', $1, $2, $1, $3) RETURNING id`,
		name, name+"@example.edu", platformRole)
}

func (f *fixture) person(name string, team uuid.UUID, role string) authz.Actor {
	id := f.user(name, "none")
	f.exec(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)`, team, id, role)
	return authz.Actor{UserID: id}
}

// source adds a source of the given type to a team; team uuid.Nil makes a platform-shared one.
func (f *fixture) source(team uuid.UUID, name, typ string) uuid.UUID {
	f.t.Helper()
	var owner any
	if team != uuid.Nil {
		owner = team
	}
	return f.id(`INSERT INTO data_sources (team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, $3, 'open', $4) RETURNING id`,
		owner, name, typ, f.profile)
}

// doc is a document to insert; the zero value is a ready document processed and created long ago, with its own hash.
type doc struct {
	status    string
	sha       string
	processed *time.Time // nil: not set (use noDate)
	noDate    bool
	noHash    bool
	created   time.Time
	updated   time.Time
	errCode   string
	waiting   *time.Time
	title     string
}

func (f *fixture) addDoc(team, src uuid.UUID, d doc) uuid.UUID {
	f.t.Helper()
	if d.status == "" {
		d.status = "ready"
	}
	ext := "d-" + uuid.NewString()
	if d.sha == "" && !d.noHash {
		d.sha = "sha-" + ext
	}
	if d.created.IsZero() {
		d.created = time.Now().AddDate(-5, 0, 0)
	}
	if d.updated.IsZero() {
		d.updated = d.created
	}
	var processed any
	switch {
	case d.noDate:
	case d.processed != nil:
		processed = *d.processed
	default:
		processed = d.created
	}
	var owner any
	if team != uuid.Nil {
		owner = team
	}
	return f.id(`INSERT INTO documents (source_id, team_id, external_id, title, status, sha256, processed_at, created_at, updated_at, error_code, waiting_until)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
		src, owner, ext, d.title, d.status, d.sha, processed, d.created, d.updated, d.errCode, d.waiting)
}

func at(t time.Time) *time.Time { return &t }

// report inserts a running report of team with the thresholds and scope, ready for collect.
func (f *fixture) report(team uuid.UUID, staleDays, window int, source, kb *uuid.UUID) dbgen.ContentHealthReport {
	f.t.Helper()
	rep, err := f.svc.q.InsertContentHealthReport(f.ctx, dbgen.InsertContentHealthReportParams{
		TeamID: team, ScopeSourceID: optID(source), ScopeKbID: optID(kb), StaleDays: int32(staleDays), CitationWindowDays: int32(window),
	})
	if err != nil {
		f.t.Fatal(err)
	}
	rep, err = f.svc.q.StartContentHealthReport(f.ctx, rep.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	return rep
}

// results is a collected report by signal.
type results struct {
	out *outcome
}

func (r results) signal(name string) storedSignal {
	for _, s := range r.out.signals {
		if s.Signal == name {
			return s
		}
	}
	panic("no signal " + name)
}

func (r results) findings(name string) []Finding { return r.out.findings[name] }

func (r results) coverage(src uuid.UUID) *Coverage {
	for _, c := range r.out.coverage {
		if c.SourceID == src {
			return c
		}
	}
	return nil
}

// collect measures team's scope from asOf without storing anything.
func (f *fixture) collect(team uuid.UUID, asOf time.Time, staleDays, window int, source, kb *uuid.UUID) results {
	f.t.Helper()
	rep := f.report(team, staleDays, window, source, kb)
	out, err := f.svc.collect(f.ctx, rep, asOf)
	if err != nil {
		f.t.Fatal(err)
	}
	f.exec(`UPDATE content_health_reports SET status = 'cancelled' WHERE id = $1`, rep.ID) // free the team's one active report
	return results{out}
}

// agent adds an agent to a team, for answer events.
func (f *fixture) agent(team uuid.UUID) uuid.UUID {
	return f.id(`INSERT INTO agents (team_id, slug, name) VALUES ($1, $2, 'Helper') RETURNING id`, team, fmt.Sprintf("helper-%d", time.Now().UnixNano()))
}

// answers adds n answer events of the agent at time t, each citing the documents, on the channel.
func (f *fixture) answers(team, agent uuid.UUID, n int, t time.Time, channel string, cited ...uuid.UUID) {
	f.t.Helper()
	if cited == nil {
		cited = []uuid.UUID{}
	}
	f.exec(`INSERT INTO message_events (team_id, agent_id, channel, audience_type, created_at, cited_document_ids)
		SELECT $1, $2, $3, 'team', $4, $5 FROM generate_series(1, $6)`, team, agent, channel, t, cited, n)
}

func ids(fs []Finding) []uuid.UUID {
	out := make([]uuid.UUID, len(fs))
	for i, f := range fs {
		out[i] = f.DocumentID
	}
	return out
}

func contains(list []uuid.UUID, id uuid.UUID) bool {
	for _, x := range list {
		if x == id {
			return true
		}
	}
	return false
}
