package httpapi_test

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// Template names are unique ignoring case for every script (#140), enforced by the service under a lock and not yet by a database
// constraint (#195, ADR-0013: a tighter constraint ships one release after the code that writes valid data). These tests run in a database
// created with --locale=C, where the database's lower() changes ASCII letters only and the old index agent_templates_name_key cannot see
// "qa über" and "QA ÜBER" as one name: the only thing that can answer 409 is the service.

type templateNamesEnv struct {
	*agentEnv
	src apitypes.Agent
}

func newTemplateNamesEnv(t *testing.T) *templateNamesEnv {
	t.Helper()
	pool, _ := testutil.NewDBInCLocale(t)
	env := &templateNamesEnv{agentEnv: newAgentEnvOn(t, pool, nil)}
	var folds bool
	if err := pool.QueryRow(context.Background(), `SELECT lower('Ü') <> 'Ü'`).Scan(&folds); err != nil || folds {
		t.Fatalf("the database folds non-ASCII case (%v, %v): this test needs a C-locale database", folds, err)
	}
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Registrar", "config": env.agentConfig(env.kb.Id.String())}, &env.src, nil)
	mustCode(t, "source agent", code, e, 201, "")
	// Platform admins save templates from agents of teams they are an editor of.
	code, e = env.owner.call("POST", env.base+"/members", map[string]string{"email": "admin@localhost", "role": "editor"}, nil, nil)
	mustCode(t, "add the platform admin to the team", code, e, 201, "")
	env.admin.refresh()
	return env
}

func (env *templateNamesEnv) save(name string) (int, string) {
	var tm apitypes.AgentTemplate
	code, e := env.admin.call("POST", env.base+"/agents/"+env.src.Id.String()+"/save-as-template", map[string]any{"name": name}, &tm, nil)
	return code, e
}

func (env *templateNamesEnv) saveOK(t *testing.T, name string) apitypes.AgentTemplate {
	t.Helper()
	var tm apitypes.AgentTemplate
	code, e := env.admin.call("POST", env.base+"/agents/"+env.src.Id.String()+"/save-as-template", map[string]any{"name": name}, &tm, nil)
	mustCode(t, "save "+name, code, e, 201, "")
	return tm
}

func (env *templateNamesEnv) rename(id string, body map[string]any) (int, string) {
	code, e := env.admin.call("PATCH", "/v1/admin/agent-templates/"+id, body, nil, nil)
	return code, e
}

// foldedCount is how many saved templates have this name once case is folded for every script.
func (env *templateNamesEnv) foldedCount(t *testing.T, name string) int64 {
	t.Helper()
	return env.scalar(t, `SELECT count(*) FROM agent_templates WHERE lower(name COLLATE "und-x-icu") = lower($1::text COLLATE "und-x-icu")`, name)
}

