package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// enableBoilerplate turns repeated-block removal on for an upload source, with the given extra overrides, and waits for the refresh.
func (env *migEnv) enableBoilerplate(t *testing.T, src apitypes.DataSource, overrides map[string]any, done func(apitypes.SourceBoilerplate) bool) apitypes.SourceBoilerplate {
	t.Helper()
	srcPath := env.base + "/sources/" + src.Id.String()
	var cur apitypes.DataSource
	env.owner.get(srcPath, &cur)
	body := map[string]any{"enabled": true}
	for k, v := range overrides {
		body[k] = v
	}
	code, e := env.owner.call("PATCH", srcPath, map[string]any{"boilerplate": body}, &cur, ifMatch(cur.Revision))
	mustCode(t, "enable boilerplate", code, e, 200, "")
	return waitBoilerplate(t, env.owner, srcPath, done)
}

// The golden test of the exact-hash matching (#23): with near-duplicate matching off, whether by leaving it out, by
// saying false, or by the platform default, the classification, the recorded and dropped hashes of every document and
// the chunks are what they were before near-duplicate matching existed. testdata/boilerplate_exact_golden.json was
// written by the code of that time (UPDATE_GOLDEN=1 regenerates it, on purpose only).
func TestBoilerplateExactGolden(t *testing.T) {
	for _, tc := range []struct {
		name      string
		overrides map[string]any
	}{
		{"unset", nil},
		{"explicit false", map[string]any{"fuzzy": false}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := newMigEnv(t)
			src := env.source(t, "Handbook", fuzzyFiles()...)
			bp := env.enableBoilerplate(t, src, tc.overrides, func(b apitypes.SourceBoilerplate) bool { return b.RepeatedBlocks > 0 })
			checkGolden(t, "boilerplate_exact_golden.json", snapshotBlocks(t, env.ragEnv, src, bp))
		})
	}
}
