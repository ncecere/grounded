package store_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

// Migration 00055 adds approved_classification and nothing else (#195): no UPDATE of existing rows, so its ACCESS EXCLUSIVE lock is not
// held across a scan of team_requests and audit_log. The level of a request approved before it (or by a previous release's pod running next
// to this release, which never writes the column) is resolved when the request is read, so no row needs repair.

type requestFixture struct {
	pool      *pgxpool.Pool
	requester uuid.UUID
}

func newRequestFixture(t *testing.T, pool *pgxpool.Pool) requestFixture {
	t.Helper()
	f := requestFixture{pool: pool}
	if err := pool.QueryRow(context.Background(), `INSERT INTO users (oidc_issuer, oidc_subject, email) VALUES ('i', 's-'||gen_random_uuid(), 'asker@example.edu') RETURNING id`).Scan(&f.requester); err != nil {
		t.Fatal(err)
	}
	return f
}

// team makes a team whose maximum classification is level.
func (f requestFixture) team(t *testing.T, level string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.pool.QueryRow(context.Background(), `INSERT INTO teams (slug, name, max_classification) VALUES ('t-'||substr(gen_random_uuid()::text, 1, 8), 'Team', $1) RETURNING id`, level).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// request inserts a request as a previous release's code leaves it after an approval: the status and team set, the new column not written.
func (f requestFixture) request(t *testing.T, status, asked, column string, team *uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	decided := "NULL"
	if status == "approved" || status == "declined" {
		decided = "now()"
	}
	q := fmt.Sprintf(`INSERT INTO team_requests (requester_id, name, purpose, classification, status, team_id, decided_at, approved_classification)
		VALUES ($1, 'Library tech', 'Run it.', $2, $3, $4, %s, $5) RETURNING id`, decided)
	if err := f.pool.QueryRow(context.Background(), q, f.requester, asked, status, team, column).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// audit records an entry as an approval writes it.
func (f requestFixture) audit(t *testing.T, targetType, action string, id uuid.UUID, state string) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO audit_log (actor_kind, action, target_type, target_id, after_state) VALUES ('user', $1, $2, $3, $4::jsonb)`,
		action, targetType, id.String(), state); err != nil {
		t.Fatal(err)
	}
}

func TestMigration00055WritesNoRows(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 54); err != nil {
		t.Fatalf("down to 54: %v", err)
	}
	f := newRequestFixture(t, pool)
	team := f.team(t, "sensitive")
	id := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO team_requests (id, requester_id, name, purpose, classification, status, team_id, decided_at)
		VALUES ($1, $2, 'Library tech', 'Run it.', 'open', 'approved', $3, now())`, id, f.requester, team); err != nil {
		t.Fatal(err)
	}
	f.audit(t, "team_request", "team_request.approve", id, `{"classification": "sensitive"}`)
	var before string
	if err := pool.QueryRow(ctx, `SELECT xmin::text FROM team_requests WHERE id = $1`, id).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 55); err != nil {
		t.Fatalf("up to 55: %v", err)
	}
	var after, column string
	if err := pool.QueryRow(ctx, `SELECT xmin::text, approved_classification FROM team_requests WHERE id = $1`, id).Scan(&after, &column); err != nil {
		t.Fatal(err)
	}
	// An UPDATE (the old backfill) gives the row a new transaction ID and a value; a metadata-only ADD COLUMN does neither.
	if after != before || column != "" {
		t.Errorf("the migration touched the row: xmin %s -> %s, approved_classification %q", before, after, column)
	}
	// And the row still reads correctly: from the audit log, which the reader resolves.
	row, err := dbgen.New(pool).GetTeamRequest(ctx, id)
	if err != nil || row.ApprovedLevel != "sensitive" {
		t.Errorf("approved level = %q, %v; want sensitive from the audit log", row.ApprovedLevel, err)
	}
}

