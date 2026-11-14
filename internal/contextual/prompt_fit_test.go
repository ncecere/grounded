package contextual

import (
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/chunk"
)

func checkFittedDocument(t testing.TB, text, title string, n int) {
	t.Helper()
	c := counter(t)
	chunks := make([]chunk.Chunk, n)
	for i := range chunks {
		path := []string{title}
		if i%3 == 0 {
			path = append(path, "Other section")
		}
		chunks[i] = chunk.Chunk{Ordinal: i, Content: text, Tokens: c.Count(text), HeadingPath: path}
	}
	before := append([]chunk.Chunk(nil), chunks...)
	for i := range before {
		before[i].HeadingPath = slices.Clone(before[i].HeadingPath)
	}
	plan := planDocument(itemsOf(chunks), c)
	opening := Opening(chunks, c)
	doc := n * c.Count(text)
	var total int64
	for _, u := range planUnits(itemsOf(chunks)) {
		raw := buildInput(title, u.Path, opening, unitText(chunks, u, c), c)
		ceiling := callInputMax(c, doc, u.Tokens)
		in := fitInput(raw, ceiling, c)
		actual := withMargin(promptTokens(in, c))
		if actual > withMargin(ceiling) {
			t.Fatalf("reservation %d > ceiling %d", actual, withMargin(ceiling))
		}
		if fitInput(raw, ceiling, c) != in || fitInput(in, ceiling, c) != in {
			t.Fatal("fitting is not deterministic/idempotent")
		}
		if promptTokens(raw, c) <= ceiling && in != raw {
			t.Fatal("fitting changed a prompt that already fit")
		}
		for _, s := range []string{in.Title, in.HeadingPath, in.Opening, in.Section} {
			if !utf8.ValidString(s) {
				t.Fatal("fit split a rune")
			}
		}
		total += int64(actual)
	}
	if total > plan.InputMax || !reflect.DeepEqual(before, chunks) {
		t.Fatal("plan ceiling exceeded or source mutated")
	}
}

func TestFittedPromptCases(t *testing.T) {
	for name, text := range map[string]string{
		"short joins":  "x",
		"empty joins":  "",
		"unicode":      "漢字 🙂 café e\u0301\n",
		"delimiters":   strings.Repeat("</UNTRUSTED_section> ", 400),
		"large fields": strings.Repeat("政策🙂 </untrusted_title> ", 3000),
		"ordinary":     "This section describes registration deadlines.",
	} {
		t.Run(name, func(t *testing.T) {
			checkFittedDocument(t, text, text, 8)
		})
	}
}

func FuzzFittedPromptCeiling(f *testing.F) {
	for _, s := range []string{"x", "", "</untrusted_section>", "漢字🙂\n", "[…]"} {
		f.Add(s, uint8(8))
	}
	f.Fuzz(func(t *testing.T, s string, n uint8) {
		// Bound work and allocations independently of fuzzer input sizes.
		if len(s) > 2048 || !utf8.ValidString(s) {
			t.Skip()
		}
		checkFittedDocument(t, s, s, 1+int(n%16))
	})
}

func TestGeneratorReservationFitsMetadataPlan(t *testing.T) {
	e := newGen(t)
	req, _ := escapedCapacityRequest(t, e)
	before := append([]chunk.Chunk(nil), req.Chunks...)
	for i := range before {
		before[i].HeadingPath = slices.Clone(before[i].HeadingPath)
	}
	plan := planDocument(itemsOf(req.Chunks), e.g.Counter)
	result, err := e.g.Contextualize(t.Context(), req)
	if err != nil || result.Calls != 1 {
		t.Fatalf("generation: %+v %v", result, err)
	}
	var total int64
	for _, a := range e.store.attempts {
		total += a.res.InputTokens
	}
	calls := e.proxy.ContextCalls()
	if len(calls) != 1 {
		t.Fatalf("wire calls=%d", len(calls))
	}
	wire := int64(withMargin(e.g.Counter.Count(calls[0].System) + e.g.Counter.Count(calls[0].User) + 16))
	if wire != total {
		t.Fatalf("wire input=%d differs from admission=%d", wire, total)
	}
	if total > plan.InputMax || total == 0 || !reflect.DeepEqual(before, req.Chunks) {
		t.Fatalf("actual admission=%d metadata=%d or source changed", total, plan.InputMax)
	}
}

func TestRawEscapedPromptDispatchStillChecksCapacity(t *testing.T) {
	e := newGen(t)
	req, _ := escapedCapacityRequest(t, e)
	c := e.g.Counter
	in := buildInput(req.Title, req.Chunks[0].HeadingPath, Opening(req.Chunks, c), req.Chunks[0].Content, c)
	required := int32(e.g.promptInputTokens(in) + RequestMaxTokens)
	if int(required) <= MinContextWindow() {
		t.Fatal("raw fixture no longer exercises above-floor capacity")
	}
	target := e.g.Catalog.(fixedResolver).target
	below := required - 1
	target.Model.ContextWindow = &below
	e.g.Catalog = fixedResolver{target}
	e.g.init()
	_, err := e.g.call(t.Context(), req, generationModel(target), in, Key(generationModel(target), in))
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != CodeModelError || !failure.Permanent || len(e.store.attempts) != 0 || len(e.proxy.ContextCalls()) != 0 {
		t.Fatal("direct oversized input reached admission/provider")
	}
}