func TestTemplateNamesAreUniqueIgnoringUnicodeCaseInTheService(t *testing.T) {
	env := newTemplateNamesEnv(t)

	first := env.saveOK(t, "qa über")
	for _, twin := range []string{"QA ÜBER", "Qa Über", "qa Über", "QA über"} {
		if code, e := env.save(twin); code != 409 || e != "template_name_taken" {
			t.Errorf("saving %q next to %q = %d %s, want 409 template_name_taken", twin, first.Name, code, e)
		}
	}
	env.saveOK(t, "é")
	if code, _ := env.save("É"); code != 409 {
		t.Errorf("É next to é = %d, want 409", code)
	}
	if n := env.scalar(t, `SELECT count(*) FROM agent_templates`); n != 2 {
		t.Errorf("%d templates after rejected saves, want 2", n)
	}
	// The built-in names stay taken.
	if code, _ := env.save("SERVICE DESK FAQ"); code != 409 {
		t.Errorf("a built-in name = %d, want 409", code)
	}

	// A rejected rename changes nothing: not the name, not updated_at, no audit entry.
	other := env.saveOK(t, "Other")
	type snapshot struct {
		name    string
		updated string
		audits  int64
	}
	snap := func() snapshot {
		s := snapshot{audits: env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent_template.update'`)}
		if err := env.app.Pool.QueryRow(context.Background(), `SELECT name, updated_at::text FROM agent_templates WHERE id = $1::uuid`, other.Id).Scan(&s.name, &s.updated); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := snap()
	for _, to := range []string{"QA ÜBER", "É", "qa über"} {
		if code, e := env.rename(other.Id, map[string]any{"name": to, "description": "must not be saved"}); code != 409 {
			t.Errorf("renaming onto %q = %d %s, want 409", to, code, e)
		}
	}
	if after := snap(); after != before {
		t.Errorf("rejected renames changed the template: %+v -> %+v", before, after)
	}
	if n := env.scalar(t, `SELECT count(*) FROM agent_templates WHERE description = 'must not be saved'`); n != 0 {
		t.Errorf("a rejected rename saved its description")
	}

	// A template may change the case of its own name (it is not its own twin), and a free name is accepted.
	if code, e := env.rename(first.Id, map[string]any{"name": "QA ÜBER"}); code != 200 {
		t.Errorf("a template changing the case of its own name = %d %s", code, e)
	}
	if code, e := env.rename(other.Id, map[string]any{"name": "Free"}); code != 200 {
		t.Errorf("renaming to a free name = %d %s", code, e)
	}
	// The name "qa über" is now taken by the renamed first template, whatever its case.
	if code, _ := env.save("qa über"); code != 409 {
		t.Errorf("the renamed template's name was free: %d", code)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent_template.update'`); n != before.audits+2 {
		t.Errorf("%d update audit entries, want the two renames added to %d", n, before.audits)
	}
}

// What a v0.6.2 pod can leave next to this release: two templates whose names differ only beyond ASCII (its index cannot see it). They
// stay editable (a description needs no name check), one can be renamed to a free name, and neither can be renamed onto the other.
func TestTemplateTwinsFromAnOldPodStayManageable(t *testing.T) {
	env := newTemplateNamesEnv(t)
	ctx := context.Background()
	var a, b string
	for name, dst := range map[string]*string{"Twin Ü": &a, "TWIN ü": &b} {
		if err := env.app.Pool.QueryRow(ctx, `INSERT INTO agent_templates (name, config) VALUES ($1, '{}') RETURNING id::text`, name).Scan(dst); err != nil {
			t.Fatalf("the old pod's insert of %q: %v", name, err)
		}
	}
	if code, e := env.rename(a, map[string]any{"description": "Edited."}); code != 200 {
		t.Errorf("a description edit on a template that has a twin = %d %s, want 200", code, e)
	}
	if code, e := env.rename(a, map[string]any{"name": "TWIN ü"}); code != 409 {
		t.Errorf("renaming a twin onto the other = %d %s, want 409", code, e)
	}
	if code, e := env.rename(b, map[string]any{"name": "Twin Two"}); code != 200 {
		t.Errorf("renaming a twin to a free name = %d %s", code, e)
	}
	// A new save sees both names as taken.
	if code, _ := env.save("twin ü"); code != 409 {
		t.Errorf("saving the twins' name = %d, want 409", code)
	}
}

// Writers of this release that race for one name: exactly one wins, whatever the spelling, and the others get 409, never a 500 and never a
// second template. Without the lock the check could not see a row that is not committed yet; without the check the C-locale database
// accepts every spelling that differs beyond ASCII.
func TestTemplateNamesAreUniqueUnderConcurrency(t *testing.T) {
	env := newTemplateNamesEnv(t)
	const writers = 8
	// Spellings that the database's own lower() (C: ASCII only) tells apart in four ways, so the old index alone cannot decide the race.

	for round := 0; round < 4; round++ {
		spellings := []string{"zoë über", "zoË über", "zoë Über", "zoË Über", "ZOë über", "ZOË über", "Zoë Über", "ZOË ÜBER"}
		for i := range spellings {
			spellings[i] = fmt.Sprintf("r%d ", round) + spellings[i]
		}
		codes := parallel(writers, func(i int) int { code, _ := env.save(spellings[i]); return code })
		wins, conflicts := tally(codes)
		if wins != 1 || conflicts != writers-1 {
			t.Errorf("round %d: %d saved, %d refused with 409 (all: %v), want 1 and %d", round, wins, conflicts, codes, writers-1)
		}
		if n := env.foldedCount(t, spellings[0]); n != 1 {
			t.Errorf("round %d: %d templates now have that name", round, n)
		}
	}
}

// Renames that race onto one name, and a rename that races a save of it: one winner; the loser's template keeps its own name.
func TestTemplateRenamesAreUniqueUnderConcurrency(t *testing.T) {
	env := newTemplateNamesEnv(t)
	const writers = 6
	for round := range 4 {
		ids := make([]string, writers)
		for i := range ids {
			ids[i] = env.saveOK(t, fmt.Sprintf("Template %d-%d", round, i)).Id
		}
		prefix := fmt.Sprintf("shared%d ", round)
		targets := []string{"ünï", "Ünï", "ünÏ", "ÜnÏ", "ÜNï", "ÜNÏ"}
		codes := parallel(writers, func(i int) int {
			code, _ := env.rename(ids[i], map[string]any{"name": prefix + targets[i]})
			return code
		})
		wins, conflicts := tally(codes)
		if wins != 1 || conflicts != writers-1 {
			t.Errorf("round %d: %d renamed, %d refused with 409 (all: %v), want 1 and %d", round, wins, conflicts, codes, writers-1)
		}
		if n := env.foldedCount(t, prefix+"ünï"); n != 1 {
			t.Errorf("round %d: %d templates have the contested name", round, n)
		}
		if n := env.scalar(t, `SELECT count(*) FROM agent_templates WHERE name LIKE $1`, fmt.Sprintf("Template %d-%%", round)); n != writers-1 {
			t.Errorf("round %d: %d templates kept their names, want %d", round, n, writers-1)
		}
	}

	// One save and one rename of another template, onto the same free name.
	free := env.saveOK(t, "Mover").Id
	codes := parallel(2, func(i int) int {
		if i == 0 {
			code, _ := env.save("Wettbewerb ÄÖ")
			return code
		}
		code, _ := env.rename(free, map[string]any{"name": "wettbewerb äö"})
		return code
	})
	if w, c := tally(codes); w != 1 || c != 1 || env.foldedCount(t, "wettbewerb äö") != 1 {
		t.Errorf("a save and a rename of one name: %v, %d templates", codes, env.foldedCount(t, "wettbewerb äö"))
	}
}

// parallel runs fn(0..n-1) at the same moment and returns what each returned.
func parallel(n int, fn func(i int) int) []int {
	out := make([]int, n)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			out[i] = fn(i)
		}()
	}
	close(start)
	wg.Wait()
	return out
}

// tally counts the creations or successes (200, 201) and the 409s; anything else is neither (a 5xx fails the caller's counts).
func tally(codes []int) (wins, conflicts int) {
	for _, c := range codes {
		switch c {
		case http.StatusOK, http.StatusCreated:
			wins++
		case http.StatusConflict:
			conflicts++
		}
	}
	return wins, conflicts
}
