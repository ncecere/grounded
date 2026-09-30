package mcpserver

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"

	"github.com/google/uuid"
)

// Handles mints and opens conversation handles. MCP is stateless, so ask
// returns a handle that a follow-up sends back: the conversation's ID with
// a MAC over it and the caller's binding (its API key), so a handle only
// works for the credential it was minted for, and can't be forged or
// pointed at another conversation. The conversation itself is still checked
// on use (its owner and agent), as for the REST API.
type Handles struct{ key []byte }

const (
	handlePrefix = "c1_"
	handleMACLen = 16
)

// NewHandles derives the handle key from a server secret (the API-key
// pepper): rotating the secret retires every handle, and a follow-up then
// starts a new conversation.
func NewHandles(secret []byte) *Handles {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte("grounded mcp conversation handle v1"))
	return &Handles{key: m.Sum(nil)}
}

func (h *Handles) mac(binding, conv uuid.UUID) []byte {
	m := hmac.New(sha256.New, h.key)
	m.Write(binding[:])
	m.Write(conv[:])
	return m.Sum(nil)[:handleMACLen]
}

// Mint returns the handle of a conversation for a binding.
func (h *Handles) Mint(binding, conv uuid.UUID) string {
	raw := append(conv[:len(conv):len(conv)], h.mac(binding, conv)...)
	return handlePrefix + base64.RawURLEncoding.EncodeToString(raw)
}

// Open returns the conversation of a handle minted for binding; ok is false
// for anything else.
func (h *Handles) Open(binding uuid.UUID, handle string) (conv uuid.UUID, ok bool) {
	enc, found := strings.CutPrefix(strings.TrimSpace(handle), handlePrefix)
	if !found {
		return uuid.Nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil || len(raw) != len(conv)+handleMACLen {
		return uuid.Nil, false
	}
	copy(conv[:], raw[:len(conv)])
	if !hmac.Equal(raw[len(conv):], h.mac(binding, conv)) {
		return uuid.Nil, false
	}
	return conv, true
}
