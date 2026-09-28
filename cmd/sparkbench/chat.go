package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// Grounded's search_knowledge tool (internal/agents/prompt.go).
const searchToolDescription = "Search the team's knowledge bases. Returns numbered sources inside <sources> ... </sources>; " +
	"cite them as [n]. Use a short, specific query."

var searchToolSchema = json.RawMessage(`{
  "type": "object",
  "properties": {
    "query": {"type": "string", "minLength": 1, "maxLength": 1000, "description": "What to search for"},
    "maxResults": {"type": "integer", "minimum": 1, "maximum": 20, "description": "How many sources to return (optional)"}
  },
  "required": ["query"],
  "additionalProperties": false
}`)

func searchTool() []map[string]any {
	return []map[string]any{{"type": "function", "function": map[string]any{
		"name": "search_knowledge", "description": searchToolDescription, "parameters": searchToolSchema,
	}}}
}

const probeSources = `<sources>
<source id="1" title="Drop/Add" section="Registration › Drop/Add" url="https://registrar.example.edu/registration/drop-add">
Drop/add is the period at the start of each term when students can change their schedule without fees or penalties. Drop/add ends at 11:59 p.m. on the fifth day of classes in fall and spring terms.
</source>
</sources>`

func cmdChatProbe(args []string) error {
	fs := flag.NewFlagSet("chat-probe", flag.ExitOnError)
	name := fs.String("endpoint", "spark-chat", "endpoint: spark-chat or gateway-chat")
	rpm := fs.Int("rpm", 0, "pace requests (use <= 100 for a 120/min gateway key)")
	fixtures := fs.String("fixtures", "/tmp/sparkbench/fixtures", "directory for recorded SSE streams (outside the repo)")
	only := fs.String("only", "", "comma-separated check names to run (default all)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), `usage: sparkbench chat-probe [flags]

Checks how a chat endpoint behaves for Grounded's runtime (internal/llm): streamed
text with stream_options.include_usage, the reasoning delta field, a
search_knowledge tool call and the follow-up turn with the tool result,
tool_choice "required", usage without stream_options, max_tokens vs
max_completion_tokens, the developer role, reasoning_effort, and
chat_template_kwargs.enable_thinking. Streams of the text, tool-call and
tool-result checks are recorded as <model>_{text,toolcall,toolresult}.sse.
Checks: text, toolcall, toolresult, required, auto, nousage, maxtokens,
maxcompletion, developer, effort, nothink.`)
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	ctx := context.Background()
	e, err := newEndpoint(*name, *rpm)
	if err != nil {
		return err
	}
	want := map[string]bool{}
	for _, s := range strings.Split(*only, ",") {
		if s = strings.TrimSpace(s); s != "" {
			want[s] = true
		}
	}
	fixture := func(kind string) string {
		m := strings.NewReplacer(".", "", "-", "").Replace(e.model)
		return filepath.Join(*fixtures, m+"_"+kind+".sse")
	}
	checks, toolMsgs := probeChecks(fixture)
	usage := map[string]any{"include_usage": true}
	var toolRes streamResult
	for _, c := range checks {
		if len(want) > 0 && !want[c.name] && !(c.name == "toolcall" && want["toolresult"]) {
			continue
		}
		r, err := e.streamChat(ctx, c.body, c.rec)
		report(c.name, r, err)
		if c.name == "toolcall" {
			toolRes = r
		}
	}
	if (len(want) == 0 || want["toolresult"]) && len(toolRes.ToolCalls) > 0 {
		tc := toolRes.ToolCalls[0]
		msgs := append(append([]map[string]any(nil), toolMsgs...),
			map[string]any{"role": "assistant", "content": nil, "tool_calls": []map[string]any{{"id": tc.ID, "type": "function", "function": map[string]any{"name": tc.Name, "arguments": tc.Args}}}},
			map[string]any{"role": "tool", "tool_call_id": tc.ID, "content": probeSources})
		r, err := e.streamChat(ctx, map[string]any{"messages": msgs, "tools": searchTool(), "stream_options": usage}, fixture("toolresult"))
		report("toolresult", r, err)
	}
	return nil
}

// probeCheck is one chat-probe request; rec is its fixture path, if any.
type probeCheck struct {
	name string
	body map[string]any
	rec  string
}

// probeChecks are the chat-probe requests, and the messages of the tool-call
// check (the tool-result turn continues them).
func probeChecks(fixture func(string) string) ([]probeCheck, []map[string]any) {
	sys := "You are Registrar assistant, an assistant provided by Office of the Registrar at Example University. " +
		"Cite sources as [n]. Use the search_knowledge tool to find sources before you answer a question about the team's subject."
	q := "When does drop/add end?"
	usage := map[string]any{"include_usage": true}
	msgs := func(pairs ...string) []map[string]any {
		var out []map[string]any
		for i := 0; i+1 < len(pairs); i += 2 {
			out = append(out, map[string]any{"role": pairs[i], "content": pairs[i+1]})
		}
		return out
	}
	grounded := msgs("system", sys, "user", probeSources+"\n\n"+q)
	smallTalk := msgs("system", sys, "user", "Hi! Thanks for your help earlier.")
	toolMsgs := msgs("system", sys, "user", q)
	return []probeCheck{
		{"text", map[string]any{"messages": grounded, "stream_options": usage}, fixture("text")},
		{"toolcall", map[string]any{"messages": toolMsgs, "tools": searchTool(), "stream_options": usage}, fixture("toolcall")},
		{"required", map[string]any{"messages": smallTalk, "tools": searchTool(), "tool_choice": "required", "stream_options": usage}, ""},
		{"auto", map[string]any{"messages": smallTalk, "tools": searchTool(), "stream_options": usage}, ""},
		{"nousage", map[string]any{"messages": msgs("user", "Say hello in three words.")}, ""},
		{"maxtokens", map[string]any{"messages": msgs("user", probeSources+"\n\n"+q), "max_tokens": 64, "stream_options": usage}, ""},
		{"maxcompletion", map[string]any{"messages": msgs("user", probeSources+"\n\n"+q), "max_completion_tokens": 64, "stream_options": usage}, ""},
		{"developer", map[string]any{"messages": msgs("developer", "Answer in exactly one word.", "user", "What colour is the sky?"), "stream_options": usage}, ""},
		{"effort", map[string]any{"messages": grounded, "reasoning_effort": "low", "stream_options": usage}, ""},
		{"nothink", map[string]any{"messages": grounded, "chat_template_kwargs": map[string]any{"enable_thinking": false}, "stream_options": usage}, ""},
	}, toolMsgs
}

func report(name string, r streamResult, err error) {
	if err != nil {
		fmt.Printf("%-13s ERROR %v\n", name, err)
		return
	}
	var tcs []string
	for _, t := range r.ToolCalls {
		valid := json.Valid([]byte(t.Args))
		tcs = append(tcs, fmt.Sprintf("%s(%s) id=%q validJSON=%v", t.Name, truncate(t.Args, 80), t.ID, valid))
	}
	fmt.Printf("%-13s finish=%s first=%s total=%s chunks=%d usage(prompt=%d out=%d reasoning=%d inChunk=%v final=%v) reasoningField=%q reasoningChars=%d\n              content=%q\n              toolCalls=%v\n",
		name, r.FinishReason, r.FirstAny.Round(time.Millisecond), r.Total.Round(time.Millisecond), r.Chunks, r.PromptTokens, r.OutputTokens, r.ReasonTokens,
		r.UsageInChunk, r.UsageInFinal, r.ReasoningField, len(r.Reasoning), truncate(strings.TrimSpace(r.Content), 300), tcs)
}
