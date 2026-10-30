package contextual

import (
	"slices"
	"strings"

	"github.com/ncecere/grounded/internal/chunk"
)

// Item is what planning needs to know of a passage: where it sits and how long it is. The estimate plans from the stored rows of a source
// (no text is read); ingestion plans from the passages themselves, with the same function, so they agree on the number of calls.
type Item struct {
	Path   []string
	Tokens int
}

// Unit is a run of consecutive passages (First to Last, inclusive) under one heading path. One model call describes one unit, and every
// passage of the unit gets the same context.
type Unit struct {
	First, Last int
	Path        []string
	// Tokens are the passages' tokens added up (before the unit's text is cut to UnitMaxTokens).
	Tokens int
}

// PlanUnits groups a document's passages, in order, into units: a unit ends where the heading path changes, or when one more passage would
// pass UnitMaxTokens or UnitMaxPassages. A passage longer than UnitMaxTokens is a unit of its own (its text is cut when the prompt is made).
// Deterministic: the same items give the same units.
func PlanUnits(items []Item) []Unit {
	var units []Unit
	for i := 0; i < len(items); {
		u := Unit{First: i, Last: i, Path: items[i].Path, Tokens: items[i].Tokens}
		for j := i + 1; j < len(items); j++ {
			if !slices.Equal(items[j].Path, u.Path) || j-i >= UnitMaxPassages || u.Tokens+items[j].Tokens > UnitMaxTokens {
				break
			}
			u.Last, u.Tokens = j, u.Tokens+items[j].Tokens
		}
		units = append(units, u)
		i = u.Last + 1
	}
	return units
}

// ItemsOf describes passages for PlanUnits.
func ItemsOf(chunks []chunk.Chunk) []Item {
	items := make([]Item, len(chunks))
	for i, c := range chunks {
		items[i] = Item{Path: c.HeadingPath, Tokens: c.Tokens}
	}
	return items
}

// cutMark ends a text that was cut to its bound, so the model knows it is not the whole.
const cutMark = "\n[…]"

// CutTokens shortens text to at most n tokens (plus the cut mark), trimming by runes in proportion and checking again, as the embedding
// inputs are shortened. It is deterministic.
func CutTokens(text string, n int, c chunk.TokenCounter) string {
	if n <= 0 {
		return ""
	}
	for i := 0; i < 6; i++ {
		count := c.Count(text)
		if count <= n {
			if i == 0 {
				return text
			}
			return strings.TrimRight(text, " \n\t") + cutMark
		}
		runes := []rune(text)
		keep := len(runes) * n / count * 95 / 100
		text = string(runes[:max(keep, 1)])
	}
	return strings.TrimRight(text, " \n\t") + cutMark
}

// Opening is the start of the document that every call is given: its passages from the first, cut to ExcerptTokens.
func Opening(chunks []chunk.Chunk, c chunk.TokenCounter) string {
	var b strings.Builder
	total := 0
	for _, ch := range chunks {
		if total >= ExcerptTokens {
			break
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(ch.Content)
		total += ch.Tokens
	}
	return CutTokens(b.String(), ExcerptTokens, c)
}

// UnitText is the text of a unit's passages, cut to UnitMaxTokens.
func UnitText(chunks []chunk.Chunk, u Unit, c chunk.TokenCounter) string {
	parts := make([]string, 0, u.Last-u.First+1)
	for _, ch := range chunks[u.First : u.Last+1] {
		parts = append(parts, ch.Content)
	}
	return CutTokens(strings.Join(parts, "\n\n"), UnitMaxTokens, c)
}
