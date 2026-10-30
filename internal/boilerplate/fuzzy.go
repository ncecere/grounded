package boilerplate

// Near-duplicate blocks (DESIGN.md §5.5, #23): a menu with a different item
// highlighted, a footer with a different date. Exact hashing sees each
// variant as its own block; here a block is reduced to a small sketch and
// two blocks whose sketches mostly agree are treated as one.
//
// The sketch is a MinHash of the block's word pairs. It is deterministic
// (fixed hash functions, no randomness), so the same text always gives the
// same sketch, and cheap to store: SketchValues bytes per block.

import (
	"hash/fnv"
	"strings"
	"unicode"
)

// Parameters of the sketch. Changing any of them changes every stored
// sketch: bump SketchVersion so documents are sketched again.
const (
	SketchVersion = 1
	SketchValues  = 32 // MinHash values per block, 8 bits each
	// MinWords is the fewest words a block needs to be compared by sketch.
	// Shorter blocks (a heading, a one-line item) are matched exactly only: a
	// changed word is too large a share of them.
	MinWords = 8
	// MaxWords is how many words of a very long block are sketched.
	MaxWords = 4000
	// MatchValues is how many of the SketchValues must agree for two blocks to
	// be near-duplicates: about 75% of their word pairs in common.
	MatchValues = 23

	// Bands is how many keys of a sketch find candidate pairs (locality
	// sensitive hashing): BandValues consecutive values each.
	Bands      = 8
	BandValues = SketchValues / Bands
)

// Sketch is the MinHash of one block.
type Sketch [SketchValues]byte

// SketchOf returns the sketch of a block's text and whether the block is
// eligible (at least MinWords words). The text is compared as Normalize
// leaves it, so blocks with the same hash have the same sketch.
func SketchOf(text string) (Sketch, bool) {
	words := sketchWords(Normalize(text))
	if len(words) < MinWords {
		return Sketch{}, false
	}
	var mins [SketchValues]uint64
	for i := range mins {
		mins[i] = ^uint64(0)
	}
	h := fnv.New64a()
	for i := 0; i+1 < len(words); i++ {
		h.Reset()
		_, _ = h.Write([]byte(words[i]))
		_, _ = h.Write([]byte{0x1f})
		_, _ = h.Write([]byte(words[i+1]))
		x := h.Sum64()
		for k := range mins {
			if v := mix(x ^ seeds[k]); v < mins[k] {
				mins[k] = v
			}
		}
	}
	var s Sketch
	for i, m := range mins {
		s[i] = byte(m)
	}
	return s, true
}

// bytes is the stored form of a sketch.
func (s Sketch) bytes() []byte { return s[:] }

// Similar reports whether two sketches are of near-duplicate blocks.
func Similar(a, b Sketch) bool {
	n := 0
	for i := range a {
		if a[i] == b[i] {
			n++
		}
	}
	return n >= MatchValues
}

// Band is the key of one band of the sketch; two sketches that agree on a
// whole band share its key. The band number is part of the key.
func (s Sketch) Band(j int) uint64 {
	var v uint64
	for _, b := range s[j*BandValues : (j+1)*BandValues] {
		v = v<<8 | uint64(b)
	}
	return uint64(j)<<56 | v
}

// seeds are the fixed hash functions of the MinHash.
var seeds = func() (out [SketchValues]uint64) {
	for i := range out {
		out[i] = mix(uint64(i+1) * 0x9e3779b97f4a7c15)
	}
	return out
}()

// mix is the splitmix64 finalizer.
func mix(x uint64) uint64 {
	x ^= x >> 30
	x *= 0xbf58476d1ce4e5b9
	x ^= x >> 27
	x *= 0x94d049bb133111eb
	return x ^ x>>31
}

// dateWord stands for a number, a month or a weekday: a block that differs
// only in its date is the same block. A run of them is one word.
const dateWord = "0"

// sketchWords splits normalised text into the words that are compared:
// runs of letters and digits. Numbers (with an ordinal suffix), month names
// and weekday names, in English, become dateWord. Markdown punctuation is
// not a word, so bold or a list marker changes nothing.
func sketchWords(text string) []string {
	raw := strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	out := make([]string, 0, min(len(raw), MaxWords))
	for i, w := range raw {
		if isNumber(w) || isDateName(w, raw, i) {
			if len(out) > 0 && out[len(out)-1] == dateWord {
				continue
			}
			w = dateWord
		}
		if out = append(out, foldDigits(w)); len(out) == MaxWords {
			break
		}
	}
	return out
}

// foldDigits turns every run of digits inside a word into one "0" ("v2" and
// "v10" are one word), whatever Normalize folded.
func foldDigits(w string) string {
	if !strings.ContainsFunc(w, unicode.IsDigit) {
		return w
	}
	var b strings.Builder
	digit := false
	for _, r := range w {
		if unicode.IsDigit(r) {
			if !digit {
				b.WriteByte('0')
			}
			digit = true
			continue
		}
		digit = false
		b.WriteRune(r)
	}
	return b.String()
}

// isNumber reports digits, optionally with an ordinal suffix ("3rd").
func isNumber(w string) bool {
	for _, suffix := range []string{"st", "nd", "rd", "th"} {
		if t := strings.TrimSuffix(w, suffix); t != w && t != "" {
			w = t
			break
		}
	}
	for _, r := range w {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return w != ""
}

var dateNames = func() map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(`january february march april june july august september october november december
		jan feb mar apr jun jul aug sep sept oct nov dec
		monday tuesday wednesday thursday friday saturday sunday tue tues wed thu thur thurs fri`) {
		m[w] = true
	}
	return m
}()

// isDateName reports a month or weekday name. "may", "mon", "sat" and "sun"
// are also ordinary words and count only next to a number ("May 3").
func isDateName(w string, words []string, i int) bool {
	if dateNames[w] {
		return true
	}
	switch w {
	case "may", "mon", "sat", "sun":
		return (i > 0 && isNumber(words[i-1])) || (i+1 < len(words) && isNumber(words[i+1]))
	}
	return false
}
