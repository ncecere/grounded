package chunk

import (
	"math/rand/v2"
	"strings"
	"sync"
	"testing"

	tiktoken "github.com/pkoukk/tiktoken-go"
	tiktokenloader "github.com/pkoukk/tiktoken-go-loader"
)

// referenceEncoder builds tiktoken-go's own cl100k_base encoder from the
// same embedded ranks, without touching its package-level loader.
func referenceEncoder(t testing.TB) *tiktoken.Tiktoken {
	t.Helper()
	ranks, err := tiktokenloader.NewOfflineLoader().LoadTiktokenBpe("cl100k_base.tiktoken")
	if err != nil {
		t.Fatal(err)
	}
	special := map[string]int{
		tiktoken.ENDOFTEXT: 100257, tiktoken.FIM_PREFIX: 100258, tiktoken.FIM_MIDDLE: 100259,
		tiktoken.FIM_SUFFIX: 100260, tiktoken.ENDOFPROMPT: 100276,
	}
	bpe, err := tiktoken.NewCoreBPE(ranks, special, cl100kPattern)
	if err != nil {
		t.Fatal(err)
	}
	return tiktoken.NewTiktoken(bpe, &tiktoken.Encoding{
		Name: tiktoken.MODEL_CL100K_BASE, PatStr: cl100kPattern, MergeableRanks: ranks, SpecialTokens: special,
	}, map[string]any{})
}

func TestCounterMatchesTiktokenGo(t *testing.T) {
	ref := referenceEncoder(t)
	tc := realCounter(t)
	samples := []string{
		"hello world",
		"Students can't register after Friday; they'll pay a $25.00 fee (see §4.2).",
		"func main() {\n\tfmt.Println(\"hi\")   \n}\n\n\n  x := 1234567 // trailing   ",
		"| Name | Deadline |\n|---|---|\n| Fall | 2026-08-15 |",
		"日本語のテキストと English mixed, émigré café naïve — “quotes” 🎓🎓 👩‍💻",
		"   leading spaces and\r\nCRLF\ttabs\u00a0nbsp",
		"<|endoftext|> is ordinary here",
		"Ünïcödé WORDS I'M YOU'RE we've THEY'D",
		strings.Repeat("=", 200) + strings.Repeat(" ", 100) + "x",
	}
	rng := rand.New(rand.NewPCG(1, 2))
	alphabet := []rune("abcXYZ019 .,;'\"!?\n\t-_#|*()[]éß日本🎓\u0301\u00a0")
	for range 300 {
		r := make([]rune, rng.IntN(120))
		for i := range r {
			r[i] = alphabet[rng.IntN(len(alphabet))]
		}
		samples = append(samples, string(r))
	}
	for _, s := range samples {
		if got, want := tc.Count(s), len(ref.EncodeOrdinary(s)); got != want {
			t.Errorf("Count(%q) = %d, tiktoken-go %d", s, got, want)
		}
	}
}

func TestCounterConcurrent(t *testing.T) {
	tc := realCounter(t)
	text := strings.Repeat("The registrar publishes deadlines each term. ", 50)
	want := tc.Count(text)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			for range 20 {
				if got := tc.Count(text); got != want {
					t.Errorf("concurrent Count = %d, want %d", got, want)
				}
			}
		})
	}
	wg.Wait()
}

func TestCounterLongRunsAreFast(t *testing.T) {
	tc := realCounter(t)
	// Without run cutting these are quadratic in the BPE merge loop.
	for _, s := range []string{strings.Repeat("a", 1<<20), strings.Repeat("漢", 1<<18)} {
		if n := tc.Count(s); n <= 0 {
			t.Fatalf("Count = %d", n)
		}
	}
}
