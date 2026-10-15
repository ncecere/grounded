package httpapi_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// previewEvalSet makes an evaluation set of the knowledge base as the team's owner.
func (env *migEnv) previewEvalSet(t *testing.T, kb uuid.UUID, name string) apitypes.EvaluationSet {
	t.Helper()
	var set apitypes.EvaluationSet
	code, e := env.owner.call("POST", env.base+"/evaluation-sets", map[string]any{"kbId": kb, "name": name}, &set, nil)
	mustCode(t, "create set", code, e, 201, "")
	return set
}

func (env *migEnv) previewEvalQuestion(t *testing.T, set apitypes.EvaluationSet, question, filename string) {
	t.Helper()
	code, e := env.owner.call("POST", env.base+"/evaluation-sets/"+set.Id.String()+"/questions",
		map[string]any{"question": question, "expected": map[string]any{"filenames": []string{filename}}}, nil, nil)
	mustCode(t, "add question", code, e, 201, "")
}

// previewRuns counts a migration's index-preview runs of one status ("" = any).
func (env *migEnv) previewRuns(t *testing.T, migration uuid.UUID, status string) int64 {
	return env.scalar(t, `SELECT count(*) FROM eval_runs WHERE trigger = 'index_preview' AND config->'preview'->>'migrationId' = $1
		AND ($2 = '' OR status = $2)`, migration.String(), status)
}

func (env *migEnv) waitPreviewRuns(t *testing.T, migration uuid.UUID, completed int64) {
	t.Helper()
	eventually(t, "index preview runs", func() bool { return env.previewRuns(t, migration, "completed") >= completed })
}

