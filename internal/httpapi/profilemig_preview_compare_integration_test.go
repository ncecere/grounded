package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/profilemig"
)

const (
	qParkingPreview = "How do I get a parking permit?"
	qHousingPreview = "What are the housing deadlines?"
)

// dropPassages removes a profile's passages (and so its vectors) of one uploaded file: a deterministic way to make one index worse than the
// other for the questions that expect that file.
//
// The hole has to stay a hole: the sweep (every 30 s, and once at start) queues an embedding job for every set, and a job puts back the passages of
// any ready document that has none. So the document is also recorded as permanently failed for that profile, as it would be if its model had
// refused it, and the sweep leaves it alone. (Without that, a sweep landing between the drop and the comparison made CI's tag build fail with
// "worse 0, same 1": the candidate's passages had been repaired.)
func (env *migEnv) dropPassages(t *testing.T, profile, source uuid.UUID, filename string) {
	t.Helper()
	if n := env.scalar(t, `WITH d AS (DELETE FROM chunks WHERE profile_id = $1 AND document_id IN
		(SELECT id FROM documents WHERE source_id = $2 AND filename = $3) RETURNING 1) SELECT count(*) FROM d`, profile, source, filename); n == 0 {
		t.Fatalf("no passages of %s in profile %s", filename, profile)
	}
	if _, err := env.app.Pool.Exec(t.Context(), `INSERT INTO embedding_set_failures (document_id, profile_id, source_id, version, error_code, error_message, permanent)
		SELECT id, $1, source_id, version, 'test', 'the model refused this document (a test)', true FROM documents WHERE source_id = $2 AND filename = $3
		ON CONFLICT (document_id, profile_id) DO UPDATE SET permanent = true, version = EXCLUDED.version`, profile, source, filename); err != nil {
		t.Fatal(err)
	}
}

