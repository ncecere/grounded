package main

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/demo"
	"github.com/ncecere/grounded/internal/testutil"
)

// clearDemoEnv isolates a test from DEMO_* variables in the environment.
func clearDemoEnv(t *testing.T) {
	for _, kv := range os.Environ() {
		if name, _, _ := strings.Cut(kv, "="); strings.HasPrefix(name, "DEMO_") {
			t.Setenv(name, "")
		}
	}
}

func TestDemoFlags(t *testing.T) {
	clearDemoEnv(t)
	var out bytes.Buffer
	t.Setenv("DEMO_CHAT_KEY", "sk-secret-from-env")
	if _, done, err := parseDemoFlags([]string{"--help"}, &out); err != nil || !done || !strings.Contains(out.String(), "-serve-fake-models") {
		t.Fatalf("help = %v %v %q", done, err, out.String())
	}
	if strings.Contains(out.String(), "sk-secret-from-env") {
		t.Fatal("--help prints a key from the environment")
	}

	f, _, err := parseDemoFlags([]string{"--serve-fake-models", "--fake-addr", ":8099"}, &out)
	if err != nil || f.m.Mode != demo.ModelsFake || f.m.FakeURL != "http://127.0.0.1:8099/v1" {
		t.Fatalf("serve = %+v, %v", f, err)
	}
	// compose.demo.yaml configures the demo service with variables only.
	t.Setenv("DEMO_MODELS", "fake")
	t.Setenv("DEMO_SERVE_FAKE_MODELS", "true")
	t.Setenv("DEMO_FAKE_ADDR", "0.0.0.0:8090")
	t.Setenv("DEMO_FAKE_URL", "http://demo:8090/v1")
	f, _, err = parseDemoFlags(nil, &out)
	if err != nil || !f.serve || f.fakeAddr != "0.0.0.0:8090" || f.m.FakeURL != "http://demo:8090/v1" {
		t.Fatalf("compose env = %+v, %v", f, err)
	}
	t.Setenv("DEMO_SERVE_FAKE_MODELS", "false")
	t.Setenv("DEMO_MODELS", "openai-compatible")
	t.Setenv("DEMO_CHAT_URL", "https://gateway.example.edu/v1")
	t.Setenv("DEMO_CHAT_MODEL", "chat-large")
	t.Setenv("DEMO_EMBED_MODEL", "embed-small")
	t.Setenv("DEMO_EMBED_DIMS", "1024")
	f, _, err = parseDemoFlags([]string{"--chat-model", "chat-from-flag"}, &out)
	if err != nil || f.m.ChatKey != "sk-secret-from-env" || f.m.ChatModel != "chat-from-flag" || f.m.EmbedDims != 1024 || f.m.Mode != demo.ModelsOpenAI {
		t.Fatalf("env = %+v, %v", f, err)
	}

	for _, c := range []struct {
		args []string
		env  map[string]string
		want string
	}{
		{[]string{"--models", "openai-compatible"}, map[string]string{"DEMO_CHAT_URL": "", "DEMO_EMBED_MODEL": ""}, "--chat-url, --embed-model"},
		{[]string{"--models", "local"}, nil, "--models must be"},
		{[]string{"--serve-fake-models", "--models", "openai-compatible"}, nil, "only works with --models=fake"},
		{[]string{"now"}, nil, "unexpected argument"},
		{nil, map[string]string{"DEMO_EMBED_DIMS": "many"}, "DEMO_EMBED_DIMS"},
	} {
		for k, v := range c.env {
			t.Setenv(k, v)
		}
		if _, _, err := parseDemoFlags(c.args, &out); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%v: err = %v, want %q", c.args, err, c.want)
		}
	}
}

// demoEnv points the configuration at a fresh test database.
func demoEnv(t *testing.T) {
	t.Helper()
	clearEnv(t)
	clearDemoEnv(t)
	_, dbURL := testutil.NewDB(t)
	testutil.NewKV(t) // skips the test without Valkey
	t.Setenv("DATABASE_URL", dbURL)
	t.Setenv("VALKEY_URL", os.Getenv("GROUNDED_TEST_VALKEY_URL"))
	t.Setenv("VALKEY_PREFIX", "groundedtest-demo:")
	t.Setenv("ENCRYPTION_KEY", "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=")
	t.Setenv("APP_URL", "http://localhost:8080")
	t.Setenv("DEV_AUTH", "true")
	t.Setenv("BLOB_DIR", t.TempDir())
}

// The command end to end: seed with the fake gateway, then again.
func TestDemoCommand(t *testing.T) {
	demoEnv(t)
	fake := httptest.NewServer(demo.NewFakeModels(demo.FakeAPIKey))
	defer fake.Close()
	// Not crawled (no worker runs), and a host name: the allowlist refuses an address the crawler never fetches,
	// such as an httptest server's 127.0.0.1 (AD-08).
	args := []string{"--models", "fake", "--fake-url", fake.URL + "/v1", "--site-url", "https://docs.example.edu/doc/"}
	var out bytes.Buffer
	if err := runDemo(context.Background(), args, &out); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Seeded the Grounded demo:", "team Demo (owner admin@localhost)", "sign in as admin@localhost",
		"http://localhost:8080/a/demo/go-docs\n", "http://localhost:8080/a/demo/go-docs-signed-in\n", "canned quotes"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output lacks %q:\n%s", want, out.String())
		}
	}
	out.Reset()
	if err := runDemo(context.Background(), args, &out); err != nil || !strings.Contains(out.String(), "already seeded") {
		t.Fatalf("second run = %v\n%s", err, out.String())
	}
}

// --serve-fake-models seeds, then serves the gateway until stopped.
func TestDemoServeFakeModels(t *testing.T) {
	demoEnv(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	out := &syncBuffer{}
	go func() {
		done <- runDemo(ctx, []string{"--serve-fake-models", "--fake-addr", addr, "--site-url", "https://docs.example.edu/doc/"}, out)
	}()
	deadline := time.Now().Add(30 * time.Second)
	for {
		req, _ := http.NewRequest("GET", "http://"+addr+"/v1/models", nil)
		req.Header.Set("Authorization", "Bearer "+demo.FakeAPIKey)
		res, err := http.DefaultClient.Do(req)
		if err == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("fake gateway not serving: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	// Seeding runs while the gateway serves; wait for the command to reach
	// the serving loop, then stop it.
	for !strings.Contains(out.String(), "Serving the fake model gateway") {
		select {
		case err := <-done:
			t.Fatalf("demo stopped early: %v\n%s", err, out.String())
		case <-time.After(50 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatalf("demo did not start serving:\n%s", out.String())
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

// syncBuffer is a bytes.Buffer safe for one writer and one reader.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}
