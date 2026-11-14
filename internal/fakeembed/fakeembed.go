// Package fakeembed is the embedding both fake gateways compute: the test and
// development fake (internal/fakes) and the demo's built-in one
// (`grounded demo --serve-fake-models`, internal/demo). It is its own small
// package so the product binary carries this function and not the test
// fake (#253).
package fakeembed

import (
	"crypto/sha256"
	"encoding/binary"
	"math"
	"strings"
	"unicode"
)

// Vector returns a deterministic unit vector for text: a hashed bag of
// words, so texts sharing words are close (cosine similarity behaves like a
// crude semantic model) and equal texts are identical. A tiny hash of the
// whole text avoids zero vectors.
func Vector(text string, dims int) []float32 {
	v := make([]float64, dims)
	for _, w := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if len(w) < 3 {
			continue // short function words carry little meaning
		}
		sum := sha256.Sum256([]byte(w))
		v[binary.BigEndian.Uint32(sum[:4])%uint32(dims)]++
	}
	whole := sha256.Sum256([]byte(text))
	var norm float64
	for i := range v {
		v[i] += float64(whole[i%len(whole)]) / 255 * 0.01
		norm += v[i] * v[i]
	}
	norm = math.Sqrt(norm)
	out := make([]float32, dims)
	for i := range v {
		out[i] = float32(v[i] / norm)
	}
	return out
}
