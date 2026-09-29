package costs

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/testutil"
)

type fixture struct {
	t                  *testing.T
	ctx                context.Context
	pool               *pgxpool.Pool
	svc                *Service
	admin              authz.Actor
	team               uuid.UUID
	chat, embed, modID uuid.UUID
	now                time.Time
	mu                 sync.Mutex
	notices            []Notice
	changes            []uuid.NullUUID
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	f := &fixture{t: t, ctx: context.Background(), pool: pool, now: time.Date(2026, 9, 28, 10, 5, 0, 0, time.UTC)}
	adminID := f.id(`INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, platform_role) VALUES ('test', 'admin', 'admin@example.edu', 'Admin', 'platform_admin') RETURNING id`)
	f.admin = authz.Actor{UserID: adminID, PlatformRole: authz.PlatformAdmin}
	f.team = f.id(`INSERT INTO teams (slug, name, max_classification) VALUES ('registrar', 'Registrar', 'open') RETURNING id`)
	conn := f.id(`INSERT INTO model_connections (name, base_url) VALUES ('gw', 'http://gw.example.edu/v1') RETURNING id`)
	model := func(key, kind string) uuid.UUID {
		var dims *int32
		if kind == "embedding" {
			d := int32(768)
			dims = &d
		}
		return f.id(`INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
			VALUES ($1, $2, $2, $2, $3, 'restricted', $4) RETURNING id`, conn, key, kind, dims)
	}
	f.chat, f.embed, f.modID = model("chat-a", "chat"), model("embed-a", "embedding"), model("mod-a", "moderation")
	f.svc = New(pool, teams.NewService(pool), testutil.Logger())
	f.svc.Now = func() time.Time { f.mu.Lock(); defer f.mu.Unlock(); return f.now }
	f.svc.OnNotice = func(_ context.Context, _ pgx.Tx, n Notice) error {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.notices = append(f.notices, n)
		return nil
	}
	f.svc.OnChange = func(_ context.Context, team uuid.NullUUID) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.changes = append(f.changes, team)
	}
	return f
}

func (f *fixture) id(query string, args ...any) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.pool.QueryRow(f.ctx, query, args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", query, err)
	}
	return id
}

func (f *fixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(f.ctx, query, args...); err != nil {
		f.t.Fatalf("%s: %v", query, err)
	}
}

func (f *fixture) setClock(at string) {
	t, err := time.Parse(time.RFC3339, at)
	if err != nil {
		f.t.Fatal(err)
	}
	f.mu.Lock()
	f.now = t
	f.mu.Unlock()
}

func (f *fixture) event(kind string, qty int64, model uuid.UUID, at string) {
	f.exec(`INSERT INTO usage_events (kind, quantity, team_id, model_id, occurred_at, metadata) VALUES ($1, $2, $3, $4, $5, '{"channel":"ui"}')`,
		kind, qty, f.team, model, at)
}

func (f *fixture) settings(mode, tz string) {
	f.t.Helper()
	cur, err := f.svc.Settings(f.ctx, f.admin)
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err := f.svc.UpdateSettings(f.ctx, f.admin, SettingsInput{Mode: mode, Currency: "USD", TimeZone: tz, WarnPercent: 80}, cur.Revision); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) spent() string {
	f.t.Helper()
	st, err := f.svc.status(f.ctx, f.team, true)
	if err != nil {
		f.t.Fatal(err)
	}
	return Format(st.Spent)
}

