package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/tracing/tracingtest"
)

// Tracing (docs/operations/tracing.md): one answer is one trace across
// HTTP, retrieval, model calls and SystemOne; MCP carries trace context in
// _meta both ways; no span carries the question, the answer or a passage.

// traceSpans are one trace's spans.
type traceSpans []sdktrace.ReadOnlySpan

// named returns the first span whose name starts with prefix.
func (ts traceSpans) named(t *testing.T, prefix string) sdktrace.ReadOnlySpan {
	t.Helper()
	for _, sp := range ts {
		if strings.HasPrefix(sp.Name(), prefix) {
			return sp
		}
	}
	t.Fatalf("no span %q in\n%s", prefix, tracingtest.Tree(ts))
	return nil
}

// under checks that child's parent is parent.
func (ts traceSpans) under(t *testing.T, child, parent string) sdktrace.ReadOnlySpan {
	t.Helper()
	c, p := ts.named(t, child), ts.named(t, parent)
	if c.Parent().SpanID() != p.SpanContext().SpanID() {
		t.Errorf("%s is not under %s:\n%s", child, parent, tracingtest.Tree(ts))
	}
	return c
}

// noText fails when a span's name, attributes or events contain any of texts.
func noText(t *testing.T, spans []sdktrace.ReadOnlySpan, texts ...string) {
	t.Helper()
	for _, sp := range spans {
		values := []string{sp.Name(), sp.Status().Description}
		for _, a := range sp.Attributes() {
			values = append(values, a.Value.Emit())
		}
		for _, ev := range sp.Events() {
			values = append(values, ev.Name)
			for _, a := range ev.Attributes {
				values = append(values, a.Value.Emit())
			}
		}
		for _, v := range values {
			for _, text := range texts {
				if strings.Contains(strings.ToLower(v), strings.ToLower(text)) {
					t.Errorf("span %s records %q", sp.Name(), text)
				}
			}
		}
	}
}

func attr(sp sdktrace.ReadOnlySpan, key string) string {
	for _, a := range sp.Attributes() {
		if string(a.Key) == key {
			return a.Value.Emit()
		}
	}
	return ""
}

