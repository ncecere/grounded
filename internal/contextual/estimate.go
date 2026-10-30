package contextual

import (
	"github.com/ncecere/grounded/internal/chunk"
)

// cutSlack is what the cut mark and the line breaks around a bounded field can add beyond its bound, in tokens.
const cutSlack = 8

// PromptOverhead is what a call carries besides the document's text: the instructions and the empty frame of the user message.
func PromptOverhead(c chunk.TokenCounter) int {
	return c.Count(SystemPrompt) + c.Count(UserMessage(Input{})) + 4*cutSlack
}

// CallInputMax is the most input tokens one call of a document can carry, counted with c: the overhead, the title and heading path at their
// bounds, the start of the document (at most its own length) and the unit's text (at most its own length). docTokens is the document's
// passages' tokens added up; unitTokens the unit's.
func CallInputMax(c chunk.TokenCounter, docTokens, unitTokens int) int {
	return PromptOverhead(c) + TitleMaxTokens + PathMaxTokens + min(docTokens, ExcerptTokens+cutSlack) + min(unitTokens, UnitMaxTokens+cutSlack)
}

// WithMargin adds the share for tokenizer differences: the gateway's model counts differently from the counter used here.
func WithMargin(n int) int { return n + n*InputMarginPercent/100 }

// DocPlan is the work of one document.
type DocPlan struct {
	Passages, Units int
	// Over: more sections than MaxUnitsPerDocument; the document would be embedded without context and no call is made.
	Over bool
	// InputMax is the most input tokens its calls can carry together (with the margin).
	InputMax int64
}

// PlanDocument plans one document's calls from its passages' sizes and heading paths.
func PlanDocument(items []Item, c chunk.TokenCounter) DocPlan {
	p := DocPlan{Passages: len(items)}
	units := PlanUnits(items)
	p.Units = len(units)
	if p.Units > MaxUnitsPerDocument {
		p.Over = true
		return p
	}
	doc := 0
	for _, it := range items {
		doc += it.Tokens
	}
	for _, u := range units {
		p.InputMax += int64(WithMargin(CallInputMax(c, doc, u.Tokens)))
	}
	return p
}

// Totals add documents' plans up.
type Totals struct {
	Documents, Passages, Units, Calls int64
	DocumentsOver, PassagesOver       int64
	// InputTokensMax and OutputTokensMax bound the model tokens of Calls calls; EmbeddingTokensAdded bounds what the contexts add to the
	// embedding inputs.
	InputTokensMax, OutputTokensMax, EmbeddingTokensAdded int64
}

// Add counts one document.
func (t *Totals) Add(p DocPlan) {
	t.Documents++
	t.Passages += int64(p.Passages)
	t.Units += int64(p.Units)
	if p.Over {
		t.DocumentsOver++
		t.PassagesOver += int64(p.Passages)
		return
	}
	t.Calls += int64(p.Units)
	t.InputTokensMax += p.InputMax
	t.OutputTokensMax += int64(p.Units) * RequestMaxTokens
	t.EmbeddingTokensAdded += int64(p.Passages) * (ContextMaxTokens + LabelTokens)
}

// Merge adds another source's totals.
func (t *Totals) Merge(o Totals) {
	t.Documents += o.Documents
	t.Passages += o.Passages
	t.Units += o.Units
	t.Calls += o.Calls
	t.DocumentsOver += o.DocumentsOver
	t.PassagesOver += o.PassagesOver
	t.InputTokensMax += o.InputTokensMax
	t.OutputTokensMax += o.OutputTokensMax
	t.EmbeddingTokensAdded += o.EmbeddingTokensAdded
}

// UnknownCallTokensMax is the most one attempt of unknown usage (a timeout, an error, a crash) can have cost in tokens: an input at the
// per-call bound and a full requested output. It bounds what the provider may have billed; it is not a measure.
func UnknownCallTokensMax(c chunk.TokenCounter) (in, out int) {
	return WithMargin(CallInputMax(c, ExcerptTokens+cutSlack, UnitMaxTokens+cutSlack)), RequestMaxTokens
}
