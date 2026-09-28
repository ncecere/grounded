package retention

import (
	"bytes"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/blob"
)

const day = 24 * time.Hour

// Nothing is deleted by default: without periods only anonymous
// conversations (24 h) and expired anonymous sessions go (DESIGN.md §8).
func TestDefaultsKeepEverything(t *testing.T) {
	f := newFixture(t)
	signed := f.conversation(f.agent, f.version, f.user, 3000*day)
	deleted := f.conversation(f.agent, f.version, f.user, 3000*day)
	f.exec(`UPDATE conversations SET deleted_at = now() - interval '3000 days' WHERE id = $1`, deleted)
	f.exec(`INSERT INTO access_log (user_id, agent_id, rank, channel, at) VALUES ($1, $2, 1, 'ui', now() - interval '3000 days')`, f.user, f.agent)
	f.exec(`INSERT INTO usage_events (kind, quantity, team_id, occurred_at) VALUES ('query', 1, $1, now() - interval '3000 days')`, f.team)
	f.exec(`INSERT INTO audit_log (actor_kind, action, target_type, occurred_at) VALUES ('system', 'test.old', 'team', now() - interval '3000 days')`)
	anon := f.conversation(f.agent, f.version, uuid.Nil, 25*time.Hour)

	res := f.apply(f.runner())
	for _, k := range []Kind{DeletedConversations, AccessLog, AnalyticsEvents, UsageEvents, AuditLog, DeletedFiles, ExpiredInvites} {
		if !res[k].Kept || res[k].Deleted != 0 {
			t.Errorf("%s = %+v, want kept", k, res[k])
		}
	}
	if res[Conversations].Deleted != 1 || f.exists("conversations", anon) {
		t.Fatalf("anonymous = %+v", res[Conversations])
	}
	if !f.exists("conversations", signed) || !f.exists("conversations", deleted) {
		t.Fatal("signed-in conversations deleted without a period")
	}
	if f.count(`SELECT count(*) FROM access_log`)+f.count(`SELECT count(*) FROM usage_events`) != 2 ||
		f.count(`SELECT count(*) FROM audit_log WHERE action = 'test.old'`) != 1 {
		t.Fatal("logs deleted without a period")
	}
}

