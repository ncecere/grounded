package secrets

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
)

// Peppers are the API key pepper (API_KEY_PEPPER) and, during a rotation,
// the previous one (API_KEY_PEPPER_PREVIOUS). API and publishable keys are
// stored only as HMAC digests under a pepper, so they cannot be re-hashed
// in bulk: a key found with the previous pepper is re-hashed with the
// current one when it is next used (docs/operations/rotate-keys.md).
//
// Each stored digest records the id of the pepper that made it (the
// pepper_id column of api_keys and publishable_keys). NULL marks a digest from before rotation support: it was
// made with whichever pepper was configured then, so it is treated as "on
// the previous pepper" while one is configured.
type Peppers struct {
	Current  []byte
	Previous []byte // nil: no rotation in progress
}

// PepperID identifies a pepper without revealing it: the first 8 bytes of
// SHA-256 over a domain label and the pepper (distinct from KeyID, so the
// same value used as an encryption key and a pepper gets different ids).
func PepperID(pepper []byte) []byte {
	h := sha256.New()
	h.Write([]byte("grounded-pepper-id:"))
	h.Write(pepper)
	return h.Sum(nil)[:IDLen]
}

// NewPeppers builds Peppers; a previous pepper equal to the current one is
// ignored.
func NewPeppers(current, previous []byte) Peppers {
	p := Peppers{Current: current}
	if len(previous) > 0 && !bytes.Equal(previous, current) {
		p.Previous = previous
	}
	return p
}

// ParsePeppers parses API_KEY_PEPPER and API_KEY_PEPPER_PREVIOUS (base64;
// empty: not set).
func ParsePeppers(current, previous string) (Peppers, error) {
	var cur, prev []byte
	var err error
	if current != "" {
		if cur, err = ParseKey(current); err != nil {
			return Peppers{}, fmt.Errorf("API_KEY_PEPPER: %w", err)
		}
	}
	if previous != "" {
		if prev, err = ParseKey(previous); err != nil {
			return Peppers{}, fmt.Errorf("API_KEY_PEPPER_PREVIOUS: %w", err)
		}
	}
	return NewPeppers(cur, prev), nil
}

// CurrentID is the id recorded with digests made now (nil without a pepper).
func (p Peppers) CurrentID() []byte {
	if len(p.Current) == 0 {
		return nil
	}
	return PepperID(p.Current)
}

// PepperMatch is the outcome of checking a presented key against a digest.
type PepperMatch int

const (
	NoMatch PepperMatch = iota
	// MatchCurrent: the digest is under the current pepper.
	MatchCurrent
	// MatchPrevious: the digest is under the previous pepper; store the
	// returned digest (current pepper) to finish rotating this key.
	MatchPrevious
)

// Verify checks a stored digest, where digest computes a key's digest
// under a given pepper. It tries the current pepper, then the previous one;
// on a previous-pepper match it also returns the digest under the current
// pepper.
func (p Peppers) Verify(stored []byte, digest func(pepper []byte) []byte) (PepperMatch, []byte) {
	if len(p.Current) == 0 {
		return NoMatch, nil
	}
	cur := digest(p.Current)
	if subtle.ConstantTimeCompare(stored, cur) == 1 {
		return MatchCurrent, nil
	}
	if len(p.Previous) > 0 && subtle.ConstantTimeCompare(stored, digest(p.Previous)) == 1 {
		return MatchPrevious, cur
	}
	return NoMatch, nil
}

// PepperState classifies a stored digest by its recorded pepper id.
type PepperState string

const (
	// PepperCurrent: made with API_KEY_PEPPER.
	PepperCurrent PepperState = "current"
	// PepperPrevious: made with API_KEY_PEPPER_PREVIOUS (or before rotation
	// support, while a previous pepper is configured); re-hashed on next use.
	PepperPrevious PepperState = "previous"
	// PepperRetired: made with a pepper that is no longer configured; the
	// key cannot work any more and should be revoked.
	PepperRetired PepperState = "retired"
)

// State classifies a digest's recorded pepper id (nil: from before rotation
// support).
func (p Peppers) State(storedID []byte) PepperState {
	switch {
	case storedID == nil && len(p.Previous) > 0:
		return PepperPrevious
	case storedID == nil, bytes.Equal(storedID, p.CurrentID()):
		return PepperCurrent
	case len(p.Previous) > 0 && bytes.Equal(storedID, PepperID(p.Previous)):
		return PepperPrevious
	default:
		return PepperRetired
	}
}
