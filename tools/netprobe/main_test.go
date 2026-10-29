package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckTCPAndHTTP(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ok" {
			w.WriteHeader(http.StatusOK)
		} else if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/ok", http.StatusFound)
		} else {
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	defer s.Close()
	if err := check(t.Context(), "tcp", s.Listener.Addr().String()); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path string
		ok   bool
	}{{"/ok", true}, {"/refused", false}, {"/redirect", false}} {
		if err := check(t.Context(), "http", s.URL+tc.path); (err == nil) != tc.ok {
			t.Fatalf("%s: %v", tc.path, err)
		}
	}
}

func TestCheckFailuresAreNotSuccess(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()
	if err := check(t.Context(), "tcp", addr); err == nil {
		t.Fatal("closed port reported reachable")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := check(ctx, "tcp", addr); err == nil {
		t.Fatal("cancelled probe succeeded")
	}
	if err := check(t.Context(), "http", "://bad-url"); err == nil {
		t.Fatal("invalid HTTP target succeeded")
	}
	if err := check(t.Context(), "unknown", "unused"); err == nil {
		t.Fatal("unknown action succeeded")
	}
}