// The level of an approval is what the approval recorded, whichever release made it (#195, #140).
func TestApprovedLevelResolvesLegacyRows(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	q := dbgen.New(pool)
	f := newRequestFixture(t, pool)
	sensitive := f.team(t, "sensitive")

	// Approved by a previous release's pod (column empty), the reviewer raised open to restricted: the audit entry has it, not the team's level.
	changed := f.request(t, "approved", "open", "", &sensitive)
	f.audit(t, "team_request", "team_request.approve", changed, `{"classification": "restricted", "slug": "x"}`)
	// Entries that are not this approval must not be read: another request's, another target type with the same ID, another action, and
	// an older approve entry (the newest wins).
	f.audit(t, "team_request", "team_request.approve", uuid.New(), `{"classification": "open"}`)
	f.audit(t, "team", "team_request.approve", changed, `{"classification": "open"}`)
	f.audit(t, "team_request", "team_request.create", changed, `{"classification": "open"}`)
	// No audit entry (purged, or never written): the team's level now, else the level asked for.
	noAudit := f.request(t, "approved", "open", "", &sensitive)
	noTeam := f.request(t, "approved", "open", "", nil)
	// An entry without a level does not hide the team's.
	blank := f.request(t, "approved", "open", "", &sensitive)
	f.audit(t, "team_request", "team_request.approve", blank, `{"name": "x"}`)
	// Written by this release: the column wins over everything.
	written := f.request(t, "approved", "open", "restricted", &sensitive)
	f.audit(t, "team_request", "team_request.approve", written, `{"classification": "sensitive"}`)
	// Not approved: no approved level, whatever the column or the log say.
	pending := f.request(t, "pending", "open", "", nil)
	declined := f.request(t, "declined", "open", "", nil)
	f.audit(t, "team_request", "team_request.approve", declined, `{"classification": "sensitive"}`)

	want := map[uuid.UUID]string{changed: "restricted", noAudit: "sensitive", noTeam: "open", blank: "sensitive", written: "restricted", pending: "", declined: ""}
	for id, level := range want {
		got, err := q.GetTeamRequest(ctx, id)
		if err != nil || got.ApprovedLevel != level {
			t.Errorf("GetTeamRequest %s: approved level %q, %v; want %q", id, got.ApprovedLevel, err, level)
		}
	}
	admin, err := q.ListTeamRequestsAdmin(ctx, nil)
	if err != nil || len(admin) != len(want) {
		t.Fatalf("admin list = %d, %v", len(admin), err)
	}
	for _, r := range admin {
		if r.ApprovedLevel != want[r.ID] {
			t.Errorf("ListTeamRequestsAdmin %s: %q, want %q", r.ID, r.ApprovedLevel, want[r.ID])
		}
	}
	mine, err := q.ListMyTeamRequests(ctx, f.requester)
	if err != nil || len(mine) != len(want) {
		t.Fatalf("own list = %d, %v", len(mine), err)
	}
	for _, r := range mine {
		if r.ApprovedLevel != want[r.ID] {
			t.Errorf("ListMyTeamRequests %s: %q, want %q", r.ID, r.ApprovedLevel, want[r.ID])
		}
	}
}

// The lookup that replaces the backfill must use audit_log_target_idx (target_type, target_id, id DESC): without target_type in the
// predicate the index cannot be searched by target_id (it is not its first column), and a large audit log is scanned per request.
func TestApprovedLevelLookupUsesTheAuditTargetIndex(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	for i := 0; i < 3000; i++ {
		if _, err := pool.Exec(ctx, `INSERT INTO audit_log (actor_kind, action, target_type, target_id, after_state)
			VALUES ('user', 'team_request.approve', CASE WHEN $1 % 2 = 0 THEN 'team_request' ELSE 'agent' END, gen_random_uuid()::text, '{"classification": "open"}')`, i); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `ANALYZE audit_log`); err != nil {
		t.Fatal(err)
	}
	src, err := os.ReadFile("queries/team_requests.sql")
	if err != nil {
		t.Fatal(err)
	}
	// The real query text, as sqlc compiles it ($1 is the request's ID).
	text := string(src)
	start := strings.Index(text, "-- name: GetTeamRequest :one")
	end := strings.Index(text[start:], ";")
	if start < 0 || end < 0 {
		t.Fatal("GetTeamRequest not found in queries/team_requests.sql")
	}
	query := text[start+len("-- name: GetTeamRequest :one") : start+end]
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "PREPARE approved_level_lookup (uuid) AS "+query); err != nil {
		t.Fatal(err)
	}
	rows, err := conn.Query(ctx, "EXPLAIN (COSTS OFF) EXECUTE approved_level_lookup ('00000000-0000-4000-8000-000000000000')")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line + "\n")
	}
	got := plan.String()
	if !strings.Contains(got, "audit_log_target_idx") || !strings.Contains(got, "target_type = 'team_request'") || !strings.Contains(got, "target_id = ") {
		t.Errorf("the audit lookup does not search audit_log_target_idx by target_type and target_id:\n%s", got)
	}
	if strings.Contains(got, "Seq Scan on audit_log") {
		t.Errorf("the audit lookup scans the whole audit log:\n%s", got)
	}
}
