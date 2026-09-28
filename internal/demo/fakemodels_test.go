package demo

import (
	"context"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

func newFakeClient(t *testing.T) *gateway.Client {
	t.Helper()
	srv := httptest.NewServer(NewFakeModels(FakeAPIKey))
	t.Cleanup(srv.Close)
	return gateway.New(srv.URL+"/v1", FakeAPIKey, 10*time.Second)
}

func TestFakeModelsAuthAndModels(t *testing.T) {
	ctx := context.Background()
	srv := httptest.NewServer(NewFakeModels(FakeAPIKey))
	defer srv.Close()
	if _, err := gateway.New(srv.URL+"/v1", "wrong", 5*time.Second).ListModels(ctx); err == nil {
		t.Fatal("wrong key accepted")
	}
	ids, err := gateway.New(srv.URL+"/v1", FakeAPIKey, 5*time.Second).ListModels(ctx)
	if err != nil || strings.Join(ids, ",") != FakeChatModel+","+FakeEmbedModel {
		t.Fatalf("models = %v, %v", ids, err)
	}
}

func TestFakeEmbeddings(t *testing.T) {
	cl := newFakeClient(t)
	res, err := cl.Embed(context.Background(), gateway.EmbedRequest{Model: FakeEmbedModel,
		Input: []string{"install the Go toolchain", "installing the Go toolchain on Linux", "slices and arrays"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Vectors) != 3 || len(res.Vectors[0]) != FakeEmbedDims {
		t.Fatalf("vectors = %d x %d", len(res.Vectors), len(res.Vectors[0]))
	}
	dot := func(a, b []float32) (s float64) {
		for i := range a {
			s += float64(a[i]) * float64(b[i])
		}
		return s
	}
	if near, far := dot(res.Vectors[0], res.Vectors[1]), dot(res.Vectors[0], res.Vectors[2]); near <= far {
		t.Fatalf("texts sharing words are not closer: %.3f <= %.3f", near, far)
	}
	if _, err := cl.Embed(context.Background(), gateway.EmbedRequest{Model: "other", Input: []string{"x"}}); err == nil {
		t.Fatal("unknown embedding model accepted")
	}
}

func TestFakeChatReplies(t *testing.T) {
	cl := newFakeClient(t)
	ask := func(system, user string) string {
		t.Helper()
		out, err := cl.Complete(context.Background(), gateway.CompleteRequest{Model: FakeChatModel, Messages: []gateway.ChatMessage{
			{Role: "system", Content: system}, {Role: "user", Content: user},
		}})
		if err != nil {
			t.Fatal(err)
		}
		return out.Text
	}
	sources := `<sources>
<source id="1" title="Download and install &amp; setup" url="https://go.dev/doc/install">
# Download and install
Download and install Go quickly with the steps described here. See [the downloads page](https://go.dev/dl/).
</source>
<source id="2" title="Tutorial">
Get started with Go.
</source>
</sources>

How do I install Go?`
	got := ask("Refusal message: \"Not in my sources.\"", sources)
	for _, want := range []string{FakeLabel, "**Download and install & setup**: Download and install Go quickly", "the downloads page", "[1]", "**Tutorial**: Get started with Go. [2]"} {
		if !strings.Contains(got, want) {
			t.Errorf("answer lacks %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "go.dev/dl") {
		t.Errorf("link URL quoted:\n%s", got)
	}
	if got := ask("Refusal message: \"Not in my sources.\"", "What is Rust?"); got != "Not in my sources." {
		t.Errorf("no sources = %q, want the refusal", got)
	}
	if got := ask("You are an assistant.", "What is Rust?"); got != fakeNothing {
		t.Errorf("no sources, no refusal = %q", got)
	}
	if got := ask("You rewrite the user's latest message as a standalone search query.", "and on Windows?"); got != "and on Windows?" {
		t.Errorf("rewrite = %q", got)
	}
	if got := ask("", "Reply with the single word: pong"); got != "pong" {
		t.Errorf("model test = %q", got)
	}
}

func TestFakeChatStreams(t *testing.T) {
	cl := newFakeClient(t)
	st, err := cl.PostStream(context.Background(), "/chat/completions", map[string]any{
		"model": FakeChatModel, "stream": true, "stream_options": map[string]bool{"include_usage": true},
		"messages": []map[string]string{{"role": "user", "content": `<source id="1" title="Tour">A Tour of Go.</source> tour?`}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Body.Close()
	raw, err := io.ReadAll(st.Body)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if st.ContentType != "text/event-stream" || strings.Count(body, "data: ") < 5 || !strings.Contains(body, `"usage"`) ||
		!strings.Contains(body, "Tour") || !strings.HasSuffix(body, "data: [DONE]\n\n") {
		t.Fatalf("stream (%s): %s", st.ContentType, body)
	}
}

func TestPacedFakeModels(t *testing.T) {
	const delay = 20 * time.Millisecond
	srv := httptest.NewServer(NewPacedFakeModels(FakeAPIKey, delay))
	defer srv.Close()
	cl := gateway.New(srv.URL+"/v1", FakeAPIKey, 10*time.Second)
	msg := []map[string]string{{"role": "user", "content": `<source id="1" title="Tour">A Tour of Go.</source> tour?`}}
	start := time.Now()
	st, err := cl.PostStream(context.Background(), "/chat/completions", map[string]any{"model": FakeChatModel, "stream": true, "messages": msg})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(st.Body)
	_ = st.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	// Every word chunk waits; the role and stop chunks do not.
	words := strings.Count(string(raw), `"content":"`) - 1
	if elapsed := time.Since(start); words < 5 || elapsed < time.Duration(words)*delay {
		t.Fatalf("%d words streamed in %s, want at least %s", words, elapsed, time.Duration(words)*delay)
	}
	start = time.Now()
	out, err := cl.Complete(context.Background(), gateway.CompleteRequest{Model: FakeChatModel,
		Messages: []gateway.ChatMessage{{Role: "user", Content: msg[0]["content"]}}})
	if err != nil {
		t.Fatal(err)
	}
	if n := len(strings.Fields(out.Text)); time.Since(start) < time.Duration(n)*delay {
		t.Fatalf("a %d-word JSON reply came back in %s", n, time.Since(start))
	}
}
