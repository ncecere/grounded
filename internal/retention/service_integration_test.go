package retention

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/testutil"
)

// Settings: environment defaults apply until a platform admin sets a
// period; keep and default are distinct; bounds are checked; the revision
// guards edits; changes are audited with before and after.
func TestSettings(t *testing.T) {
	f := newFixture(t)
	s := f.service()
	s.Env.Days = map[string]int{"audit_log": 400}
	st, err := s.Settings(f.ctx, authz.Actor{UserID: f.other, PlatformRole: authz.PlatformAuditor})
	if err != nil {
		t.Fatal(err)
	}
	if p := st.Periods[AuditLog]; p.Source != SourceEnvironment || p.Days == nil || *p.Days != 400 || p.PlatformSet {
		t.Fatalf("audit period = %+v", p)
	}
	if p := st.Periods[AccessLog]; p.Days != nil || p.Min != 1 {
		t.Fatalf("access log = %+v", p)
	}
	if len(st.Levels) != 3 || st.Levels[0].AnonymousHours != 24 || st.Levels[0].ConversationDays != nil {
		t.Fatalf("levels = %+v", st.Levels)
	}

	if _, err := s.SetPeriods(f.ctx, authz.Actor{UserID: f.other, PlatformRole: authz.PlatformAuditor}, nil, st.Revision); !errors.Is(err, errAdminOnly) {
		t.Fatalf("auditor = %v", err)
	}
	_, err = s.SetPeriods(f.ctx, f.admin, []PeriodUpdate{{Kind: UsageEvents, Mode: ModeDays, Days: 3}}, st.Revision)
	wantCode(t, "below minimum", err, "invalid_period")
	_, err = s.SetPeriods(f.ctx, f.admin, []PeriodUpdate{{Kind: Conversations, Mode: ModeKeep}}, st.Revision)
	wantCode(t, "per level", err, "invalid_kind")
	_, err = s.SetPeriods(f.ctx, f.admin, []PeriodUpdate{{Kind: AccessLog, Mode: ModeKeep}}, st.Revision+1)
	if e, ok := apperr.As(err); !ok || e.Status != 412 {
		t.Fatalf("stale = %v", err)
	}
	st2, err := s.SetPeriods(f.ctx, f.admin, []PeriodUpdate{
		{Kind: AuditLog, Mode: ModeKeep}, {Kind: AccessLog, Mode: ModeDays, Days: 90},
	}, st.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if p := st2.Periods[AuditLog]; p.Source != SourcePlatform || p.Days != nil || !p.PlatformSet || *p.EnvDays != 400 {
		t.Fatalf("kept audit = %+v", p)
	}
	if p := st2.Periods[AccessLog]; p.Days == nil || *p.Days != 90 || st2.UpdatedBy.ID != f.admin.UserID || st2.Revision != st.Revision+1 {
		t.Fatalf("access log = %+v", p)
	}
	// Back to the default.
	st3, err := s.SetPeriods(f.ctx, f.admin, []PeriodUpdate{{Kind: AuditLog, Mode: ModeDefault}}, st2.Revision)
	if err != nil || st3.Periods[AuditLog].Source != SourceEnvironment || *st3.Periods[AccessLog].Days != 90 {
		t.Fatalf("default = %+v %v", st3.Periods, err)
	}
	var before, after json.RawMessage
	if err := f.pool.QueryRow(f.ctx, `SELECT before_state, after_state FROM audit_log WHERE action = 'retention.settings_update' ORDER BY id LIMIT 1`).Scan(&before, &after); err != nil {
		t.Fatal(err)
	}
	var b, a Stored
	_ = json.Unmarshal(before, &b)
	_ = json.Unmarshal(after, &a)
	if len(b) != 0 || len(a) != 2 || a["audit_log"] != nil || a["access_log"] == nil || *a["access_log"] != 90 {
		t.Fatalf("audit = %s → %s", before, after)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE action = 'retention.settings_update'`); n != 2 {
		t.Fatalf("audit entries = %d", n)
	}
}

// A scheduled run is recorded with its counts and audited (counts only)
// when it deleted something; runs don't overlap; a requested run is queued
// with its job and runs once.
func TestRunsRecordAndAudit(t *testing.T) {
	f := newFixture(t)
	r := f.runner()
	if ran, err := r.RunScheduled(f.ctx); err != nil || !ran {
		t.Fatalf("empty run = %v %v", ran, err)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE action = 'retention.purge'`); n != 0 {
		t.Fatalf("a run that deleted nothing was audited: %d", n)
	}
	f.conversation(f.open, f.openVersion, uuid.Nil, 25*time.Hour)
	if _, err := r.RunScheduled(f.ctx); err != nil {
		t.Fatal(err)
	}
	var meta json.RawMessage
	if err := f.pool.QueryRow(f.ctx, `SELECT metadata FROM audit_log WHERE action = 'retention.purge' AND actor_kind = 'system' AND team_id IS NULL`).Scan(&meta); err != nil {
		t.Fatal(err)
	}
	var m struct {
		Results map[string]Result `json:"results"`
		Trigger string            `json:"trigger"`
	}
	if err := json.Unmarshal(meta, &m); err != nil || m.Results["conversations"].Deleted != 1 || m.Trigger != "schedule" {
		t.Fatalf("audit metadata = %s", meta)
	}
	runs, err := f.service().Runs(f.ctx, f.admin, 10)
	if err != nil || len(runs) != 2 || runs[0].Status != "ok" || runs[0].Results[Conversations].Deleted != 1 || runs[0].FinishedAt == nil {
		t.Fatalf("runs = %+v %v", runs, err)
	}

	// Another process holds the lock: the run doesn't start.
	var wg sync.WaitGroup
	release := make(chan struct{})
	started := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = r.withLock(context.Background(), func() error { close(started); <-release; return nil })
	}()
	<-started
	if ran, err := r.RunScheduled(f.ctx); err != nil || ran {
		t.Errorf("overlapping run = %v %v", ran, err)
	}
	close(release)
	wg.Wait()
}

