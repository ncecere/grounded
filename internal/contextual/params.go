// Package contextual writes the short context that is put in front of a passage in the text sent to the embedding model (A4, #21;
// docs/contextual-chunks.md, ADR-0028).
//
// The context is embedding input and nothing else: it is never stored with a passage, returned by an API, shown or cited. One model call
// describes one section of a document (a unit of consecutive passages); the bounds of the prompt and of the reply are constants of the
// prompt version, so the work of a document, and the estimate of it, are bounded before anything is sent.
package contextual

import "fmt"

// PromptVersion changes with anything that can change what is sent or kept: the prompt, a bound below, the cleaning of a reply. It is part of
// every cache key, so old text is never reused for new rules.
const PromptVersion = 1

// Bounds of prompt version 1 (docs/contextual-chunks.md section 7).
const (
	// TitleMaxTokens and PathMaxTokens bound the document title and the heading path in the prompt.
	TitleMaxTokens = 60
	PathMaxTokens  = 80
	// ExcerptTokens is how much of the start of the document each call is given, so every section is described in the document's terms.
	ExcerptTokens = 400
	// UnitMaxTokens and UnitMaxPassages bound a section's text (a longer one is cut, visibly) and how many passages share one call.
	UnitMaxTokens   = 1600
	UnitMaxPassages = 8
	// MaxUnitsPerDocument: a document with more sections is embedded without context and marked (too_large).
	MaxUnitsPerDocument = 40
	// RequestMaxTokens is the output limit sent with the request (a model that reasons spends part of it).
	RequestMaxTokens = 384
	// ContextMaxTokens and ContextMaxChars bound the reply that is kept.
	ContextMaxTokens = 100
	ContextMaxChars  = 500
	// ContextMinChars: a shorter reply is not a description.
	ContextMinChars = 12
	// MinRoomTokens: a passage with less room than this in the embedding model's input leaves the context out.
	MinRoomTokens = 16
	// LabelTokens is what "Context: " and its separators add to an input beyond the context itself.
	LabelTokens = 6
	// InputMargin is the share added to the counted input of a call for tokenizer differences, in the estimate: 25%.
	InputMarginPercent = 25
)

// Phases of a model attempt: one made while a set is being built, and one made for a document processed after it.
const (
	PhaseBuild = "build"
	PhaseLive  = "live"
)

// Failure policies (source_contextual.failure_policy).
const (
	PolicyFail  = "fail"
	PolicyPlain = "plain"
)

// Marks (document_contextual.state): how a document was embedded for a profile.
const (
	StateContext  = "context"   // with context
	StateFallback = "fallback"  // without it, under the plain policy
	StateTooLarge = "too_large" // more sections than MaxUnitsPerDocument
	StateOff      = "off"       // the source (or the platform) was switched off
	StateNoRoom   = "no_room"   // no passage had room for a context
)

// Outcomes of an attempt (contextual_calls.outcome).
const (
	OutcomeStarted   = "started"
	OutcomeOK        = "ok"
	OutcomeRefused   = "refused"
	OutcomeInvalid   = "invalid"
	OutcomeError     = "error"
	OutcomeTimeout   = "timeout"
	OutcomeCancelled = "cancelled"
)

// Caps (source_contextual): the defaults and the limits of what an admin may set.
const (
	DefaultMaxCalls = 200
	MinCalls        = 1
	MaxCallsLimit   = 100000
)

// ValidPolicy reports whether p is a failure policy.
func ValidPolicy(p string) bool { return p == PolicyFail || p == PolicyPlain }

// Code is a stable error code for a document that could not be given context. Stored on documents and sets (never the reply).
type Code string

const (
	CodeUnavailable Code = "context_unavailable"     // the model could not be reached; retried
	CodeInvalid     Code = "context_invalid"         // the reply was unusable
	CodeForbidden   Code = "context_model_forbidden" // the model may not read the source's classification, or is gone
	CodeOff         Code = "context_off"             // the source was switched off while it was being built
	CodeModelError  Code = "context_model_error"     // the gateway rejected the request (key, model name or request): needs an admin
)

// Failure is a document that could not be given context: the code names why, Err is the cause (never the text of a prompt or a reply).
type Failure struct {
	Code      Code
	Err       error
	Permanent bool
}

// Error is safe for job logs and stored status: a provider may echo document
// text in its error. Keep that cause only behind Unwrap, never in the string.
func (f *Failure) Error() string { return fmt.Sprintf("contextual chunks: %s", f.Code) }
func (f *Failure) Unwrap() error { return f.Err }
