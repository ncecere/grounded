package secrets

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

// The stored layout is a compatibility contract: every value written since
// the first release is version 1 with a key id, and rotate-keys filters on
// the id's position in SQL.
func TestCiphertextFormat(t *testing.T) {
	k := randomKey(t)
	box, _ := New(k)
	ct, err := box.Seal([]byte("sk-secret"), []byte("row:1"))
	if err != nil {
		t.Fatal(err)
	}
	if ct[0] != 1 {
		t.Fatalf("version byte = %d", ct[0])
	}
	sum := sha256.Sum256(k)
	if !bytes.Equal(ct[IDOffset:IDOffset+IDLen], sum[:8]) || !bytes.Equal(box.CurrentKeyID(), sum[:8]) {
		t.Fatal("key id is not the first 8 bytes of SHA-256(key)")
	}
	if want := 1 + 8 + 12 + len("sk-secret") + 16; len(ct) != want {
		t.Fatalf("length = %d, want %d", len(ct), want)
	}
	a, _ := box.Seal([]byte("sk-secret"), []byte("row:1"))
	if bytes.Equal(a, ct) {
		t.Fatal("two seals of one value are identical (nonce reuse)")
	}
}

// A value written by the original implementation (a fixed vector: key of
// 32 x 0x01, nonce of 12 x 0x02) still opens: the format has not changed.
func TestLegacyValueOpens(t *testing.T) {
	k := bytes.Repeat([]byte{1}, 32)
	box, _ := New(bytes.Repeat([]byte{9}, 32), k) // the legacy key is now the previous one
	ct, err := hex.DecodeString(strings.Join([]string{
		"01", "72cd6e8422c407fb", "020202020202020202020202", // version | key id | nonce
		"6bb3ae28292eec8eb6afcead28", "b843ac6234d25cc117734f95d85d628d", // sealed | tag
	}, ""))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(ct[1:9], KeyID(k)) {
		t.Fatalf("vector key id %x != %x", ct[1:9], KeyID(k))
	}
	if box.Which(ct) != SlotPrevious {
		t.Fatalf("slot = %v", box.Which(ct))
	}
	pt, err := box.Open(ct, []byte("model_connection:x"))
	if err != nil || string(pt) != "legacy-secret" {
		t.Fatalf("open = %q, %v", pt, err)
	}
}

func TestOpenWithPreviousAndWrongKeys(t *testing.T) {
	oldKey, newKey, otherKey := randomKey(t), randomKey(t), randomKey(t)
	oldBox, _ := New(oldKey)
	ct, _ := oldBox.Seal([]byte("v"), []byte("aad"))

	rotated, _ := New(newKey, oldKey)
	if !rotated.HasPrevious() || rotated.Which(ct) != SlotPrevious {
		t.Fatalf("which = %v", rotated.Which(ct))
	}
	if pt, err := rotated.Open(ct, []byte("aad")); err != nil || string(pt) != "v" {
		t.Fatalf("previous key: %q %v", pt, err)
	}
	fresh, _ := rotated.Seal([]byte("v"), []byte("aad"))
	if rotated.Which(fresh) != SlotCurrent || !bytes.Equal(fresh[1:9], KeyID(newKey)) {
		t.Fatal("new values must be sealed with the current key")
	}

	wrong, _ := New(newKey, otherKey)
	_, err := wrong.Open(ct, []byte("aad"))
	if !errors.Is(err, ErrUndecryptable) || wrong.Which(ct) != SlotUnknown || !strings.Contains(err.Error(), "neither") {
		t.Fatalf("unknown key: %v (%v)", err, wrong.Which(ct))
	}
	// A value whose id names a configured key but whose bytes don't
	// authenticate (tampered, or moved to another row).
	if _, err := rotated.Open(ct, []byte("other-row")); !errors.Is(err, ErrUndecryptable) || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("wrong associated data: %v", err)
	}
	for _, bad := range [][]byte{nil, {1, 2, 3}, append([]byte{2}, ct[1:]...)} {
		if _, err := rotated.Open(bad, nil); !errors.Is(err, ErrUndecryptable) || rotated.Which(bad) != SlotMalformed {
			t.Fatalf("malformed %x: %v", bad, err)
		}
	}
}

func TestPreviousEqualToCurrentIsIgnored(t *testing.T) {
	k := randomKey(t)
	box, _ := New(k, append([]byte(nil), k...))
	if box.HasPrevious() {
		t.Fatal("a previous key equal to the current one counts as a rotation")
	}
}

func digestFor(key string) func([]byte) []byte {
	return func(pepper []byte) []byte {
		m := hmac.New(sha256.New, pepper)
		m.Write([]byte(key))
		return m.Sum(nil)
	}
}

func TestPeppers(t *testing.T) {
	oldP, newP := randomKey(t), randomKey(t)
	stored := digestFor("rag_x")(oldP)

	if m, _ := NewPeppers(newP, nil).Verify(stored, digestFor("rag_x")); m != NoMatch {
		t.Fatal("old digest accepted without the previous pepper")
	}
	p := NewPeppers(newP, oldP)
	m, rehash := p.Verify(stored, digestFor("rag_x"))
	if m != MatchPrevious || !bytes.Equal(rehash, digestFor("rag_x")(newP)) {
		t.Fatalf("previous pepper: %v", m)
	}
	if m, _ := p.Verify(rehash, digestFor("rag_x")); m != MatchCurrent {
		t.Fatal("re-hashed digest not on the current pepper")
	}
	if m, _ := p.Verify(stored, digestFor("rag_y")); m != NoMatch {
		t.Fatal("wrong key accepted")
	}
	if m, _ := (Peppers{}).Verify(stored, digestFor("rag_x")); m != NoMatch {
		t.Fatal("matched without a pepper")
	}
	if NewPeppers(newP, newP).Previous != nil {
		t.Fatal("previous equal to current kept")
	}
	if bytes.Equal(PepperID(newP), KeyID(newP)) || len(PepperID(newP)) != 8 {
		t.Fatal("pepper ids must be 8 bytes and distinct from encryption key ids")
	}

	for _, c := range []struct {
		p    Peppers
		id   []byte
		want PepperState
	}{
		{p, nil, PepperPrevious},
		{p, PepperID(oldP), PepperPrevious},
		{p, PepperID(newP), PepperCurrent},
		{p, PepperID(randomKey(t)), PepperRetired},
		{NewPeppers(newP, nil), nil, PepperCurrent},
		{NewPeppers(newP, nil), PepperID(oldP), PepperRetired},
	} {
		if got := c.p.State(c.id); got != c.want {
			t.Errorf("State(%x) = %s, want %s", c.id, got, c.want)
		}
	}
}
