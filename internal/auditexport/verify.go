package auditexport

import (
	"bufio"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"time"
)

// Verify authenticates with independently trusted public keys. The bundled key
// is information, never a trust root. It verifies canonical payload bytes too.
func Verify(e Envelope, payload io.Reader, trusted map[string]ed25519.PublicKey) error {
	m := e.Manifest
	key := trusted[m.KeyID]
	b, _ := json.Marshal(m)
	if m.Version != Version || m.Algorithm != "Ed25519" || len(key) != ed25519.PublicKeySize ||
		digest(key) != m.KeyID || !bytes.Equal(key, e.PublicKey) ||
		!ed25519.Verify(key, append([]byte(domain), b...), e.Signature) {
		return ErrInvalid
	}
	day, err := time.Parse("2006-01-02", m.Day)
	if err != nil || m.Count < 0 || m.Watermark < 0 {
		return ErrInvalid
	}
	snapshot, err := time.Parse(time.RFC3339Nano, m.Snapshot)
	if err != nil || snapshot.Before(day.AddDate(0, 0, 1)) {
		return ErrInvalid
	}
	coverage, err := time.Parse("2006-01-02", m.CoverageStart)
	if err != nil || coverage.After(day) || m.Count > MaxRecords {
		return ErrInvalid
	}
	return verifyLines(m, day, payload)
}

func verifyLines(m Manifest, day time.Time, payload io.Reader) error {
	r := bufio.NewReaderSize(payload, 16*1024)
	h := sha256.New()
	coverage, _ := time.Parse("2006-01-02", m.CoverageStart)
	var count, first, last, total int64
	previous := ""
	for {
		raw, err := r.ReadSlice('\n')
		if err == io.EOF && len(raw) == 0 {
			break
		}
		if err != nil {
			return ErrInvalid
		}
		total += int64(len(raw))
		if total > MaxPayloadBytes {
			return ErrInvalid
		}
		var l line
		if json.Unmarshal(raw, &l) != nil {
			return ErrInvalid
		}
		canonical, _ := json.Marshal(l)
		canonical = append(canonical, '\n')
		if !bytes.Equal(raw, canonical) {
			return ErrInvalid
		}
		at, err := time.Parse(time.RFC3339Nano, l.Fact.At)
		if err != nil || l.Fact.At != utc(at) || at.Before(coverage) || !at.Before(day.AddDate(0, 0, 1)) {
			return ErrInvalid
		}
		count++
		if !validPosition(l, m, count, last, previous) {
			return ErrInvalid
		}
		if first == 0 {
			first = l.Fact.ID
		}
		last, previous = l.Fact.ID, digest(raw)
		_, _ = h.Write(raw)
	}
	if count != m.Count || first != m.FirstID || last != m.LastID || previous != m.FinalHash || hex.EncodeToString(h.Sum(nil)) != m.PayloadHash {
		return ErrInvalid
	}
	return nil
}

// verifyLink checks date adjacency and the exact previous canonical envelope.
// Call Verify for both artifacts as well, with independently trusted keys.
func verifyLink(previous, next Envelope) error {
	b, _ := json.Marshal(previous)
	day, err := time.Parse("2006-01-02", previous.Manifest.Day)
	if err != nil || next.Manifest.CoverageStart != previous.Manifest.CoverageStart || next.Manifest.PreviousExport != digest(b) || next.Manifest.Day != day.AddDate(0, 0, 1).Format("2006-01-02") {
		return ErrInvalid
	}
	return nil
}

func validPosition(l line, m Manifest, count, last int64, previous string) bool {
	return count <= m.Count && l.Ordinal == count && l.Previous == previous && l.Fact.ID > last && l.Fact.ID <= m.Watermark
}