// Conversations follow their level (signed-in days, anonymous hours) and
// audience; the dry run counts per team, level and audience and writes
// nothing; the run deletes exactly what it showed, messages included.
func TestConversationsPerLevelAndDryRun(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE classification_levels SET conversation_retention_days = 30 WHERE key = 'sensitive'`)
	f.exec(`UPDATE classification_levels SET anonymous_retention_hours = 48 WHERE key = 'sensitive'`)
	oldSigned := f.conversation(f.agent, f.version, f.user, 31*day)
	newSigned := f.conversation(f.agent, f.version, f.user, 29*day)
	oldAnon := f.conversation(f.agent, f.version, uuid.Nil, 49*time.Hour)
	newAnon := f.conversation(f.agent, f.version, uuid.Nil, 47*time.Hour)
	openSigned := f.conversation(f.open, f.openVersion, f.user, 400*day) // Open keeps signed-in conversations
	openAnon := f.conversation(f.open, f.openVersion, uuid.Nil, 25*time.Hour)

	rep, err := f.service().Report(f.ctx, f.admin)
	if err != nil {
		t.Fatal(err)
	}
	conv := rep.Kinds[0]
	if conv.Kind != Conversations || conv.Due != 3 || conv.Held != 0 {
		t.Fatalf("report = %+v", conv)
	}
	got := map[string]int64{}
	for _, g := range conv.Groups {
		if g.TeamName != "Registrar" || g.Level == nil || g.Reason != "retention" {
			t.Fatalf("group = %+v", g)
		}
		got[g.Level.Key+"/"+g.Audience] += g.Due
	}
	if got["sensitive/signed_in"] != 1 || got["sensitive/anonymous"] != 1 || got["open/anonymous"] != 1 || len(got) != 3 {
		t.Fatalf("groups = %v", got)
	}
	if f.count(`SELECT count(*) FROM conversations`) != 6 || f.count(`SELECT count(*) FROM retention_runs`) != 0 {
		t.Fatal("the dry run wrote something")
	}

	res := f.apply(f.runner(), Conversations)
	if res[Conversations].Deleted != 3 {
		t.Fatalf("deleted = %+v", res)
	}
	for id, want := range map[uuid.UUID]bool{oldSigned: false, newSigned: true, oldAnon: false, newAnon: true, openSigned: true, openAnon: false} {
		if f.exists("conversations", id) != want {
			t.Errorf("conversation %s exists = %v, want %v", id, !want, want)
		}
	}
	if n := f.count(`SELECT count(*) FROM messages WHERE conversation_id = $1`, oldSigned); n != 0 {
		t.Errorf("messages kept = %d", n)
	}
	// Idempotent: nothing more is due.
	if res := f.apply(f.runner(), Conversations); res[Conversations].Deleted != 0 {
		t.Fatalf("second run = %+v", res)
	}
}

// Batches are bounded: Batch rows per transaction and MaxBatches per run,
// so a backlog is worked off over several runs.
func TestBoundedBatches(t *testing.T) {
	f := newFixture(t)
	for range 5 {
		f.conversation(f.open, f.openVersion, uuid.Nil, 25*time.Hour)
	}
	r := f.runner()
	r.Batch, r.MaxBatches = 2, 2
	if res := f.apply(r, Conversations); res[Conversations].Deleted != 4 {
		t.Fatalf("first run = %+v", res)
	}
	if res := f.apply(r, Conversations); res[Conversations].Deleted != 1 {
		t.Fatalf("second run = %+v", res)
	}
}

// Logs and events: each kind's period applies; usage is rolled up per day
// first so totals survive; legal hold audit entries are never purged; the
// audit trigger still refuses deletes outside retention.
func TestLogsEventsAndAudit(t *testing.T) {
	f := newFixture(t)
	f.setPeriods(`{"access_log": 30, "analytics_events": 30, "usage_events": 30, "audit_log": 365, "expired_invites": 10}`)
	f.exec(`INSERT INTO access_log (user_id, agent_id, rank, channel, at) VALUES ($1, $2, 1, 'ui', now() - interval '31 days'), ($1, $2, 1, 'ui', now() - interval '1 day')`, f.user, f.agent)
	f.exec(`INSERT INTO message_events (team_id, agent_id, channel, audience_type, created_at) VALUES ($1, $2, 'ui', 'team', now() - interval '31 days'), ($1, $2, 'ui', 'team', now())`, f.team, f.agent)
	f.exec(`INSERT INTO usage_events (kind, quantity, team_id, agent_id, occurred_at) VALUES
		('chat_tokens_in', 10, $1, $2, '2026-01-05 10:00Z'), ('chat_tokens_in', 5, $1, $2, '2026-01-05 23:00Z'),
		('chat_tokens_in', 7, $1, $2, '2026-01-06 01:00Z'), ('query', 1, $1, $2, now())`, f.team, f.agent)
	f.exec(`INSERT INTO audit_log (actor_kind, action, target_type, occurred_at) VALUES
		('system', 'test.old', 'team', now() - interval '400 days'), ('system', 'legal_hold.create', 'legal_hold', now() - interval '400 days'),
		('system', 'test.new', 'team', now())`)
	f.exec(`INSERT INTO team_invites (team_id, email, role, expires_at, revoked_at) VALUES
		($1, 'a@example.edu', 'member', now() - interval '11 days', NULL), ($1, 'b@example.edu', 'member', now() + interval '1 day', now() - interval '12 days'),
		($1, 'c@example.edu', 'member', now() - interval '5 days', NULL)`, f.team)

	res := f.apply(f.runner())
	want := map[Kind]int64{AccessLog: 1, AnalyticsEvents: 1, UsageEvents: 3, AuditLog: 1, ExpiredInvites: 2}
	for k, n := range want {
		if res[k].Deleted != n {
			t.Errorf("%s deleted %d, want %d", k, res[k].Deleted, n)
		}
	}
	var q5, q6, ev int64
	if err := f.pool.QueryRow(f.ctx, `SELECT
		(SELECT quantity FROM usage_daily WHERE day = '2026-01-05' AND kind = 'chat_tokens_in' AND team_id = $1),
		(SELECT quantity FROM usage_daily WHERE day = '2026-01-06' AND kind = 'chat_tokens_in' AND team_id = $1),
		(SELECT sum(events) FROM usage_daily)`, f.team).Scan(&q5, &q6, &ev); err != nil || q5 != 15 || q6 != 7 || ev != 3 {
		t.Fatalf("roll-ups = %d %d %d (%v)", q5, q6, ev, err)
	}
	if f.count(`SELECT count(*) FROM audit_log WHERE action IN ('legal_hold.create', 'test.new')`) != 2 {
		t.Fatal("kept audit entries were deleted")
	}
	if _, err := f.pool.Exec(f.ctx, `DELETE FROM audit_log WHERE action = 'test.new'`); err == nil {
		t.Fatal("audit log deletable outside retention")
	}
	if f.count(`SELECT count(*) FROM team_invites`) != 1 {
		t.Fatal("wrong invites deleted")
	}
}

// Deleted documents' files: removed from storage after the grace period,
// unless a hold on the team keeps them.
func TestDeletedFiles(t *testing.T) {
	f := newFixture(t)
	store, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	src := uuid.New()
	put := func(key string) {
		if err := store.Put(f.ctx, key, bytes.NewReader([]byte("x")), 1, "text/plain"); err != nil {
			t.Fatal(err)
		}
	}
	gone := "teams/" + f.team.String() + "/sources/" + src.String() + "/docs/" + uuid.NewString() + "/"
	put(gone + "v1/original")
	other := uuid.New()
	kept := "teams/" + other.String() + "/sources/" + src.String() + "/"
	put(kept + "docs/d/v1/original")
	for _, row := range []struct {
		team   uuid.UUID
		prefix string
	}{{f.team, gone}, {other, kept}} {
		f.exec(`INSERT INTO deleted_files (team_id, source_id, prefix, content_from, deleted_at) VALUES ($1, $2, $3, now() - interval '9 days', now() - interval '2 days')`, row.team, src, row.prefix)
	}
	f.hold("team", other, nil, nil)
	f.setPeriods(`{"deleted_files": 1}`)
	r := f.runner()
	r.Blob = store
	res := f.apply(r, DeletedFiles)
	if res[DeletedFiles].Deleted != 1 || res[DeletedFiles].Held != 1 {
		t.Fatalf("files = %+v", res[DeletedFiles])
	}
	if _, err := store.Get(f.ctx, gone+"v1/original"); err == nil {
		t.Error("deleted document's file is still stored")
	}
	if rc, err := store.Get(f.ctx, kept+"docs/d/v1/original"); err != nil {
		t.Errorf("held file removed: %v", err)
	} else {
		_ = rc.Close()
	}
	if f.count(`SELECT count(*) FROM deleted_files`) != 1 {
		t.Fatal("records not cleaned up")
	}
	// Without an object store the kind fails (and is reported), the rest runs.
	f.exec(`UPDATE legal_holds SET released_at = now(), released_by = created_by`)
	res, err = f.runner().Apply(f.ctx, nil)
	if err == nil || res[DeletedFiles].Error == "" || res[Conversations].Error != "" {
		t.Fatalf("no store = %v %+v", err, res)
	}
}
