// netprobe is a test-only connectivity client copied into disposable pods by
// the OCR NetworkPolicy acceptance test. It is not in a shipped image.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"
)

type result struct {
	Action string `json:"action"`
	Target string `json:"target"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

func main() {
	if len(os.Args) != 3 || (os.Args[1] != "tcp" && os.Args[1] != "dns" && os.Args[1] != "http") {
		fmt.Fprintln(os.Stderr, "usage: netprobe tcp|dns|http target")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	r := result{Action: os.Args[1], Target: os.Args[2]}
	if err := check(ctx, r.Action, r.Target); err != nil {
		r.Error = err.Error()
	} else {
		r.OK = true
	}
	if err := json.NewEncoder(os.Stdout).Encode(r); err != nil {
		os.Exit(2)
	}
	if !r.OK {
		os.Exit(1)
	}
}

func check(ctx context.Context, action, target string) error {
	switch action {
	case "tcp":
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", target)
		if err != nil {
			return err
		}
		_ = conn.Close()
		return nil
	case "dns":
		_, err := net.DefaultResolver.LookupHost(ctx, target)
		return err
	case "http":
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return err
		}
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		res, err := client.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return fmt.Errorf("HTTP %d, want 200", res.StatusCode)
		}
		return nil
	default:
		return fmt.Errorf("unknown action %q", action)
	}
}
