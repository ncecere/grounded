package public

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"math/big"
	"strings"
)

// Publishable keys (ADR-0012, docs/phase4-publishing.md §6) look like
// pk_<12 id chars>_<32 secret chars>. They sit in web pages, so they are
// not secrets in practice, but only an HMAC of the key is stored (like API
// keys) and the id part is used for lookup. They can only start widget
// sessions for one agent.
const (
	keyPrefix    = "pk_"
	keyIDLen     = 12
	keySecretLen = 32
	alphabet     = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
)

func randomString(n int) string {
	b := make([]byte, n)
	m := big.NewInt(int64(len(alphabet)))
	for i := range b {
		v, err := rand.Int(rand.Reader, m)
		if err != nil {
			panic(err) // crypto/rand never fails on supported platforms
		}
		b[i] = alphabet[v.Int64()]
	}
	return string(b)
}

// NewKey returns a new publishable key and its id part.
func NewKey() (key, id string) {
	id = randomString(keyIDLen)
	return keyPrefix + id + "_" + randomString(keySecretLen), id
}

// ParseKey splits a publishable key into its id part; ok is false when the
// key is malformed.
func ParseKey(raw string) (id string, ok bool) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, keyPrefix) || len(raw) != len(keyPrefix)+keyIDLen+1+keySecretLen {
		return "", false
	}
	id, secret, found := strings.Cut(raw[len(keyPrefix):], "_")
	if !found || len(id) != keyIDLen || len(secret) != keySecretLen || !inAlphabet(id) || !inAlphabet(secret) {
		return "", false
	}
	return id, true
}

func inAlphabet(s string) bool {
	for _, c := range s {
		if !strings.ContainsRune(alphabet, c) {
			return false
		}
	}
	return true
}

// HashKey is the stored digest: HMAC-SHA256 with the API key pepper, in
// its own domain so an API key digest never equals a publishable one.
func HashKey(pepper []byte, key string) []byte {
	m := hmac.New(sha256.New, pepper)
	m.Write([]byte("publishable-key:"))
	m.Write([]byte(key))
	return m.Sum(nil)
}

// KeyDisplay is how a stored key is shown: pk_<id>_… (the secret is shown
// once, at creation).
func KeyDisplay(id string) string { return keyPrefix + id + "_…" }
