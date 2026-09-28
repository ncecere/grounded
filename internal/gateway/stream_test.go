package gateway_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

func TestPostStream(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/ok":
			if r.Header.Get("Authorization") != "Bearer k" || r.Header.Get("Accept") != "text/event-stream" {
				w.WriteHeader(401)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			for i := 0; i < 4; i++ { // the body takes longer than the timeout
				_, _ = io.WriteString(w, "data: x\n\n")
				w.(http.Flusher).Flush()
				time.Sleep(40 * time.Millisecond)
			}
		case "/v1/slow":
			_, _ = io.Copy(io.Discard, r.Body) // lets the server notice the client going away
			select {
			case <-r.Context().Done():
			case <-time.After(2 * time.Second):
			}
		default:
			w.WriteHeader(429)
			_, _ = io.WriteString(w, `{"error":{"message":"slow down"}}`)
		}
	}))
	defer srv.Close()
	c := gateway.New(srv.URL+"/v1", "k", 100*time.Millisecond)
	ctx := context.Background()

	res, err := c.PostStream(ctx, "/ok", map[string]any{"stream": true})
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil || len(body) != 4*len("data: x\n\n") || res.ContentType != "text/event-stream" || res.Status != 200 {
		t.Fatalf("body %q err %v res %+v", body, err, res)
	}

	_, err = c.PostStream(ctx, "/limited", map[string]any{})
	var ge *gateway.Error
	if !errors.As(err, &ge) || ge.Kind != gateway.KindRateLimited || ge.Message != "slow down" {
		t.Fatalf("429: %v", err)
	}

	_, err = c.PostStream(ctx, "/slow", map[string]any{})
	if !errors.As(err, &ge) || !ge.TimedOut() || !strings.Contains(ge.Message, "waiting for the response") {
		t.Fatalf("header timeout: %v", err)
	}

	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = c.PostStream(cctx, "/ok", map[string]any{}); !errors.As(err, &ge) || ge.Kind != gateway.KindUnavailable {
		t.Fatalf("cancelled: %v", err)
	}
	if _, err = gateway.New("://bad", "", time.Second).PostStream(ctx, "/x", nil); !errors.As(err, &ge) || ge.Kind != gateway.KindBadRequest {
		t.Fatalf("bad url: %v", err)
	}
	if _, err = c.PostStream(ctx, "/x", func() {}); err == nil {
		t.Fatal("unencodable body must fail")
	}
	// A zero Client without an HTTP client still works (no timeout).
	zero := &gateway.Client{BaseURL: srv.URL + "/v1", APIKey: "k"}
	if res, err := zero.PostStream(ctx, "/ok", nil); err != nil {
		t.Fatal(err)
	} else {
		res.Body.Close()
	}
}