// When a held migration is ready, every evaluation set of its knowledge base is run twice, retrieval only: on the live index and on the
// candidate's, through the profile each run records. The runs are the platform admin's comparison, not the team's history (#18, T3).
func TestProfilePreviewEvaluatesBothIndexes(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook",
		upload{"parking.md", []byte(longText("Parking permits", 40))},
		upload{"housing.md", []byte(longText("Housing", 12))})
	kb := env.kb(t, "Handbook", src.Id)
	set := env.previewEvalSet(t, kb.Id, "Handbook questions")
	env.previewEvalQuestion(t, set, "How do I get a parking permit?", "parking.md")
	env.previewEvalQuestion(t, set, "What are the housing deadlines?", "housing.md")
	empty := env.previewEvalSet(t, kb.Id, "No questions yet") // a set without questions is not run

	// A candidate with another model (48 dimensions, not the live 64): only a run that retrieves through the candidate's profile can embed
	// its queries with that model, and search its vector table.
	m := env.preview(t, kb.Id, map[string]any{"modelId": env.twin.Model.Id})
	cand := m.ToProfile.Id
	env.waitStatus(t, m.Id, statusReady)
	env.waitPreviewRuns(t, m.Id, 2)

	if n := env.previewRuns(t, m.Id, ""); n != 2 {
		t.Fatalf("preview runs = %d, want 2 (live and candidate, for the one set with questions)", n)
	}
	sides := map[string]uuid.UUID{}
	for _, side := range []string{"live", "candidate"} {
		var run uuid.UUID
		if err := env.app.Pool.QueryRow(t.Context(), `SELECT id FROM eval_runs WHERE trigger = 'index_preview' AND kind = 'retrieval'
			AND config->'preview'->>'migrationId' = $1 AND config->'preview'->>'side' = $2 AND set_id = $3`, m.Id.String(), side, set.Id).Scan(&run); err != nil {
			t.Fatalf("%s run: %v", side, err)
		}
		sides[side] = run
		if n := env.scalar(t, `SELECT count(*) FROM eval_results WHERE run_id = $1`, run); n != 2 {
			t.Errorf("%s run has %d results, want 2", side, n)
		}
		if n := env.scalar(t, `SELECT count(*) FROM eval_results WHERE run_id = $1 AND status = 'error'`, run); n != 0 {
			t.Errorf("%s run has %d errors", side, n)
		}
	}
	profileOf := func(run uuid.UUID) string {
		var p string
		if err := env.app.Pool.QueryRow(t.Context(), `SELECT config->'kbs'->0->>'profileId' FROM eval_runs WHERE id = $1`, run).Scan(&p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	if got := profileOf(sides["live"]); got != env.from.Id.String() {
		t.Errorf("live run profile = %s, want %s", got, env.from.Id)
	}
	if got := profileOf(sides["candidate"]); got != cand.String() {
		t.Errorf("candidate run profile = %s, want %s", got, cand)
	}
	if env.scalar(t, `SELECT count(*) FROM eval_runs WHERE set_id = $1`, empty.Id) != 0 {
		t.Error("a set without questions was run")
	}

	// Ask again: a second pair, and the queries of each side go to that side's model (the live side's 64-dimension model, the candidate's 48).
	live0, cand0 := env.proxy.EmbedRequestsFor("bow-64"), env.proxy.EmbedRequestsFor("bow-48")
	var started apitypes.ProfileMigrationEvaluation
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/evaluate", nil, &started, nil)
	mustCode(t, "evaluate again", code, e, 202, "")
	if started.Sets != 1 {
		t.Errorf("sets started = %d, want 1", started.Sets)
	}
	env.waitPreviewRuns(t, m.Id, 4)
	if d := env.proxy.EmbedRequestsFor("bow-64") - live0; d < 2 {
		t.Errorf("the live side embedded %d queries with the live model, want at least 2", d)
	}
	if d := env.proxy.EmbedRequestsFor("bow-48") - cand0; d < 2 {
		t.Errorf("the candidate side embedded %d queries with the candidate's model, want at least 2", d)
	}

	// Not the team's history: no run in the set's list, no last run on the set (while only preview runs exist), and later a team run starts,
	// finishes and is the set's last run.
	var runs []apitypes.EvaluationRun
	if code := env.owner.get(env.base+"/evaluation-sets/"+set.Id.String()+"/runs", &runs); code != 200 || len(runs) != 0 {
		t.Fatalf("the team's runs = %d %+v, want none", code, runs)
	}
	var before []apitypes.EvaluationSet
	env.owner.get(env.base+"/evaluation-sets?kbId="+kb.Id.String(), &before)
	for _, s := range before {
		if s.Id == set.Id && s.LastRun != nil {
			t.Errorf("the set's last run = %+v while only preview runs exist", s.LastRun)
		}
	}
	var one apitypes.EvaluationSet // the set's own page reads its last run the same way
	if code := env.owner.get(env.base+"/evaluation-sets/"+set.Id.String(), &one); code != 200 || one.LastRun != nil {
		t.Errorf("the set = %d, last run %+v while only preview runs exist", code, one.LastRun)
	}
	// A team's run that is going does not hold a preview back (one is made up here, to be sure it is going).
	env.scalar(t, `WITH r AS (INSERT INTO eval_runs (set_id, team_id, kind, trigger, status, config, total)
		SELECT set_id, team_id, kind, 'manual', 'running', config - 'preview', total FROM eval_runs WHERE trigger = 'index_preview' LIMIT 1 RETURNING 1) SELECT count(*) FROM r`)
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/evaluate", nil, nil, nil)
	mustCode(t, "evaluate beside a team run", code, e, 202, "")
	env.waitPreviewRuns(t, m.Id, 6)
	env.scalar(t, `WITH r AS (UPDATE eval_runs SET status = 'cancelled' WHERE trigger = 'manual' AND status = 'running' RETURNING 1) SELECT count(*) FROM r`)
	// A preview run that is still going neither blocks a team's run nor is blocked by it (one is made up here, to be sure it is going).
	env.scalar(t, `WITH r AS (INSERT INTO eval_runs (set_id, team_id, kind, trigger, status, config, total)
		SELECT set_id, team_id, kind, trigger, 'running', config, total FROM eval_runs WHERE trigger = 'index_preview' LIMIT 1 RETURNING 1) SELECT count(*) FROM r`)
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/evaluate", nil, nil, nil)
	mustCode(t, "evaluate while one runs", code, e, 409, "preview_running")
	var mine apitypes.EvaluationRun
	code, e = env.owner.call("POST", env.base+"/evaluation-sets/"+set.Id.String()+"/runs", map[string]any{"kind": "retrieval"}, &mine, nil)
	mustCode(t, "a team run beside a preview run", code, e, 201, "")
	eventually(t, "team run", func() bool {
		var d apitypes.EvaluationRunDetail
		env.owner.get(env.base+"/evaluation-sets/"+set.Id.String()+"/runs/"+mine.Id.String(), &d)
		return d.Run.Status == "completed"
	})
	var sets []apitypes.EvaluationSet
	env.owner.get(env.base+"/evaluation-sets?kbId="+kb.Id.String(), &sets)
	for _, s := range sets {
		if s.Id == set.Id && (s.LastRun == nil || s.LastRun.Id != mine.Id) {
			t.Errorf("the set's last run = %+v, want the team's run %s", s.LastRun, mine.Id)
		}
	}
	env.scalar(t, `WITH r AS (UPDATE eval_runs SET status = 'cancelled' WHERE trigger = 'index_preview' AND status = 'running' RETURNING 1) SELECT count(*) FROM r`)

	// A member cannot ask for it; only a ready migration can be evaluated.
	code, e = env.owner.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/evaluate", nil, nil, nil)
	mustCode(t, "member evaluate", code, e, 403, "")
	env.action(t, env.migration(t, m.Id), "cancel", 200, "")
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/evaluate", nil, nil, nil)
	mustCode(t, "evaluate a discarded preview", code, e, 409, "migration_not_ready")
}

// A comparison that cannot be started must not keep the migration from becoming ready: the migration is what the admin asked for, and the
// comparison can be asked for again.
func TestProfilePreviewIsReadyEvenIfTheComparisonCannotStart(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", upload{"parking.md", []byte(longText("Parking permits", 40))})
	kb := env.kb(t, "Handbook", src.Id)
	set := env.previewEvalSet(t, kb.Id, "Handbook questions")
	env.previewEvalQuestion(t, set, "How do I get a parking permit?", "parking.md")

	hook := env.app.Svc.ProfileMigrations.OnPreviewReady
	env.app.Svc.ProfileMigrations.OnPreviewReady = func(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (int, error) {
		return 0, errors.New("the comparison is broken")
	}
	m := env.preview(t, kb.Id, map[string]any{"chunkSize": 256, "chunkOverlap": 32})
	m = env.waitStatus(t, m.Id, statusReady)
	if n := env.previewRuns(t, m.Id, ""); n != 0 {
		t.Errorf("preview runs = %d, want none (the hook failed)", n)
	}
	var sets int64
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT (metadata->>'evaluationSets')::bigint FROM audit_log WHERE action = 'kb.profile_preview_ready'
		AND target_id = $1`, kb.Id.String()).Scan(&sets); err != nil || sets != 0 {
		t.Errorf("ready audit evaluationSets = %d, %v", sets, err)
	}
	// And it can be asked for again once it works.
	env.app.Svc.ProfileMigrations.OnPreviewReady = hook
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations/"+m.Id.String()+"/evaluate", nil, nil, nil)
	mustCode(t, "evaluate again", code, e, 202, "")
	env.waitPreviewRuns(t, m.Id, 2)
}