func (f *fixture) rollup() time.Time {
	f.t.Helper()
	w, err := f.svc.Rollup(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	return w
}

// The rollup: hours are rolled once, after their grace; the first run
// backfills events and purged days (usage_daily); the open hours are read
// live; the retention purge in between never double counts.
func TestRollupBackfillAndRetention(t *testing.T) {
	f := newFixture(t)
	f.settings(ModeTrack, "UTC")
	if _, err := f.svc.AddPrices(f.ctx, f.admin, f.chat, day("2026-09-01"), []PriceInput{{Unit: UnitChatIn, Price: "2"}}); err != nil {
		t.Fatal(err)
	}
	// Purged before E2 existed: only in usage_daily.
	f.exec(`INSERT INTO usage_daily (day, kind, team_id, model_id, channel, quantity, events) VALUES ('2026-09-01', 'chat_tokens_in', $1, $2, 'ui', 1000000, 3)`,
		f.team, f.chat)
	f.event(UnitChatIn, 1_000_000, f.chat, "2026-09-02T10:15:00Z")
	f.event(UnitChatIn, 500_000, f.chat, "2026-09-28T09:05:00Z") // the hour closes at 10:00, rolled from 10:10
	f.event(UnitEmbed, 1000, f.embed, "2026-09-10T00:00:00Z")    // unpriced
	f.event("query", 1, uuid.Nil, "2026-09-10T00:00:00Z")

	if got := f.spent(); got != "3.000000" {
		t.Fatalf("before the first rollup spent = %s, want 3 (events only)", got)
	}
	if w := f.rollup(); w.Format(time.RFC3339) != "2026-09-28T09:00:00Z" {
		t.Fatalf("watermark = %s", w)
	}
	if got := f.spent(); got != "5.000000" {
		t.Fatalf("after the backfill spent = %s, want 5 (1M purged + 1.5M events at 2 per million)", got)
	}
	if w := f.rollup(); w.Format(time.RFC3339) != "2026-09-28T09:00:00Z" {
		t.Fatalf("second run watermark = %s", w)
	}
	var hours int
	_ = f.pool.QueryRow(f.ctx, `SELECT count(*) FROM usage_rollup WHERE hour = '2026-09-01T00:00:00Z' AND quantity = 1000000 AND events = 3`).Scan(&hours)
	if hours != 1 {
		t.Fatal("the purged day was not put in its first hour")
	}

	rep, err := f.svc.Report(f.ctx, f.admin, ReportFilter{From: day("2026-09-01"), To: day("2026-09-30"), GroupBy: ByDay})
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Rows) != 30 || Format(rep.Total.Spend) != "5.000000" || !rep.Total.Unpriced || Format(rep.Rows[0].Spend) != "2.000000" ||
		Format(rep.Rows[27].Spend) != "1.000000" || !rep.Rows[9].Unpriced {
		t.Fatalf("report by day = %+v rows, total %s", len(rep.Rows), Format(rep.Total.Spend))
	}

	// Retention purges events of rolled hours (into usage_daily only) and of
	// an open hour (also into usage_rollup): spend doesn't change.
	f.event(UnitChatIn, 250_000, f.chat, "2026-09-28T09:30:00Z")
	f.exec(`UPDATE retention_settings SET periods = '{"usage_events": 1}'::jsonb, revision = revision + 1`)
	r := &retention.Runner{Pool: f.pool, Env: config.RetentionDefaults(), Log: testutil.Logger(),
		Now: func() time.Time { return time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC) }}
	res, err := r.Apply(f.ctx, []retention.Kind{retention.UsageEvents})
	if err != nil || res[retention.UsageEvents].Deleted != 5 {
		t.Fatalf("purge = %+v %v", res, err)
	}
	if got := f.spent(); got != "5.500000" {
		t.Fatalf("after the purge spent = %s, want 5.5", got)
	}
	f.setClock("2026-09-28T11:15:00Z")
	if w := f.rollup(); w.Format(time.RFC3339) != "2026-09-28T11:00:00Z" {
		t.Fatalf("watermark = %s", w)
	}
	if got := f.spent(); got != "5.500000" {
		t.Fatalf("after rolling the purged hour spent = %s, want 5.5 (no double counting)", got)
	}

	// Groupings.
	for _, g := range []string{ByTeam, ByModel, ByAgent} {
		rep, err := f.svc.Report(f.ctx, f.admin, ReportFilter{From: day("2026-09-01"), To: day("2026-09-30"), GroupBy: g})
		if err != nil || Format(rep.Total.Spend) != "5.500000" {
			t.Fatalf("report by %s = %v %v", g, rep.Total, err)
		}
		switch g {
		case ByTeam:
			if len(rep.Rows) != 1 || rep.Rows[0].Label != "Registrar" || rep.Rows[0].TeamSlug != "registrar" {
				t.Errorf("by team = %+v", rep.Rows)
			}
		case ByModel:
			if len(rep.Rows) != 2 || rep.Rows[0].Label != "chat-a" || rep.Rows[0].ModelKind != "chat" || !rep.Rows[1].Unpriced || rep.Rows[0].Unpriced {
				t.Errorf("by model = %+v", rep.Rows)
			}
		case ByAgent:
			if len(rep.Rows) != 1 || rep.Rows[0].Label != labelNoAgent {
				t.Errorf("by agent = %+v", rep.Rows)
			}
		}
	}
	if _, err := f.svc.Report(f.ctx, authz.Actor{UserID: uuid.New()}, ReportFilter{From: day("2026-09-01"), To: day("2026-09-30"), GroupBy: ByDay}); err == nil {
		t.Fatal("a non-admin read the report")
	}
}

