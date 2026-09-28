package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"time"
)

// state records what setup created and when uploads ran, so later commands
// (and re-runs) reuse the same team, source and knowledge base.
type state struct {
	Base         string    `json:"base"`
	ConnectionID string    `json:"connectionId,omitempty"`
	ModelID      string    `json:"modelId,omitempty"`
	ProfileID    string    `json:"profileId,omitempty"`
	Team         string    `json:"team,omitempty"`
	SourceID     string    `json:"sourceId,omitempty"`
	KBID         string    `json:"kbId,omitempty"`
	UploadStart  time.Time `json:"uploadStart,omitzero"`
	UploadEnd    time.Time `json:"uploadEnd,omitzero"`
	Uploaded     int       `json:"uploaded,omitempty"`
	IngestDone   time.Time `json:"ingestDone,omitzero"`
}

func loadState(path string) (state, error) {
	var s state
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	} else if err != nil {
		return s, err
	}
	return s, json.Unmarshal(b, &s)
}

func saveState(path string, s state) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o600)
}

// client talks to Grounded's public API with a dev-login session.
type client struct {
	base string
	http *http.Client
	csrf string
}

// apiError is a non-2xx Grounded response.
type apiError struct {
	Status int
	Code   string
	Body   string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("HTTP %d %s: %s", e.Status, e.Code, e.Body)
}

func newClient(base, account string) (*client, error) {
	jar, _ := cookiejar.New(nil)
	c := &client{base: strings.TrimRight(base, "/"), http: &http.Client{Jar: jar, Timeout: 10 * time.Minute}}
	if err := c.do("POST", "/auth/dev", map[string]string{"account": account}, nil); err != nil {
		return nil, fmt.Errorf("dev login (is DEV_AUTH=true?): %w", err)
	}
	var me struct {
		CsrfToken string `json:"csrfToken"`
	}
	if err := c.do("GET", "/v1/me", nil, &me); err != nil {
		return nil, err
	}
	c.csrf = me.CsrfToken
	return c, nil
}

// do sends a JSON request and decodes the "data" envelope (or the whole
// body when there is no envelope) into out.
func (c *client) do(method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.send(req, out)
}

func (c *client) send(req *http.Request, out any) error {
	req.Header.Set("Origin", c.base)
	if c.csrf != "" {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		var e struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return &apiError{Status: resp.StatusCode, Code: e.Error.Code, Body: truncate(string(raw), 500)}
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(raw, &env) == nil && len(env.Data) > 0 {
		raw = env.Data
	}
	return json.Unmarshal(raw, out)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
