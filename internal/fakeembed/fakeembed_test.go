package fakeembed

import (
	"math"
	"testing"
)

func cosine(a, b []float32) float64 {
	var s float64
	for i := range a {
		s += float64(a[i]) * float64(b[i])
	}
	return s
}

func TestVector(t *testing.T) {
	a := Vector("How do I reset my password?", 64)
	if len(a) != 64 {
		t.Fatalf("dims = %d", len(a))
	}
	if n := cosine(a, a); math.Abs(n-1) > 1e-5 {
		t.Errorf("not unit length: %f", n)
	}
	if b := Vector("How do I reset my password?", 64); cosine(a, b) < 1-1e-6 {
		t.Error("equal texts differ")
	}
	near, far := Vector("password reset steps", 64), Vector("library opening hours", 64)
	if cosine(a, near) <= cosine(a, far) {
		t.Error("texts sharing words are not closer")
	}
	if v := Vector("", 8); math.IsNaN(float64(v[0])) {
		t.Error("empty text gives NaN")
	}
}
