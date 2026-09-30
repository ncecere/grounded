package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
)

func TestHandles(t *testing.T) {
	h := NewHandles([]byte("0123456789abcdef0123456789abcdef"))
	key, other, conv := uuid.New(), uuid.New(), uuid.New()
	handle := h.Mint(key, conv)
	if !strings.HasPrefix(handle, "c1_") || strings.Contains(handle, conv.String()) {
		t.Fatalf("handle = %q", handle)
	}
	if got, ok := h.Open(key, handle); !ok || got != conv {
		t.Fatalf("open = %v %v", got, ok)
	}
	if _, ok := h.Open(other, handle); ok {
		t.Error("another key opened the handle")
	}
	if _, ok := NewHandles([]byte("another secret")).Open(key, handle); ok {
		t.Error("a handle outlived its secret")
	}
	tampered := []byte(handle)
	tampered[5] ^= 1
	for _, bad := range []string{string(tampered), "", "c1_", "c1_!!!", conv.String(), handle + "x"} {
		if _, ok := h.Open(key, bad); ok {
			t.Errorf("opened %q", bad)
		}
	}
}

func TestKeyCallerActsAsAQueryKey(t *testing.T) {
	kb := uuid.New()
	a := authz.Actor{UserID: uuid.New(), Key: &authz.KeyGrant{ID: uuid.New(), TeamID: uuid.New(), Scopes: []string{"manage", "mcp"},
		KBIDs: []uuid.UUID{kb}, Kind: "personal"}}
	c := NewKeyCaller(a)
	got := c.Actor()
	if strings.Join(got.Key.Scopes, ",") != "query" || authz.RoleForKey(got.Key) != authz.RoleMember || !got.Key.AllowsKB(kb) || got.Key.AllowsKB(uuid.New()) {
		t.Fatalf("acts as %+v", got.Key)
	}
	if strings.Join(a.Key.Scopes, ",") != "manage,mcp" {
		t.Error("the key's own grant changed")
	}
	if c.Binding() != a.Key.ID || c.Stateless() {
		t.Errorf("binding %v stateless %v", c.Binding(), c.Stateless())
	}
	a.Key.Kind = "service"
	if !NewKeyCaller(a).Stateless() {
		t.Error("a service key keeps conversations")
	}
}

