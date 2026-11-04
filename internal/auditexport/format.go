// Package auditexport implements the internal signed snapshot engine proposed in
// ADR-0034. It is not registered in application startup: approval, API and jobs
// must be integrated before enabling this feature.
package auditexport

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

const MaxRecords int64 = 100000
const MaxPayloadBytes int64 = 64 << 20

const Version = "grounded.audit.v1"
const domain = "grounded.audit.manifest.v1\n"

var (
	ErrLimit   = errors.New("audit export: hard size limit exceeded")
	ErrInvalid = errors.New("audit export: invalid artifact")
	ErrSigning = errors.New("audit export: signing configuration unavailable")
	ErrRange   = errors.New("audit export: invalid closed UTC day or previous export not completed")
	ErrStorage = errors.New("audit export: private storage operation failed")
)

type Fact struct {
	ID          int64  `json:"id"`
	At          string `json:"at"`
	ActorKind   string `json:"actorKind"`
	ActorUserID string `json:"actorUserId"`
	TeamID      string `json:"teamId"`
	Action      string `json:"action"`
	TargetType  string `json:"targetType"`
	TargetID    string `json:"targetId"`
}

type line struct {
	Ordinal  int64  `json:"ordinal"`
	Fact     Fact   `json:"fact"`
	Previous string `json:"previous"`
}

type Manifest struct {
	CoverageStart  string `json:"coverageStart"`
	Version        string `json:"version"`
	Day            string `json:"day"`
	Snapshot       string `json:"snapshot"`
	Watermark      int64  `json:"watermark"`
	Count          int64  `json:"count"`
	FirstID        int64  `json:"firstId"`
	LastID         int64  `json:"lastId"`
	FinalHash      string `json:"finalHash"`
	PayloadHash    string `json:"payloadHash"`
	PreviousExport string `json:"previousExport"`
	Algorithm      string `json:"algorithm"`
	KeyID          string `json:"keyId"`
}

type Envelope struct {
	Manifest  Manifest `json:"manifest"`
	PublicKey []byte   `json:"publicKey"`
	Signature []byte   `json:"signature"`
}

func digest(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func utc(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func sign(m Manifest, key ed25519.PrivateKey) (Envelope, error) {
	if len(key) != ed25519.PrivateKeySize {
		return Envelope{}, ErrSigning
	}
	// Reject an inconsistent seed/public half rather than publishing a bad signature.
	derived := ed25519.NewKeyFromSeed(key.Seed())
	if !derived.Equal(key) {
		return Envelope{}, ErrSigning
	}
	if m.CoverageStart == "" {
		m.CoverageStart = m.Day
	}
	public := key.Public().(ed25519.PublicKey)
	m.Algorithm, m.KeyID = "Ed25519", digest(public)
	b, err := json.Marshal(m)
	if err != nil {
		return Envelope{}, ErrInvalid
	}
	return Envelope{m, public, ed25519.Sign(key, append([]byte(domain), b...))}, nil
}