// sweepAndSettle runs the migration sweep now and waits until its embedding jobs are done: what a sweep tick at any moment would do to the data.
func (env *migEnv) sweepAndSettle(t *testing.T) {
	t.Helper()
	client, err := river.NewClient(riverpgxv5.New(env.app.Pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Insert(t.Context(), profilemig.SweepArgs{}, nil); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Second) // the sweep job queues the embedding jobs
	eventually(t, "the sweep's embedding jobs", func() bool {
		return env.scalar(t, `SELECT count(*) FROM river_job WHERE kind IN ('profile_migration.sweep', 'embedding_set.sync')
			AND state IN ('available', 'pending', 'running', 'retryable', 'scheduled')`) == 0
	})
}

func (env *migEnv) comparisonFor(t *testing.T, migration uuid.UUID) apitypes.ProfileMigrationComparison {
	t.Helper()
	var c apitypes.ProfileMigrationComparison
	if code := env.admin.get("/v1/admin/profile-migrations/"+migration.String()+"/preview", &c); code != 200 {
		t.Fatalf("comparison = %d", code)
	}
	return c
}

// reevaluate asks for another comparison and waits for its two runs.
func (env *migEnv) reevaluate(t *testing.T, migration uuid.UUID, completedRuns int64) {
	t.Helper()
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations/"+migration.String()+"/evaluate", nil, nil, nil)
	mustCode(t, "evaluate", code, e, 202, "")
	env.waitPreviewRuns(t, migration, completedRuns)
}

// The comparison shows the live index beside the candidate per set, from the latest finished pair of runs: an identical candidate changes
// nothing, a candidate that lost one file's passages is worse for that file's question, and a live index that lost another file's is
// better (T4). The platform admin sees numbers only; the questions are the team's editors'.
func TestProfilePreviewComparison(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook",
		upload{"parking.md", []byte(longText("Parking permits", 40))},
		upload{"housing.md", []byte(longText("Housing", 12))})
	kb := env.kb(t, "Handbook", src.Id)
	set := env.previewEvalSet(t, kb.Id, "Handbook questions")
	env.previewEvalQuestion(t, set, qParkingPreview, "parking.md")
	env.previewEvalQuestion(t, set, qHousingPreview, "housing.md")
	// A knowledge base without evaluation sets has nothing to compare.
	bare := env.kb(t, "Bare")
	bareM := env.preview(t, bare.Id, map[string]any{})
	env.waitStatus(t, bareM.Id, statusReady)
	if c := env.comparisonFor(t, bareM.Id); len(c.Sets) != 0 || c.Running || c.Totals.Questions != 0 || c.Status != apitypes.ProfileMigrationStatusReady {
		t.Errorf("a knowledge base without sets: %+v", c)
	}

	// An identical candidate (the same settings) changes nothing.
	m := env.preview(t, kb.Id, map[string]any{})
	env.waitStatus(t, m.Id, statusReady)
	env.waitPreviewRuns(t, m.Id, 2)
	c := env.comparisonFor(t, m.Id)
	if len(c.Sets) != 1 || c.Sets[0].Name != "Handbook questions" || c.Sets[0].Live == nil || c.Sets[0].Candidate == nil {
		t.Fatalf("comparison = %+v", c)
	}
	if s := c.Sets[0]; s.Better != 0 || s.Worse != 0 || s.Same != 2 || s.Questions != 2 || s.Live.Status != "completed" || s.Candidate.Status != "completed" {
		t.Errorf("an identical candidate: better %d, worse %d, same %d of %d", s.Better, s.Worse, s.Same, s.Questions)
	}
	if c.Totals.Questions != 2 || c.Totals.Better != 0 || c.Totals.Worse != 0 || c.Totals.Live.Recall == nil || c.Totals.Candidate.Recall == nil ||
		*c.Totals.Live.Recall != *c.Totals.Candidate.Recall || c.Totals.LiveFirstPlace != c.Totals.CandidateFirstPlace {
		t.Errorf("totals of an identical candidate: %+v", c.Totals)
	}
	if c.Sets[0].Live.Summary.Passed != 2 {
		t.Errorf("live passed = %d, want both questions", c.Sets[0].Live.Summary.Passed)
	}

	// The candidate loses housing.md's passages: the housing question is worse, the parking one the same.
	env.dropPassages(t, m.ToProfile.Id, src.Id, "housing.md")
	env.sweepAndSettle(t) // a sweep must not put them back
	env.reevaluate(t, m.Id, 4)
	c = env.comparisonFor(t, m.Id)
	if s := c.Sets[0]; s.Better != 0 || s.Worse != 1 || s.Same != 1 {
		t.Errorf("candidate without housing: better %d, worse %d, same %d", s.Better, s.Worse, s.Same)
	}
	if c.Totals.Worse != 1 || c.Totals.Candidate.Passed != 1 || c.Totals.Live.Passed != 2 {
		t.Errorf("totals: %+v", c.Totals)
	}

	// The live index loses parking.md's: now parking is better and housing worse.
	env.dropPassages(t, env.from.Id, src.Id, "parking.md")
	env.sweepAndSettle(t)
	env.reevaluate(t, m.Id, 6)
	c = env.comparisonFor(t, m.Id)
	if s := c.Sets[0]; s.Better != 1 || s.Worse != 1 || s.Same != 0 {
		t.Errorf("live without parking: better %d, worse %d, same %d", s.Better, s.Worse, s.Same)
	}

	// While another comparison is under way the numbers stay the latest finished ones, and it says so (one is made up here, to be sure it is going).
	if c.Running {
		t.Error("running while nothing is")
	}
	env.scalar(t, `WITH r AS (INSERT INTO eval_runs (set_id, team_id, kind, trigger, status, config, total)
		SELECT set_id, team_id, kind, trigger, 'running', config, total FROM eval_runs WHERE trigger = 'index_preview' LIMIT 1 RETURNING 1) SELECT count(*) FROM r`)
	if running := env.comparisonFor(t, m.Id); !running.Running || running.Sets[0].Worse != 1 || running.Sets[0].Better != 1 {
		t.Errorf("while a comparison runs: running %v, %+v", running.Running, running.Sets[0])
	}
	env.scalar(t, `WITH r AS (UPDATE eval_runs SET status = 'cancelled' WHERE trigger = 'index_preview' AND status = 'running' RETURNING 1) SELECT count(*) FROM r`)

	// The platform admin sees no question text; the team's editor does, with each question's change.
	raw, _ := json.Marshal(c)
	if strings.Contains(string(raw), "parking permit") || strings.Contains(string(raw), "housing deadlines") || c.Sets[0].Items != nil {
		t.Error("the admin's comparison carries question text")
	}
	var team *apitypes.ProfileMigrationComparison
	if code := env.owner.get(env.base+"/kbs/"+kb.Id.String()+"/index-preview", &team); code != 200 || team == nil || len(team.Sets) != 1 || team.Sets[0].Items == nil {
		t.Fatalf("team view = %d %+v", code, team)
	}
	change := map[string]apitypes.PreviewQuestionChangeChange{}
	for _, it := range *team.Sets[0].Items {
		change[it.Question] = it.Change
	}
	if change[qParkingPreview] != "better" || change[qHousingPreview] != "worse" {
		t.Errorf("team view changes = %+v", change)
	}
	// Another team's knowledge base under this team's address is not found, even for the team's owner (not an empty answer).
	var otherKB uuid.UUID
	if err := env.app.Pool.QueryRow(t.Context(), `WITH t AS (INSERT INTO teams (slug, name, max_classification) VALUES ('other-team', 'Other', 'open') RETURNING id)
		INSERT INTO knowledge_bases (team_id, name, embedding_profile_id) SELECT t.id, 'Theirs', $1 FROM t RETURNING id`, env.from.Id).Scan(&otherKB); err != nil {
		t.Fatal(err)
	}
	if code, _ := env.owner.call("GET", env.base+"/kbs/"+otherKB.String()+"/index-preview", nil, nil, nil); code != 404 {
		t.Errorf("another team's knowledge base on the team's view = %d, want 404", code)
	}
	// Platform staff are not the team's editors (404), and a knowledge base without a preview is null.
	if code, _ := env.admin.call("GET", env.base+"/kbs/"+kb.Id.String()+"/index-preview", nil, nil, nil); code != 404 {
		t.Errorf("platform admin on the team's view = %d, want 404", code)
	}
	env.action(t, env.migration(t, m.Id), "cancel", 200, "")
	env.action(t, env.migration(t, bareM.Id), "cancel", 200, "")
	var none *apitypes.ProfileMigrationComparison
	if code := env.owner.get(env.base+"/kbs/"+kb.Id.String()+"/index-preview", &none); code != 200 || none != nil {
		t.Errorf("after the discard the team view = %d %+v, want null", code, none)
	}
}