func TestRequestRun(t *testing.T) {
	f := newFixture(t)
	client, err := jobs.NewInsertOnly(f.pool, testutil.Logger())
	if err != nil {
		t.Fatal(err)
	}
	s := New(f.pool, client, config.RetentionDefaults(), testutil.Logger())
	if _, err := s.RequestRun(f.ctx, authz.Actor{UserID: f.other, PlatformRole: authz.PlatformAuditor}, nil); !errors.Is(err, errAdminOnly) {
		t.Fatalf("auditor = %v", err)
	}
	_, err = s.RequestRun(f.ctx, f.admin, []Kind{"nope"})
	wantCode(t, "kind", err, "invalid_kind")
	run, err := s.RequestRun(f.ctx, f.admin, []Kind{Conversations})
	if err != nil || run.Status != "queued" || run.Trigger != "manual" || len(run.Kinds) != 1 {
		t.Fatalf("run = %+v %v", run, err)
	}
	if n := f.count(`SELECT count(*) FROM river_job WHERE kind = 'retention.run_requested' AND (args->>'runId')::bigint = $1`, run.ID); n != 1 {
		t.Fatalf("jobs = %d", n)
	}
	f.conversation(f.open, f.openVersion, uuid.Nil, 25*time.Hour)
	f.exec(`INSERT INTO access_log (agent_id, rank, channel, at) VALUES ($1, 0, 'ui', now() - interval '900 days')`, f.agent)
	f.setPeriods(`{"access_log": 1}`)
	r := f.runner()
	if ran, err := r.RunRequested(f.ctx, run.ID); err != nil || !ran {
		t.Fatalf("requested = %v %v", ran, err)
	}
	runs, _ := s.Runs(f.ctx, f.admin, 5)
	if runs[0].Status != "ok" || runs[0].RequestedBy.ID != f.admin.UserID || runs[0].Results[Conversations].Deleted != 1 {
		t.Fatalf("run = %+v", runs[0])
	}
	if _, ok := runs[0].Results[AccessLog]; ok || f.count(`SELECT count(*) FROM access_log`) != 1 {
		t.Fatal("a kind that wasn't asked for ran")
	}
	// Running it again does nothing (the job may be retried).
	if _, err := r.RunRequested(f.ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE action IN ('retention.run_request', 'retention.purge')`); n != 2 {
		t.Fatalf("audit = %d", n)
	}
}
