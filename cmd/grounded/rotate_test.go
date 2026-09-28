package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/testutil"
)

func randomKey(t *testing.T) (string, []byte) {
	t.Helper()
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(k), k
}

// clearEnv isolates a test from the developer's environment.
func clearEnv(t *testing.T) {
	for _, k := range []string{"GROUNDED_CONFIG_FILE", "ENCRYPTION_KEY", "ENCRYPTION_KEY_PREVIOUS", "API_KEY_PEPPER", "API_KEY_PEPPER_PREVIOUS", "DATABASE_URL"} {
		t.Setenv(k, "")
	}
}

func TestRotateKeysRefusals(t *testing.T) {
	clearEnv(t)
	cur, _ := randomKey(t)
	t.Setenv("DATABASE_URL", "postgres://unused.invalid/db")
	t.Setenv("ENCRYPTION_KEY", cur)
	ctx := context.Background()
	var out bytes.Buffer
	for _, c := range []struct {
		name, previous string
		args           []string
		want           string
	}{
		{"no previous key", "", nil, "ENCRYPTION_KEY_PREVIOUS is not set"},
		{"previous equals current", cur, nil, "equals ENCRYPTION_KEY"},
		{"bad previous key", "c2hvcnQ=", nil, "ENCRYPTION_KEY_PREVIOUS"},
		{"unknown flag", "", []string{"--force"}, "flag provided but not defined"},
		{"extra argument", "", []string{"now"}, "invalid arguments"},
		{"bad batch size", "", []string{"--batch-size", "0"}, "invalid arguments"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("ENCRYPTION_KEY_PREVIOUS", c.previous)
			err := rotateKeys(ctx, c.args, &out)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want %q", err, c.want)
			}
		})
	}
	out.Reset()
	if err := rotateKeys(ctx, []string{"--help"}, &out); err != nil || !strings.Contains(out.String(), "-dry-run") {
		t.Fatalf("help = %v %q", err, out.String())
	}
}

// The command end to end against a database: a dry run, then the rotation.
func TestRotateKeysCommand(t *testing.T) {
	clearEnv(t)
	pool, dbURL := testutil.NewDB(t)
	oldEnc, oldRaw := randomKey(t)
	newEnc, newRaw := randomKey(t)
	pepper, _ := randomKey(t)
	oldBox, _ := secrets.New(oldRaw)
	id := uuid.New()
	ct, _ := oldBox.Seal([]byte("sk-gateway"), catalog.ConnectionAAD(id))
	if _, err := pool.Exec(context.Background(), "INSERT INTO model_connections (id, name, base_url, api_key_ciphertext) VALUES ($1, 'Gateway', 'https://gateway.example.edu/v1', $2)", id, ct); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", dbURL)
	t.Setenv("ENCRYPTION_KEY", newEnc)
	t.Setenv("ENCRYPTION_KEY_PREVIOUS", oldEnc)
	t.Setenv("API_KEY_PEPPER", pepper)

	var out bytes.Buffer
	if err := rotateKeys(context.Background(), []string{"--dry-run"}, &out); err != nil {
		t.Fatalf("dry run: %v\n%s", err, out.String())
	}
	for _, s := range []string{"model_connections.api_key_ciphertext: 1 stored, 0 on the current key, 1 on the previous key", "Dry run: nothing was written", "Every usable API key"} {
		if !strings.Contains(out.String(), s) {
			t.Fatalf("dry run output lacks %q:\n%s", s, out.String())
		}
	}
	out.Reset()
	if err := rotateKeys(context.Background(), nil, &out); err != nil {
		t.Fatalf("rotate: %v\n%s", err, out.String())
	}
	if !strings.Contains(out.String(), "Done: 1 secret(s) re-encrypted") || strings.Contains(out.String(), "sk-gateway") {
		t.Fatalf("output:\n%s", out.String())
	}
	var stored []byte
	if err := pool.QueryRow(context.Background(), "SELECT api_key_ciphertext FROM model_connections WHERE id = $1", id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	newOnly, _ := secrets.New(newRaw)
	if pt, err := newOnly.Open(stored, catalog.ConnectionAAD(id)); err != nil || string(pt) != "sk-gateway" {
		t.Fatalf("after rotation: %q %v", pt, err)
	}
}
