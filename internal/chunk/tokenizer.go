package chunk

import (
	"fmt"
	"math"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/dlclark/regexp2"
	tiktokenloader "github.com/pkoukk/tiktoken-go-loader"
)

// TokenCounter counts tokens. The default approximates embedding tokenizers
// with OpenAI's cl100k_base BPE.
type TokenCounter interface{ Count(s string) int }

// cl100kPattern is tiktoken's cl100k_base pre-tokenisation regexp (the same
// string tiktoken-go uses; it is not exported there).
const cl100kPattern = `(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+`

// loadRanks decodes the cl100k_base merge ranks embedded by
// tiktoken-go-loader, once per process.
var loadRanks = sync.OnceValues(func() (map[string]int, error) {
	ranks, err := tiktokenloader.NewOfflineLoader().LoadTiktokenBpe("cl100k_base.tiktoken")
	if err != nil {
		return nil, fmt.Errorf("chunk: load embedded cl100k_base ranks: %w", err)
	}
	if _, err := regexp2.Compile(cl100kPattern, regexp2.None); err != nil {
		return nil, fmt.Errorf("chunk: compile cl100k_base pattern: %w", err)
	}
	return ranks, nil
})

// NewTokenCounter returns a cl100k_base counter using an embedded (offline)
// BPE file, so it never downloads anything at runtime. Safe for concurrent
// use; build it once.
//
// Counts match github.com/pkoukk/tiktoken-go's EncodeOrdinary (the tests
// cross-check them), but the encoder is implemented here: tiktoken-go shares
// one regexp2.Regexp whose internal mutex is taken for every pre-token, so
// concurrent callers serialise on it (Split counts large documents in
// parallel). This counter gives each goroutine its own compiled regexp.
func NewTokenCounter() (TokenCounter, error) {
	ranks, err := loadRanks()
	if err != nil {
		return nil, err
	}
	c := &cl100kCounter{ranks: ranks}
	c.res.New = func() any { return regexp2.MustCompile(cl100kPattern, regexp2.None) }
	return c, nil
}

type cl100kCounter struct {
	ranks map[string]int
	res   sync.Pool // *regexp2.Regexp, one per concurrent caller
}

// maxRunBytes bounds the length of a run of same-class characters handed to
// the BPE in one piece. Byte-pair merging is quadratic in piece length, so an
// enormous word (or a CJK paragraph, which has no spaces) would otherwise
// take seconds; cutting such runs changes the count by at most one token per
// cut. Ordinary text never reaches this limit and is counted exactly.
const maxRunBytes = 256

// Count returns the number of cl100k_base tokens in s. Special-token text
// such as "<|endoftext|>" is counted as ordinary text.
func (c *cl100kCounter) Count(s string) int {
	if s == "" {
		return 0
	}
	re := c.res.Get().(*regexp2.Regexp)
	defer c.res.Put(re)
	n, seg := 0, 0
	runStart, runCls := 0, -1
	for i := 0; i < len(s); {
		size, cls := 1, 0
		if b := s[i]; b < utf8.RuneSelf {
			cls = asciiClass[b]
		} else {
			var r rune
			r, size = utf8.DecodeRuneInString(s[i:])
			cls = runeClass(r)
		}
		if cls != runCls {
			runCls, runStart = cls, i
		} else if i-runStart >= maxRunBytes {
			n += c.encodeLen(re, s[seg:i])
			seg, runStart = i, i
		}
		i += size
	}
	return n + c.encodeLen(re, s[seg:])
}

// encodeLen pre-tokenises s with the cl100k pattern and sums the BPE token
// count of every piece.
func (c *cl100kCounter) encodeLen(re *regexp2.Regexp, s string) int {
	n := 0
	bytePos, runePos := 0, 0
	m, _ := re.FindStringMatch(s)
	for m != nil {
		// regexp2 reports rune offsets; walk the string to byte offsets.
		for runePos < m.Index {
			_, sz := utf8.DecodeRuneInString(s[bytePos:])
			bytePos += sz
			runePos++
		}
		start := bytePos
		for runePos < m.Index+m.Length {
			_, sz := utf8.DecodeRuneInString(s[bytePos:])
			bytePos += sz
			runePos++
		}
		n += c.pieceLen(s[start:bytePos])
		m, _ = re.FindNextMatch(m)
	}
	return n
}

// pieceLen is the number of tokens byte-pair encoding produces for piece
// (tiktoken's _byte_pair_merge).
func (c *cl100kCounter) pieceLen(piece string) int {
	if len(piece) <= 1 {
		return len(piece)
	}
	if _, ok := c.ranks[piece]; ok {
		return 1
	}
	type part struct{ start, rank int }
	parts := make([]part, len(piece)+1)
	rank := func(i, skip int) int {
		if i+skip+2 < len(parts) {
			if r, ok := c.ranks[piece[parts[i].start:parts[i+skip+2].start]]; ok {
				return r
			}
		}
		return math.MaxInt
	}
	for i := range parts {
		parts[i] = part{i, math.MaxInt}
	}
	for i := 0; i < len(parts)-2; i++ {
		parts[i].rank = rank(i, 0)
	}
	for len(parts) > 1 {
		minRank, mi := math.MaxInt, -1
		for i := 0; i < len(parts)-1; i++ {
			if parts[i].rank < minRank {
				minRank, mi = parts[i].rank, i
			}
		}
		if mi < 0 {
			break
		}
		parts[mi].rank = rank(mi, 1)
		if mi > 0 {
			parts[mi-1].rank = rank(mi-1, 1)
		}
		parts = append(parts[:mi+1], parts[mi+2:]...)
	}
	return len(parts) - 1
}

const (
	clsOther = iota
	clsSpace
	clsLetter
	clsDigit
)

var asciiClass = func() (t [utf8.RuneSelf]int) {
	for i := range t {
		t[i] = runeClass(rune(i))
	}
	return t
}()

func runeClass(r rune) int {
	switch {
	case unicode.IsSpace(r):
		return clsSpace
	case unicode.IsLetter(r):
		return clsLetter
	case unicode.IsNumber(r):
		return clsDigit
	}
	return clsOther
}
