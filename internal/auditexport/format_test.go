package auditexport

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func fixtureKey(n byte) ed25519.PrivateKey {
	return ed25519.NewKeyFromSeed(bytes.Repeat([]byte{n}, 32))
}
func trust(key ed25519.PrivateKey) map[string]ed25519.PublicKey {
	pub := key.Public().(ed25519.PublicKey)
	return map[string]ed25519.PublicKey{digest(pub): pub}
}
func fixture(t *testing.T) (Envelope, []byte) {
	t.Helper()
	f := Fact{ID: 7, At: "2026-10-01T12:00:00Z", ActorKind: "system", Action: "auth.login", TargetType: "user"}
	b, _ := json.Marshal(line{Ordinal: 1, Fact: f})
	b = append(b, '\n')
	m := Manifest{Version: Version, Day: "2026-10-01", Snapshot: "2026-10-02T01:00:00Z", Watermark: 12, Count: 1, FirstID: 7, LastID: 7, FinalHash: digest(b), PayloadHash: digest(b)}
	e, err := sign(m, fixtureKey(1))
	if err != nil {
		t.Fatal(err)
	}
	return e, b
}
func TestSignedCanonicalPayload(t *testing.T) {
	e, b := fixture(t)
	want := `{"ordinal":1,"fact":{"id":7,"at":"2026-10-01T12:00:00Z","actorKind":"system","actorUserId":"","teamId":"","action":"auth.login","targetType":"user","targetId":""},"previous":""}` + "\n"
	if string(b) != want {
		t.Fatalf("canonical bytes changed: %s", b)
	}
	if err := Verify(e, bytes.NewReader(b), trust(fixtureKey(1))); err != nil {
		t.Fatal(err)
	}
	e2, _ := sign(e.Manifest, fixtureKey(1))
	if !bytes.Equal(e.Signature, e2.Signature) {
		t.Fatal("signature is nondeterministic")
	}
	cases := map[string][]byte{
		"tamper":    bytes.ReplaceAll(b, []byte("auth.login"), []byte("auth.logout")),
		"truncated": b[:len(b)-1], "removed": nil, "duplicate": append(append([]byte{}, b...), b...),
		"ordinal":   bytes.Replace(b, []byte(`"ordinal":1`), []byte(`"ordinal":2`), 1),
		"unknown":   bytes.Replace(b, []byte(`"ordinal":1`), []byte(`"x":"hidden","ordinal":1`), 1),
		"oversized": []byte(strings.Repeat("x", 20*1024)),
	}
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			if Verify(e, bytes.NewReader(p), trust(fixtureKey(1))) == nil {
				t.Fatal("accepted corrupt artifact")
			}
		})
	}
	if Verify(e, bytes.NewReader(b), trust(fixtureKey(2))) == nil {
		t.Fatal("wrong trusted key accepted")
	}
	e.Manifest.Watermark++
	if Verify(e, bytes.NewReader(b), trust(fixtureKey(1))) == nil {
		t.Fatal("modified manifest accepted")
	}
}
func TestSigningFailsClosed(t *testing.T) {
	for _, key := range []ed25519.PrivateKey{nil, make([]byte, 32), make([]byte, 64)} {
		if _, err := sign(Manifest{}, key); err != ErrSigning {
			t.Fatalf("bad key: %v", err)
		}
	}
}
func TestEmptyRotationAndLink(t *testing.T) {
	previous, _ := fixture(t)
	b, _ := json.Marshal(previous)
	m := Manifest{Version: Version, Day: "2026-10-02", Snapshot: "2026-10-03T00:00:00Z", Watermark: 12, PayloadHash: digest(nil), PreviousExport: digest(b)}
	next, err := sign(m, fixtureKey(2))
	if err != nil {
		t.Fatal(err)
	}
	if err := Verify(next, strings.NewReader(""), trust(fixtureKey(2))); err != nil {
		t.Fatal(err)
	}
	if VerifyLink(previous, next) != nil {
		t.Fatal("rotation broke chain")
	}
	next.Manifest.Day = time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	if VerifyLink(previous, next) == nil {
		t.Fatal("date gap accepted")
	}
	next.Manifest.Day = "2026-10-02"
	next.Manifest.PreviousExport = ""
	if VerifyLink(previous, next) == nil {
		t.Fatal("missing previous export accepted")
	}
}
