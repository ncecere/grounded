package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A refresh can finish its logical updates before River acknowledges the job.
// Mutating settings in that gap can collide with its running unique job and
// defer the next refresh until the one-minute sweep. The fixture waits for
// both forms of completion, without weakening the product-state assertions.
func TestBoilerplateFixtureWaitsForJobAcknowledgment(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Completion", upload{"policy.md", []byte("# Policy\n\nA unique handbook policy remains available.\n")})
	done := func(apitypes.SourceBoilerplate) bool { return true }
	sourcePath := env.base + "/sources/" + src.Id.String()
	waitBoilerplate(t, env.owner, sourcePath, done)
	if code := env.owner.get(sourcePath, &src); code != 200 || src.Boilerplate.Pending {
		t.Fatal("fixture must be logically settled")
	}
	var id int64
	if err := env.app.Pool.QueryRow(t.Context(), `INSERT INTO river_job (kind, args, queue, state, attempt, attempted_at)
VALUES ('boilerplate.refresh', jsonb_build_object('sourceId', $1::text), 'default', 'running', 1, now()) RETURNING id`, src.Id.String()).Scan(&id); err != nil {
		t.Fatal(err)
	}
	defer env.app.Pool.Exec(t.Context(), `DELETE FROM river_job WHERE id = $1`, id)
	if boilerplateSettled(t, env.owner, src, done) {
		t.Error("logically settled source was accepted while its refresh job was still running")
	}
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE river_job SET state = 'completed', finalized_at = now() WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if !boilerplateSettled(t, env.owner, src, done) {
		t.Error("completed refresh was not accepted")
	}
}
