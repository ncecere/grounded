package httpapi_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// ---- SSE helpers -------------------------------------------------------------------

type sseEvent struct {
	name string
	data json.RawMessage
}

type sseEvents []sseEvent

func (evs sseEvents) names() []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.name
	}
	return out
}

func (evs sseEvents) all(name string) []sseEvent {
	var out []sseEvent
	for _, e := range evs {
		if e.name == name {
			out = append(out, e)
		}
	}
	return out
}

// one decodes the only event called name.
func (evs sseEvents) one(t *testing.T, name string, out any) {
	t.Helper()
	list := evs.all(name)
	if len(list) != 1 {
		t.Fatalf("%d %s events in %v", len(list), name, evs.names())
	}
	// Decode into a zero value: json reuses slice elements otherwise.
	v := reflect.New(reflect.TypeOf(out).Elem())
	if err := json.Unmarshal(list[0].data, v.Interface()); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	reflect.ValueOf(out).Elem().Set(v.Elem())
}

func (evs sseEvents) text(name string) string {
	var b strings.Builder
	for _, e := range evs.all(name) {
		var d struct{ Delta string }
		_ = json.Unmarshal(e.data, &d)
		b.WriteString(d.Delta)
	}
	return b.String()
}

// readSSE parses named events until EOF.
func readSSE(t *testing.T, r io.Reader) sseEvents {
	t.Helper()
	var out sseEvents
	var name string
	var data []string
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "":
			if name != "" || len(data) > 0 {
				out = append(out, sseEvent{name: name, data: json.RawMessage(strings.Join(data, "\n"))})
			}
			name, data = "", nil
		case strings.HasPrefix(line, ":"):
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = append(data, strings.TrimPrefix(line, "data: "))
		}
	}
	return out
}

// stream posts body and returns the SSE events (or the error body).
func (s *session) stream(path string, body any) (int, sseEvents, string) {
	s.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", s.app.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", s.app.URL)
	req.Header.Set("X-CSRF-Token", s.csrf)
	res, err := s.client.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		raw, _ := io.ReadAll(res.Body)
		return res.StatusCode, nil, errorCode(raw)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		s.t.Fatalf("content type %q", ct)
	}
	return 200, readSSE(s.t, res.Body), ""
}

func keyStream(t *testing.T, base, path, key string, body any) (int, sseEvents, string) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", base+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		raw, _ := io.ReadAll(res.Body)
		return res.StatusCode, nil, errorCode(raw)
	}
	return 200, readSSE(t, res.Body), ""
}

// ---- environment -------------------------------------------------------------------

// agentEnv is a team with a chat model, an upload source with tagged
// documents, a knowledge base over it, and members of every role.
type agentEnv struct {
	*webEnv
	chat    apitypes.Model
	conn    apitypes.Connection
	upload  apitypes.DataSource
	kb      apitypes.KnowledgeBase
	editor  *session // alex
	member  *session // blair
	tadmin  *session // casey (team admin)
	auditor *session
}

const (
	parkingDoc = "# Parking\n\nStudents must display a valid parking permit decal. Permits are sold by Transportation Services.\n"
	housingDoc = "# Housing\n\nResidence halls open for move-in on August 18. Bring your campus ID card to check in.\n"
	libraryDoc = "Library hours are extended during finals week until two in the morning.\n"
)

func newAgentEnv(t *testing.T) *agentEnv { return newAgentEnvWith(t, nil) }

