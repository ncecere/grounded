package config

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

// exampleEnv reads the KEY=value lines of the repository's .env.example.
func exampleEnv(t *testing.T) map[string]string {
	t.Helper()
	f, err := os.Open("../../.env.example")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if k, v, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") {
			out[k] = v
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// The compiled-in hashes must match the keys .env.example ships with; if
// the example keys change, update exampleKeyHashes.
func TestExampleKeyHashesMatchEnvExample(t *testing.T) {
	ex := exampleEnv(t)
	for setting := range exampleKeyHashes {
		v := ex[setting]
		if v == "" {
			t.Fatalf(".env.example has no %s", setting)
		}
		if !isExampleKey(setting, v) {
			t.Errorf("exampleKeyHashes[%s] does not match .env.example; update it to the SHA-256 of the decoded key", setting)
		}
	}
}

func TestSafetyChecks(t *testing.T) {
	ex := exampleEnv(t)
	fresh := "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="
	base := func() Config {
		c := Defaults()
		c.DatabaseURL, c.ValkeyURL = "postgres://x", "redis://x"
		c.EncryptionKey, c.APIKeyPepper = fresh, fresh
		c.AppURL = "https://rag.example.edu"
		c.OIDC.Issuer, c.OIDC.ClientID, c.OIDC.ClientSecret = "https://idp.example.edu", "id", "secret"
		return c
	}
	cases := []struct {
		name   string
		mutate func(*Config)
		mode   string
		want   []string // substrings; none means valid
	}{
		{"production ok", func(*Config) {}, "api", nil},
		{"example encryption key", func(c *Config) { c.EncryptionKey = ex["ENCRYPTION_KEY"] }, "api",
			[]string{"ENCRYPTION_KEY is the public example value", "openssl rand -base64 32"}},
		{"example key in another encoding", func(c *Config) { c.EncryptionKey = strings.TrimRight(ex["ENCRYPTION_KEY"], "=") }, "worker",
			[]string{"ENCRYPTION_KEY is the public example value"}},
		{"example pepper", func(c *Config) { c.APIKeyPepper = ex["API_KEY_PEPPER"] }, "serve", []string{"API_KEY_PEPPER is the public example value"}},
		{"example pepper on worker", func(c *Config) { c.APIKeyPepper = ex["API_KEY_PEPPER"] }, "worker", []string{"API_KEY_PEPPER"}},
		{"example key as previous is fine", func(c *Config) { c.EncryptionKeyPrevious = ex["ENCRYPTION_KEY"] }, "api", nil},
		{"dev auth", func(c *Config) { c.DevAuth = true }, "api", []string{"DEV_AUTH requires a loopback APP_URL", "OIDC_ISSUER"}},
		{"dev auth on worker", func(c *Config) { c.DevAuth = true }, "worker", []string{"DEV_AUTH"}},
		{"http app url", func(c *Config) { c.AppURL = "http://rag.example.edu" }, "api", []string{"APP_URL must use https", "APP_URL=https://rag.example.edu"}},
		{"http app url on worker", func(c *Config) { c.AppURL = "http://rag.example.edu" }, "worker", []string{"APP_URL must use https"}},
		{"worker without app url", func(c *Config) { c.AppURL = ""; c.EncryptionKey = ex["ENCRYPTION_KEY"] }, "worker", []string{"ENCRYPTION_KEY"}},
		{"migrate example keys", func(c *Config) { c.EncryptionKey = ex["ENCRYPTION_KEY"] }, "migrate", []string{"ENCRYPTION_KEY"}},
		{"migrate without app url", func(c *Config) { c.AppURL, c.EncryptionKey, c.DevAuth = "", ex["ENCRYPTION_KEY"], true }, "migrate", nil},
		{"loopback dev install", func(c *Config) {
			c.AppURL, c.DevAuth = "http://localhost:8080", true
			c.EncryptionKey, c.APIKeyPepper = ex["ENCRYPTION_KEY"], ex["API_KEY_PEPPER"]
		}, "serve", nil},
		{"loopback ip", func(c *Config) {
			c.AppURL, c.DevAuth, c.EncryptionKey = "http://127.0.0.1:8080", true, ex["ENCRYPTION_KEY"]
		}, "worker", nil},
		{"all at once", func(c *Config) {
			c.AppURL, c.DevAuth = "http://grounded.example.edu", true
			c.EncryptionKey, c.APIKeyPepper = ex["ENCRYPTION_KEY"], ex["API_KEY_PEPPER"]
		}, "api", []string{"ENCRYPTION_KEY", "API_KEY_PEPPER", "DEV_AUTH", "must use https"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := base()
			tc.mutate(&c)
			err := c.Validate(tc.mode)
			if len(tc.want) == 0 {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("want %q, got nil", tc.want)
			}
			for _, w := range tc.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("missing %q in %v", w, err)
				}
			}
		})
	}
}

// The development .env.example itself must start (APP_URL is loopback).
func TestEnvExampleIsAllowedLocally(t *testing.T) {
	c, err := LoadFrom("", func(k string) (string, bool) { v, ok := exampleEnv(t)[k]; return v, ok })
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Validate("serve"); err != nil {
		t.Fatalf(".env.example refused: %v", err)
	}
	if !c.LoopbackAppURL() {
		t.Fatal(".env.example APP_URL is not loopback")
	}
}
