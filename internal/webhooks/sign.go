package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
)

// SignatureHeader carries the signature of a delivery.
const SignatureHeader = "Grounded-Signature"

// SignatureTolerance is how old a signature's timestamp may be before a receiver should refuse it (replay protection).
const SignatureTolerance = 5 * time.Minute

// Sign is the Grounded-Signature header: "t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the secret>".
func Sign(secret string, at time.Time, body []byte) string {
	t := strconv.FormatInt(at.Unix(), 10)
	return "t=" + t + ",v1=" + mac(secret, t, body)
}

func mac(secret, t string, body []byte) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(t))
	h.Write([]byte("."))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

var errBadSignature = errors.New("the signature is missing, malformed or does not match")

// Verify checks a Grounded-Signature header against the raw body (what a receiver does): the signature must match and its timestamp must be
// within tolerance of now. It is the reference for the docs and the tests.
func Verify(secret, header string, body []byte, now time.Time, tolerance time.Duration) error {
	var t, sig string
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			return errBadSignature
		}
		switch k {
		case "t":
			t = v
		case "v1":
			sig = v
		}
	}
	secs, err := strconv.ParseInt(t, 10, 64)
	if err != nil || sig == "" {
		return errBadSignature
	}
	if !hmac.Equal([]byte(sig), []byte(mac(secret, t, body))) {
		return errBadSignature
	}
	if d := now.Sub(time.Unix(secs, 0)); d > tolerance || d < -tolerance {
		return errors.New("the signature's timestamp is outside the tolerance")
	}
	return nil
}
