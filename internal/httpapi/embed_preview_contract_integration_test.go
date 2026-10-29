package httpapi_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestEmbedPreviewShellDoesNotGrantAgentAccess(t *testing.T) {
	env := newAgentEnv(t)
	agent := env.publishAgent(t, "Preview helper", env.agentConfig(env.kb.Id.String()))
	for _, id := range []string{agent.Id.String(), uuid.NewString()} {
		res, err := http.Get(env.app.URL + "/embed/" + id + "?preview=1&team=" + env.team)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil || res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Type"), "text/html") ||
			!strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors 'self'") ||
			strings.Contains(string(body), agent.Name) {
			t.Fatalf("preview shell = %d (%v), CSP %s", res.StatusCode, err, res.Header.Get("Content-Security-Policy"))
		}
	}
	anon := &session{t: t, app: env.app, client: &http.Client{}}
	if code := anon.get(env.base+"/agents/"+agent.Id.String(), nil); code != 401 {
		t.Fatalf("anonymous agent profile = %d, want 401", code)
	}
	code, e := anon.call("POST", env.base+"/agents/"+agent.Id.String()+"/test", map[string]any{"message": "Hello", "stream": false}, nil, nil)
	mustCode(t, "anonymous preview chat", code, e, 401, "unauthorized")
}