func TestOptions(t *testing.T) {
	for in, want := range map[string]string{
		"Student handbook": "student-handbook", "  IT: How-To's ": "it-how-to-s", "Café Menü 2026": "café-menü-2026", "!!!": "",
		strings.Repeat("ab ", 40): strings.TrimRight(strings.Repeat("ab-", 20), "-"),
	} {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	opts := kbOptions([]KnowledgeBase{{ID: a, Name: "A & B"}, {ID: b, Name: "A-B"}, {ID: c, Name: "???", Description: "First line.\nSecond line."}})
	if opts[0].Slug != "a-b-"+a.String()[:8] || opts[1].Slug != "a-b-"+b.String()[:8] || opts[2].Slug != c.String()[:8] {
		t.Errorf("slugs = %s %s %s", opts[0].Slug, opts[1].Slug, opts[2].Slug)
	}
	// A person's (OAuth) names start with the team's slug, however many teams they're in.
	opts2 := kbOptions([]KnowledgeBase{{ID: a, Name: "Student help", TeamSlug: "registrar"}, {ID: b, Name: "Student help", TeamSlug: "library"},
		{ID: c, Name: "???", TeamSlug: "library"}})
	if opts2[0].Slug != "registrar/student-help" || opts2[1].Slug != "library/student-help" || opts2[2].Slug != "library/"+c.String()[:8] {
		t.Errorf("team slugs = %s %s %s", opts2[0].Slug, opts2[1].Slug, opts2[2].Slug)
	}
	ags := agentOptions([]Agent{{ID: a, Slug: "helper", TeamSlug: "registrar"}, {ID: b, Slug: "helper", TeamSlug: "library"}, {ID: c, Slug: "helper"}})
	if ags[0].Slug != "registrar/helper" || ags[1].Slug != "library/helper" || ags[2].Slug != "helper" {
		t.Errorf("agent slugs = %s %s %s", ags[0].Slug, ags[1].Slug, ags[2].Slug)
	}
	if d := describe(opts[2:]); d != "\n- "+c.String()[:8]+": ??? — First line." {
		t.Errorf("describe = %q", d)
	}
	if d := firstLine(strings.Repeat("x", 300)); len([]rune(d)) != maxOptionText || !strings.HasSuffix(d, "…") {
		t.Errorf("long description = %q", d)
	}
}

func TestText(t *testing.T) {
	kb := option{Slug: "handbook", Name: "Handbook"}
	if got := searchText(kb, SearchResult{}); got != "No passages in Handbook matched the query." {
		t.Errorf("empty = %q", got)
	}
	got := searchText(kb, SearchResult{Passages: []Passage{
		{N: 1, Title: "Parking", HeadingPath: []string{"Permits"}, URL: "https://www.example.edu/parking", Text: " Permits are sold online. "},
		{N: 2, Filename: "guide.pdf", HeadingPath: []string{}, PageStart: 3, PageEnd: 4, Text: "Bring your ID."},
	}})
	want := "2 passages from Handbook. Cite them by their [n] numbers.\n\n[1] Parking › Permits <https://www.example.edu/parking>\n" +
		"Permits are sold online.\n\n[2] guide.pdf (pages 3–4)\nBring your ID."
	if got != want {
		t.Errorf("search text =\n%s\nwant\n%s", got, want)
	}
	got = askText(AskResult{Answer: "Buy one online [1].", Citations: []Citation{{N: 1, Title: "Parking", HeadingPath: []string{}, Verification: "verified"}},
		Claims: []Claim{{Text: "Buy one online.", Verdict: "supported"}, {Text: "It's free.", Verdict: "not_supported"}}, Conversation: "c1_x"})
	want = "Buy one online [1].\n\nSources:\n[1] Parking (verified)\n\nClaims checked: 1 of 2 supported.\n- not supported: It's free.\n\n" +
		"To follow up, ask again with conversation: c1_x"
	if got != want {
		t.Errorf("ask text =\n%s\nwant\n%s", got, want)
	}
	// One passage is "1 passage".
	if got := searchText(kb, SearchResult{Passages: []Passage{{N: 1, Title: "Parking", HeadingPath: []string{}, Text: "x"}}}); !strings.HasPrefix(got,
		"1 passage from Handbook. Cite it by its [n] number.") {
		t.Errorf("one passage = %q", got)
	}
}

// ask's citations: an upload's filename, like search; a tool's result is
// kind tool with its server and tool, and no (zero) document ID.
func TestAskCitations(t *testing.T) {
	doc := uuid.New()
	tc := &toolCall{} // no conversation, so no caller
	res := tc.askResult(option{Slug: "helper"}, agents.Answer{Text: "Email is up [1]. Wi-Fi help [2].", Citations: []agents.Citation{
		{N: 1, Title: "Service status · check_outage", Kind: agents.SourceTool, Server: "Service status", Tool: "check_outage", Snippet: "Email: ok"},
		{N: 2, DocumentID: doc, Title: "Wi-Fi", Filename: "wifi.md", HeadingPath: []string{"Setup"}, Snippet: "Connect to eduroam."},
	}})
	tool, passage := res.Citations[0], res.Citations[1]
	if tool.Kind != "tool" || tool.DocumentID != "" || tool.Server != "Service status" || tool.Tool != "check_outage" {
		t.Errorf("tool citation = %+v", tool)
	}
	if passage.Kind != "document" || passage.DocumentID != doc.String() || passage.Filename != "wifi.md" {
		t.Errorf("passage citation = %+v", passage)
	}
	raw, _ := json.Marshal(tool)
	if strings.Contains(string(raw), "document_id") || strings.Contains(string(raw), uuid.Nil.String()) {
		t.Errorf("tool citation JSON = %s", raw)
	}
	if got := askText(res); !strings.Contains(got, "[1] Service status · check_outage (tool result)") || !strings.Contains(got, "[2] Wi-Fi › Setup") {
		t.Errorf("ask text = %q", got)
	}
}

// fakeBackend serves fixed lists and records audit entries.
type fakeBackend struct {
	kbs     []KnowledgeBase
	agents  []Agent
	hits    []kbs.Hit
	searchE error
	answer  agents.Answer
	mu      sync.Mutex
	audited []audit.Entry
}

func (f *fakeBackend) KnowledgeBases(context.Context, authz.Actor) ([]KnowledgeBase, error) {
	return f.kbs, nil
}
func (f *fakeBackend) Agents(context.Context, authz.Actor) ([]Agent, error) { return f.agents, nil }
func (f *fakeBackend) Search(context.Context, authz.Actor, uuid.UUID, string, int) ([]kbs.Hit, error) {
	return f.hits, f.searchE
}
func (f *fakeBackend) Ask(context.Context, authz.Actor, uuid.UUID, string, *uuid.UUID) (agents.Answer, error) {
	return f.answer, nil
}
func (f *fakeBackend) Audit(_ context.Context, e audit.Entry) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.audited = append(f.audited, e)
	return nil
}

