package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
)

func cmdReplay(args []string) error {
	fs := flag.NewFlagSet("replay", flag.ExitOnError)
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: sparkbench replay <file.sse>...\n\nServes each recorded stream from a local test server and parses it with\nGrounded's own provider (internal/llm.OpenAI, default compat flags). Prints the\nevent counts, the final message's blocks, usage and stop reason, so a new\ngateway's streams can be checked against Grounded without calling it.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	if fs.NArg() == 0 {
		fs.Usage()
		return nil
	}
	for _, path := range fs.Args() {
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.Copy(io.Discard, r.Body)
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write(raw)
		}))
		p := llm.NewOpenAI(gateway.New(srv.URL, "unused", 10*time.Second))
		ch := p.Stream(context.Background(), llm.Model{ID: "replay", Compat: llm.ResolveCompat(llm.CompatOverrides{})},
			llm.Context{SystemPrompt: "replay", Messages: []llm.Message{llm.UserMessage{Content: "replay"}},
				Tools: []llm.Tool{{Name: "search_knowledge", Description: searchToolDescription, Parameters: searchToolSchema}}},
			llm.Options{})
		counts := map[llm.EventType]int{}
		var last llm.Event
		for ev := range ch {
			counts[ev.Type]++
			last = ev
		}
		srv.Close()
		var names []string
		for t, n := range counts {
			names = append(names, fmt.Sprintf("%s=%d", t, n))
		}
		sort.Strings(names)
		fmt.Printf("%s\n  events: %v\n  terminal: %s reason=%s err=%v\n  usage: %+v\n", path, names, last.Type, last.Reason, last.Err, last.Message.Usage)
		for i, b := range last.Message.Content {
			switch v := b.(type) {
			case llm.Text:
				fmt.Printf("  block %d text: %q\n", i, truncate(v.Text, 200))
			case llm.Thinking:
				fmt.Printf("  block %d thinking: %d chars\n", i, len(v.Text))
			case llm.ToolCall:
				fmt.Printf("  block %d toolCall: id=%q name=%s args=%s\n", i, v.ID, v.Name, v.Arguments)
			}
		}
	}
	return nil
}