// newAgentEnvWith also applies mutate to the configuration.
func newAgentEnvWith(t *testing.T, mutate func(*config.Config)) *agentEnv {
	t.Helper()
	env := &agentEnv{webEnv: newWebEnvWith(t, true, mutate)}
	env.proxy.AddChatModel("chat-tools")
	var conns []apitypes.Connection
	if code := env.admin.get("/v1/admin/connections", &conns); code != 200 || len(conns) != 1 {
		t.Fatalf("connections = %d %+v", code, conns)
	}
	env.conn = conns[0]
	code, e := env.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": env.conn.Id, "key": "chat", "upstreamModel": "chat-tools", "displayName": "Chat Tools",
		"kind": "chat", "maxClassification": "sensitive", "contextWindow": 32000, "maxOutputTokens": 4096, "supportsTools": true,
	}, &env.chat, nil)
	mustCode(t, "chat model", code, e, 201, "")

	for _, who := range []struct {
		account, role string
		dst           **session
	}{{"alex", "editor", &env.editor}, {"blair", "member", &env.member}, {"casey", "admin", &env.tadmin}} {
		*who.dst = env.app.signIn(who.account)
		code, e := env.owner.call("POST", env.base+"/members", map[string]string{"email": who.account + "@localhost", "role": who.role}, nil, nil)
		mustCode(t, "add "+who.account, code, e, 201, "")
		(*who.dst).refresh()
	}
	env.auditor = env.app.signIn("auditor")

	code, e = env.owner.call("POST", env.base+"/sources", map[string]any{"name": "Handbook", "classification": "open"}, &env.upload, nil)
	mustCode(t, "upload source", code, e, 201, "")
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	code, results, e := env.owner.uploadFiles(docs, []upload{{"parking.md", []byte(parkingDoc)}}, "")
	if code != 200 || results[0].Status != "created" {
		t.Fatalf("upload = %d %s %+v", code, e, results)
	}
	env.owner.uploadFiles(docs, []upload{{"housing.md", []byte(housingDoc)}, {"library.txt", []byte(libraryDoc)}}, "")
	for _, d := range env.owner.waitForDocuments(t, docs) {
		if d.Status != "ready" {
			t.Fatalf("document %s = %s", d.Filename, d.Status)
		}
	}
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Student help", "topK": 4}, &env.kb, nil)
	mustCode(t, "kb", code, e, 201, "")
	code, e = env.owner.call("PUT", env.base+"/kbs/"+env.kb.Id.String()+"/sources/"+env.upload.Id.String(), nil, &env.kb, nil)
	mustCode(t, "attach", code, e, 200, "")
	return env
}

// agentConfig is a complete draft over kbs.
func (env *agentEnv) agentConfig(kbs ...string) map[string]any {
	list := []map[string]any{}
	for _, id := range kbs {
		list = append(list, map[string]any{"kbId": id})
	}
	return map[string]any{"chatModelId": env.chat.Id, "kbs": list, "instructions": "Be brief and friendly."}
}

// publishAgent creates and publishes an agent (as the editor).
func (env *agentEnv) publishAgent(t *testing.T, name string, cfg map[string]any) apitypes.Agent {
	t.Helper()
	var ag apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": name, "config": cfg}, &ag, nil)
	mustCode(t, "create agent "+name, code, e, 201, "")
	var v apitypes.AgentVersion
	code, e = env.editor.call("POST", env.base+"/agents/"+ag.Id.String()+"/publish", map[string]any{"note": "first"}, &v, nil)
	mustCode(t, "publish "+name, code, e, 201, "")
	env.editor.get(env.base+"/agents/"+ag.Id.String(), &ag)
	return ag
}

func (env *agentEnv) chatPath(slug string) string {
	return "/v1/agents/" + env.team + "/" + slug + "/chat"
}

func (env *agentEnv) scalar(t *testing.T, sql string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := env.app.Pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// systemPrompts returns the system messages of the proxy's chat requests.
func systemPrompts(p *testutil.FakeProxy) []string {
	var out []string
	for _, raw := range p.ChatRequests() {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(raw, &body)
		for _, m := range body.Messages {
			if m.Role == "system" || m.Role == "developer" {
				out = append(out, m.Content)
			}
		}
	}
	return out
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	// A ceiling, not a delay: cond usually holds within a second, but a job
	// picked up by a River worker on a loaded 2-vCPU CI runner under -race
	// can take well over 10 s.
	deadline := time.Now().Add(60 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