func TestTracing(t *testing.T) {
	spans := tracingtest.RecordSpans(t)
	env := newSystemOneEnv(t)
	env.putSettings(t, nil)
	ag := env.publishAgent(t, "Fees", env.agentConfig(env.kb.Id.String()))

	t.Run("an answer is one trace", func(t *testing.T) {
		const question = "What is the transcript fee for Zebulon Quixote?"
		caller := "4bf92f3577b34da6a3ce929d0e0e4736"
		code, raw := env.member.raw("POST", env.chatPath(ag.Slug), map[string]any{"message": question},
			map[string]string{"traceparent": "00-" + caller + "-00f067aa0ba902b7-01"})
		if code != 200 || !strings.Contains(string(raw), "RANKHIGH Official transcripts") {
			t.Fatalf("chat = %d %s", code, raw)
		}
		tid, _ := trace.TraceIDFromHex(caller)
		root := spans.Find(t, "POST /v1/agents/{team}/{agent}/chat", func(sp sdktrace.ReadOnlySpan) bool { return sp.SpanContext().TraceID() == tid })
		if root.Parent().SpanID().String() != "00f067aa0ba902b7" || root.SpanKind() != trace.SpanKindServer || attr(root, "http.response.status_code") != "200" {
			t.Fatalf("http span = %v %v", root.Parent(), root.Attributes())
		}
		tr := traceSpans(spans.Trace(tid))
		tr.under(t, "agent.answer", "POST /v1/agents/")
		tr.under(t, "agent.retrieve", "agent.answer")
		tr.under(t, "retrieval.search", "agent.retrieve")
		for _, step := range []string{"retrieval.vector", "retrieval.lexical", "retrieval.fusion", "embeddings "} {
			tr.under(t, step, "retrieval.search")
		}
		tr.under(t, "systemone judging", "agent.retrieve")
		tr.under(t, "agent.turn", "agent.answer")
		model := tr.under(t, "chat chat-tools", "agent.turn")
		if attr(model, "gen_ai.usage.output_tokens") == "" || attr(model, "grounded.llm.time_to_first_token_ms") == "" {
			t.Errorf("model span = %v", model.Attributes())
		}
		if s := tr.named(t, "retrieval.search"); attr(s, "grounded.kb_id") != env.kb.Id.String() || attr(s, "grounded.retrieval.results") == "0" {
			t.Errorf("search span = %v", s.Attributes())
		}
		// Never the question, the answer or a passage.
		noText(t, spans.Ended(), "Zebulon", "transcript fee", "Official transcripts", "free since 2020")
	})

	t.Run("the MCP server continues _meta.traceparent", func(t *testing.T) {
		setMCP(t, env.admin, true)
		key := createKey(t, env.member, env.base, map[string]any{"name": "assistant", "scopes": []string{"mcp"}})
		caller := "0af7651916cd43dd8448eb211c80319c"
		client := mcp.NewClient(&mcp.Implementation{Name: "traced-client", Version: "1.0.0"}, nil)
		client.AddSendingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
			return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
				if p, ok := req.GetParams().(*mcp.CallToolParams); ok && p != nil {
					meta := map[string]any{"traceparent": "00-" + caller + "-b7ad6b7169203331-01"}
					for k, v := range p.GetMeta() {
						meta[k] = v
					}
					p.SetMeta(meta)
				}
				return next(ctx, method, req)
			}
		})
		tr := &mcp.StreamableClientTransport{Endpoint: env.app.URL + "/mcp", HTTPClient: &http.Client{Transport: bearer{key.Secret}}, DisableStandaloneSSE: true}
		cs, err := client.Connect(t.Context(), tr, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer cs.Close()
		if res := callTool(t, cs, "search", map[string]any{"knowledge_base": "student-help", "query": "Zebulon parking permits"}, nil); res.IsError {
			t.Fatalf("search = %s", toolText(res))
		}
		tid, _ := trace.TraceIDFromHex(caller)
		sp := spans.Find(t, "tools/call search", func(sp sdktrace.ReadOnlySpan) bool { return sp.SpanContext().TraceID() == tid })
		if sp.Parent().SpanID().String() != "b7ad6b7169203331" || len(sp.Links()) != 1 {
			t.Fatalf("tools/call span: parent %v, links %v", sp.Parent(), sp.Links())
		}
		// Linked to the HTTP request's span, which has its own trace (the client sent no traceparent header).
		httpSpan := spans.Find(t, "POST /mcp", func(h sdktrace.ReadOnlySpan) bool {
			return h.SpanContext().SpanID() == sp.Links()[0].SpanContext.SpanID()
		})
		if httpSpan.SpanContext().TraceID() == tid {
			t.Fatal("the HTTP span took the _meta trace")
		}
		traceSpans(spans.Trace(tid)).under(t, "retrieval.search", "tools/call search")
		noText(t, spans.Ended(), "Zebulon")
	})

	t.Run("the MCP client sends traceparent in _meta and headers", func(t *testing.T) {
		m := &mcpEnv{agentEnv: env.agentEnv, fake: testutil.NewFakeMCP(t)}
		code, e := env.admin.call("POST", "/v1/admin/mcp-servers", map[string]any{"name": "Service status", "url": m.fake.URL(),
			"maxClassification": "open", "timeoutSeconds": 2}, &m.server, nil)
		mustCode(t, "create MCP server", code, e, 201, "")
		m.refresh(t)
		m.approve(t, "check_outage")
		tool := m.toolAgent(t, "Status helper", []string{"check_outage"}, testutil.FakeToolCall{Name: "check_outage", Args: `{"service":"email"}`})
		if code, _, errCode := env.member.stream(env.chatPath(tool.Slug), map[string]any{"message": "Is email down for Zebulon?"}); code != 200 {
			t.Fatalf("chat = %d %s", code, errCode)
		}
		calls := m.fake.Calls()
		if len(calls) != 1 {
			t.Fatalf("calls = %+v", calls)
		}
		sp := spans.Find(t, "tools/call check_outage", nil)
		tid := sp.SpanContext().TraceID().String()
		meta, _ := calls[0].Meta["traceparent"].(string)
		if !strings.Contains(meta, tid) || !strings.Contains(calls[0].Header.Get("traceparent"), tid) {
			t.Fatalf("traceparent: _meta %q, header %q, trace %s", meta, calls[0].Header.Get("traceparent"), tid)
		}
		tr := traceSpans(spans.Trace(sp.SpanContext().TraceID()))
		tr.under(t, "tools/call check_outage", "execute_tool check_outage")
		tr.under(t, "execute_tool check_outage", "agent.turn")
		if attr(sp, "grounded.mcp.server") != "Service status" || attr(sp, "grounded.mcp.outcome") != "ok" {
			t.Errorf("tools/call span = %v", sp.Attributes())
		}
		noText(t, spans.Ended(), "Zebulon", "operating normally")
	})
}