// connect serves For's server to an in-memory client.
func connect(t *testing.T, b Backend, c Caller) *mcp.ClientSession {
	t.Helper()
	srv, err := New(Options{Backend: b, Handles: NewHandles([]byte("s")), Version: "test"}).For(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	st, ct := mcp.NewInMemoryTransports()
	if _, err := srv.Connect(context.Background(), st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(context.Background(), ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

func testCaller(kind string) Caller {
	return NewKeyCaller(authz.Actor{UserID: uuid.New(), Key: &authz.KeyGrant{ID: uuid.New(), TeamID: uuid.New(), Scopes: []string{"mcp"}, Kind: kind}})
}

func TestToolsFollowWhatTheCallerMayUse(t *testing.T) {
	kb := KnowledgeBase{ID: uuid.New(), Name: "Handbook", Description: "Policies for students."}
	ag := Agent{ID: uuid.New(), Slug: "helper", Name: "Helper"}
	for _, tc := range []struct {
		name string
		b    *fakeBackend
		want string
	}{
		{"both", &fakeBackend{kbs: []KnowledgeBase{kb}, agents: []Agent{ag}}, "ask,search"},
		{"no agents", &fakeBackend{kbs: []KnowledgeBase{kb}}, "search"},
		{"no knowledge bases", &fakeBackend{agents: []Agent{ag}}, "ask"},
		{"nothing", &fakeBackend{}, ""},
	} {
		res, err := connect(t, tc.b, testCaller("personal")).ListTools(context.Background(), nil)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		var names []string
		for _, tool := range res.Tools {
			names = append(names, tool.Name)
		}
		if strings.Join(names, ",") != tc.want {
			t.Errorf("%s: tools = %v", tc.name, names)
		}
	}
}

func TestRefusalsAreToolErrors(t *testing.T) {
	kb := KnowledgeBase{ID: uuid.New(), Name: "Handbook"}
	b := &fakeBackend{kbs: []KnowledgeBase{kb}, searchE: apperr.New(429, "budget_exhausted", "This team's monthly budget is used up.")}
	cs := connect(t, b, testCaller("personal"))
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "search", Arguments: map[string]any{"knowledge_base": "handbook", "query": "fees"}})
	if err != nil || !res.IsError || res.Content[0].(*mcp.TextContent).Text != "This team's monthly budget is used up." {
		t.Fatalf("budget = %+v %v", res, err)
	}
	b.searchE = errors.New("connection reset by peer")
	res, _ = cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "search", Arguments: map[string]any{"knowledge_base": "handbook", "query": "fees"}})
	if !res.IsError || strings.Contains(res.Content[0].(*mcp.TextContent).Text, "peer") {
		t.Errorf("an internal error leaked: %+v", res.Content[0])
	}
	if len(b.audited) != 2 || b.audited[0].Action != "mcp.search" || b.audited[0].Metadata["outcome"] != outcomeRefused ||
		b.audited[0].Metadata["error"] != "budget_exhausted" || b.audited[1].Metadata["outcome"] != outcomeError || b.audited[0].ActorKind != audit.ActorAPIKey {
		t.Errorf("audited = %+v", b.audited)
	}
}

func TestAskAnswerFailures(t *testing.T) {
	ag := Agent{ID: uuid.New(), Slug: "helper", Name: "Helper"}
	b := &fakeBackend{agents: []Agent{ag}, answer: agents.Answer{ErrorCode: agents.ErrCodeModelUnavailable, ErrorMessage: "The chat model is unavailable."}}
	cs := connect(t, b, testCaller("service"))
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "ask", Arguments: map[string]any{"agent": "helper", "question": "Hi"}})
	if err != nil || !res.IsError || res.Content[0].(*mcp.TextContent).Text != "The chat model is unavailable." {
		t.Fatalf("unavailable = %+v %v", res, err)
	}
	conv := uuid.New()
	b.answer = agents.Answer{Text: "Hello.", ConversationID: &conv}
	res, _ = cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "ask", Arguments: map[string]any{"agent": "helper", "question": "Hi"}})
	if res.IsError || strings.Contains(res.Content[0].(*mcp.TextContent).Text, "conversation") {
		t.Errorf("a service key got a handle: %+v", res.Content[0])
	}
}