// A price dated in the past prices usage already recorded; deleting a row
// restores the previous price.
func TestPricesAreDated(t *testing.T) {
	f := newFixture(t)
	f.settings(ModeTrack, "UTC")
	f.event(UnitChatIn, 1_000_000, f.chat, "2026-09-10T12:00:00Z")
	f.event(UnitChatIn, 1_000_000, f.chat, "2026-09-20T12:00:00Z")
	add := func(from, price string) {
		t.Helper()
		if _, err := f.svc.AddPrices(f.ctx, f.admin, f.chat, day(from), []PriceInput{{Unit: UnitChatIn, Price: price}}); err != nil {
			t.Fatal(err)
		}
	}
	add("2026-09-01", "1")
	add("2026-09-15", "3")
	if got := f.spent(); got != "4.000000" {
		t.Fatalf("spent = %s, want 1 + 3", got)
	}
	if _, err := f.svc.AddPrices(f.ctx, f.admin, f.chat, day("2026-09-15"), []PriceInput{{Unit: UnitChatIn, Price: "9"}}); err == nil {
		t.Fatal("a second price on the same date was accepted")
	}
	if _, err := f.svc.AddPrices(f.ctx, f.admin, f.chat, day("2026-09-15"), []PriceInput{{Unit: UnitEmbed, Price: "9"}}); err == nil {
		t.Fatal("a chat model accepted an embedding price")
	}
	mp, err := f.svc.ModelPrices(f.ctx, f.admin, f.chat)
	if err != nil || len(mp.History) != 2 || Format(mp.Current[0].Price) != "3.000000" || mp.Current[1].Price != nil {
		t.Fatalf("model prices = %+v %v", mp, err)
	}
	if err := f.svc.DeletePrice(f.ctx, f.admin, f.chat, mp.History[0].ID); err != nil {
		t.Fatal(err)
	}
	if got := f.spent(); got != "2.000000" {
		t.Fatalf("after deleting the 15th's price spent = %s, want 2", got)
	}
	var audits int
	_ = f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_log WHERE action IN ('costs.price_add', 'costs.price_delete', 'costs.settings_update')`).Scan(&audits)
	if audits != 4 {
		t.Fatalf("audit entries = %d, want 4", audits)
	}
	if err := f.svc.DeletePrice(f.ctx, authz.Actor{UserID: uuid.New(), PlatformRole: authz.PlatformAuditor}, f.chat, mp.History[1].ID); err == nil {
		t.Fatal("an auditor deleted a price")
	}
}

// Enforcement: at 100% the check refuses with budget_exhausted; the
// threshold and the budget notify once per month each; an extension
// unblocks at once; the month boundary follows the platform time zone.
func TestBudgetCheckAndNotices(t *testing.T) {
	f := newFixture(t)
	f.settings(ModeEnforce, "UTC")
	if _, err := f.svc.AddPrices(f.ctx, f.admin, f.chat, day("2026-01-01"), []PriceInput{{Unit: UnitChatIn, Price: "1"}}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Check(f.ctx, f.team); err != nil {
		t.Fatalf("no budget: %v", err)
	}
	amount := "5"
	if _, err := f.svc.UpdateTeamBudget(f.ctx, f.admin, "registrar", TeamBudgetInput{Mode: ModeInherit, Amount: &amount}, 1); err != nil {
		t.Fatal(err)
	}
	f.event(UnitChatIn, 4_000_000, f.chat, "2026-09-28T09:00:00Z")
	f.setClock("2026-09-28T10:05:31Z") // past the cache of the budget change's reply
	if err := f.svc.Check(f.ctx, f.team); err != nil {
		t.Fatalf("at 80%%: %v", err)
	}
	f.event(UnitChatIn, 1_500_000, f.chat, "2026-09-28T09:10:00Z")
	// The cached month-to-date spend is still 4 for up to CacheTTL.
	if err := f.svc.Check(f.ctx, f.team); err != nil {
		t.Fatalf("cached: %v", err)
	}
	f.setClock("2026-09-28T10:06:05Z")
	for range 3 {
		err := f.svc.Check(f.ctx, f.team)
		if !IsExhausted(err) {
			t.Fatalf("at 110%%: %v", err)
		}
	}
	blocked, resets, err := f.svc.Blocked(f.ctx, f.team)
	if !blocked || err != nil || resets.Format(time.RFC3339) != "2026-10-01T00:00:00Z" {
		t.Fatalf("Blocked = %v %s %v", blocked, resets, err)
	}
	if len(f.notices) != 2 || f.notices[0].Level != LevelWarning || f.notices[1].Level != LevelExhausted {
		t.Fatalf("notices = %+v", f.notices)
	}
	tb, err := f.svc.GrantExtension(f.ctx, f.admin, "registrar", "1.5", "Exam period")
	if err != nil || tb.Status.State != StateWarning || Format(tb.Status.Limit) != "6.500000" || len(tb.Extensions) != 1 {
		t.Fatalf("after the extension = %+v %v", tb.Status, err)
	}
	if err := f.svc.Check(f.ctx, f.team); err != nil {
		t.Fatalf("after the extension: %v", err)
	}
	if n := len(f.notices); n != 2 {
		t.Fatalf("notices after the extension = %d, want 2 (once per level and month)", n)
	}
	if last := f.changes[len(f.changes)-1]; !last.Valid || last.UUID != f.team {
		t.Fatalf("OnChange = %+v", f.changes)
	}
	list, err := f.svc.Budgets(f.ctx, authz.Actor{UserID: uuid.New(), PlatformRole: authz.PlatformAuditor})
	if err != nil || len(list.Items) != 1 || list.Items[0].Status.State != StateWarning || Format(list.Items[0].Status.Spent) != "5.500000" {
		t.Fatalf("budgets = %+v %v", list.Items, err)
	}

	// A new month: the extension lapses, the notices can fire again.
	f.setClock("2026-10-01T00:30:00Z")
	st, err := f.svc.status(f.ctx, f.team, true)
	if err != nil || st.State != StateOK || Format(st.Extensions) != "0.000000" || Format(st.Spent) != "0.000000" {
		t.Fatalf("October = %+v %v", st, err)
	}

	// In Kolkata (+05:30) October starts at 18:30 UTC on 30 September; the
	// hour 18:00-19:00 UTC starts on 30 September locally and counts there.
	f.settings(ModeEnforce, "Asia/Kolkata")
	f.event(UnitChatIn, 1_000_000, f.chat, "2026-09-30T18:40:00Z")
	f.event(UnitChatIn, 2_000_000, f.chat, "2026-09-30T19:10:00Z")
	f.setClock("2026-09-30T20:00:00Z")
	st, err = f.svc.status(f.ctx, f.team, true)
	if err != nil || st.Month.Format(time.DateOnly) != "2026-10-01" || Format(st.Spent) != "2.000000" {
		t.Fatalf("Kolkata October = %s spent %s %v", st.Month, Format(st.Spent), err)
	}

	// Off: nothing is checked.
	off := ModeOff
	cur, _ := f.svc.TeamBudget(f.ctx, f.admin, "registrar")
	if _, err := f.svc.UpdateTeamBudget(f.ctx, f.admin, "registrar", TeamBudgetInput{Mode: off, Amount: &amount}, cur.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateTeamBudget(f.ctx, f.admin, "registrar", TeamBudgetInput{Mode: off}, cur.Revision); err == nil {
		t.Fatal("a stale revision was accepted")
	}
	if st, _ := f.svc.status(f.ctx, f.team, false); st.State != StateNone || st.Spent != nil {
		t.Fatalf("off = %+v", st)
	}
}

// Track only with a budget (docs/v0.2.0.md §7, owner decision 2): the
// status shows progress against the budget (or the platform default), but
// the check never refuses, the dispatcher never skips the team, and nobody
// is notified, even past 100%.
func TestTrackOnlyBudgetShowsProgressOnly(t *testing.T) {
	f := newFixture(t)
	f.settings(ModeTrack, "UTC")
	if _, err := f.svc.AddPrices(f.ctx, f.admin, f.chat, day("2026-01-01"), []PriceInput{{Unit: UnitChatIn, Price: "1"}}); err != nil {
		t.Fatal(err)
	}
	amount := "5"
	if _, err := f.svc.UpdateTeamBudget(f.ctx, f.admin, "registrar", TeamBudgetInput{Mode: ModeInherit, Amount: &amount}, 1); err != nil {
		t.Fatal(err)
	}
	f.event(UnitChatIn, 600_000, f.chat, "2026-09-28T09:00:00Z")
	st, err := f.svc.status(f.ctx, f.team, true)
	if err != nil || st.Enforced() || st.State != StateOK || Format(st.Limit) != "5.000000" || Format(st.Spent) != "0.600000" {
		t.Fatalf("12%% tracked = %+v %v", st, err)
	}
	f.event(UnitChatIn, 6_000_000, f.chat, "2026-09-28T09:10:00Z")
	prof := f.id(`INSERT INTO embedding_profiles (key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
		VALUES ('p', 'P', $1, 768, 'halfvec', 512, 0) RETURNING id`, f.embed)
	f.exec(`WITH s AS (INSERT INTO data_sources (team_id, name, type, classification, embedding_profile_id) VALUES ($1, 'Uploads', 'upload', 'open', $2) RETURNING id)
		INSERT INTO documents (source_id, team_id, external_id, status) SELECT s.id, $1, 'waiting.pdf', 'pending' FROM s`, f.team, prof)
	f.setClock("2026-09-28T10:07:00Z")
	for range 2 {
		if err := f.svc.Check(f.ctx, f.team); err != nil {
			t.Fatalf("a Track-only budget refused at 132%%: %v", err)
		}
	}
	if blocked, _, err := f.svc.Blocked(f.ctx, f.team); blocked || err != nil {
		t.Fatalf("Blocked = %v %v", blocked, err)
	}
	f.settings(ModeTrack, "UTC")
	if teams, err := f.svc.BlockedTeams(f.ctx); err != nil || len(teams) != 0 {
		t.Fatalf("BlockedTeams = %v %v", teams, err)
	}
	var notices int
	_ = f.pool.QueryRow(f.ctx, `SELECT count(*) FROM budget_notices`).Scan(&notices)
	if len(f.notices) != 0 || notices != 0 {
		t.Fatalf("a Track-only budget notified: %+v (%d rows)", f.notices, notices)
	}
	list, err := f.svc.Budgets(f.ctx, f.admin)
	if err != nil || len(list.Items) != 1 || list.Items[0].Status.State != StateExhausted || list.Items[0].Status.Enforced() {
		t.Fatalf("budgets = %+v %v", list.Items, err)
	}

	// Without its own budget the platform default applies, as in Enforce.
	cur, _ := f.svc.Settings(f.ctx, f.admin)
	def := "20"
	if _, err := f.svc.UpdateSettings(f.ctx, f.admin, SettingsInput{Mode: ModeTrack, Currency: "USD", TimeZone: "UTC", WarnPercent: 80, DefaultBudget: &def},
		cur.Revision); err != nil {
		t.Fatal(err)
	}
	tb, _ := f.svc.TeamBudget(f.ctx, f.admin, "registrar")
	if _, err := f.svc.UpdateTeamBudget(f.ctx, f.admin, "registrar", TeamBudgetInput{Mode: ModeInherit}, tb.Revision); err != nil {
		t.Fatal(err)
	}
	st, err = f.svc.status(f.ctx, f.team, true)
	if err != nil || st.State != StateOK || Format(st.Limit) != "20.000000" {
		t.Fatalf("default budget = %+v %v", st, err)
	}
}
