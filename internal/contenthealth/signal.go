package contenthealth

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The signals of a report, in the order they are collected and shown.
const (
	SignalStale            = "stale"
	SignalBrokenLink       = "broken_link"
	SignalDuplicate        = "duplicate"
	SignalNeverCited       = "never_cited"
	SignalIngestionFailure = "ingestion_failure"
)

// What a signal's measurement is: it was made, it cannot apply to this scope, or it could not be made (with a reason).
// A count of zero is only ever shown for a measured signal.
const (
	StateMeasured      = "measured"
	StateNotApplicable = "not_applicable"
	StateUnavailable   = "unavailable"
)

// Reasons a signal is not applicable or unavailable.
const (
	ReasonNoSources      = "no_sources"
	ReasonNoDocuments    = "no_documents"
	ReasonOneSource      = "one_source"
	ReasonNoWebSources   = "no_web_sources"
	ReasonNoCrawlRecord  = "no_crawl_record"
	ReasonNoAnswers      = "no_answers"
	ReasonTooFewAnswers  = "too_few_answers"
	ReasonTooManyAnswers = "too_many_answers"
	// ReasonTooManyAgents: the team has more agents than a report reads answer events for (MaxAgents). Never a silently shorter list.
	ReasonTooManyAgents = "too_many_agents"
	// ReasonNoExposure: no source of the scope could be judged: no active published agent reaches it through a knowledge base, or
	// the answers kept since it became reachable are too few, or its documents were added after that.
	ReasonNoExposure = "no_exposure"
	ReasonTimedOut   = "timed_out"
)

// Why a web source's links are unknown.
const (
	LinkObserved      = "observed"
	LinkUnknown       = "unknown"
	LinkNotApplicable = "not_applicable"

	LinkNeverCrawled      = "never_crawled"
	LinkPageRefetchLatest = "page_refetch_latest"
	LinkNoCrawlRecord     = "no_crawl_record"
	// LinkSignalTimedOut: the signal that reads the crawl records ran out of time, so nothing is known about this source's links.
	LinkSignalTimedOut = "signal_timed_out"
)

// What the not-cited signal could say about a source (its coverage's CiteState).
const (
	CiteNone         = ""                // the signal did not measure it
	CiteJudged       = "judged"          // an active published agent reaches it and enough answers were kept since
	CiteNotServed    = "not_served"      // no active published agent reaches it through a knowledge base
	CiteTooFewAnswer = "too_few_answers" // fewer than MinAnswers kept answers of agents that reach it, since it was reachable
)

// Params are the thresholds a report is made with.
type Params struct {
	StaleDays          int
	CitationWindowDays int
}

// Source is a source in a report's scope, with the revision and classification the report collected it at.
type Source struct {
	ID             uuid.UUID
	Type           string
	Revision       int64
	Classification string
}

// Coverage is what a report knew about one source; signals add to it.
type Coverage struct {
	SourceID      uuid.UUID
	Type          string
	Documents     int32
	Ready         int32
	ReadyNoDate   int32
	ReadyNoHash   int32
	LinkState     string
	LinkReason    string
	LinkCrawlAt   *time.Time
	LinkTruncated bool
	LinkFailed    int32
	// LinkCrawlID is the crawl whose record was read; a read hides the URLs once a newer completed crawl exists.
	LinkCrawlID uuid.UUID
	// SourceRevision and SourceClassification are what the source was when collected; a read hides its URLs once they changed.
	SourceRevision       int64
	SourceClassification string
	// CiteState says what the not-cited signal could say about the source; ExposedSince is when it became reachable by an active
	// published agent (rounded up to a UTC day), ExposureAnswers the kept answers of such agents since.
	CiteState       string
	ExposedSince    *time.Time
	ExposureAnswers int32
}

// Env is what a signal may read: the team, its sources in scope, the as-of time and the thresholds. It holds no network
// client and no model: a signal reads the database and nothing else.
type Env struct {
	Q        *dbgen.Queries
	TeamID   uuid.UUID
	Sources  []Source
	AsOf     time.Time
	Params   Params
	Coverage map[uuid.UUID]*Coverage
	// AnswerScanLimit is the most answer events the not-cited signal reads (MaxAnswerScan).
	AnswerScanLimit int64
}

// stage is a copy of the environment whose coverage is private to one signal: a signal that fails or runs out of time must not
// leave a half-written coverage behind (a source marked "observed" by a signal that ended "timed out").
func (e *Env) stage() *Env {
	c := *e
	c.Coverage = make(map[uuid.UUID]*Coverage, len(e.Coverage))
	for id, cov := range e.Coverage {
		cp := *cov
		c.Coverage[id] = &cp
	}
	return &c
}

// SourceIDs are the IDs of the sources in scope.
func (e *Env) SourceIDs() []uuid.UUID {
	ids := make([]uuid.UUID, len(e.Sources))
	for i, s := range e.Sources {
		ids[i] = s.ID
	}
	return ids
}

// readyDocuments is how many ready documents the scope holds.
func (e *Env) readyDocuments() (ready, all int64) {
	for _, c := range e.Coverage {
		ready += int64(c.Ready)
		all += int64(c.Documents)
	}
	return ready, all
}

// Finding is one thing worth a look: IDs, enums, counts and times. It never holds a title, a name, a message, a hash or
// text from a document or an answer, so a snapshot cannot show what was removed or renamed. (A link failure's URL is the
// one reference that is itself the finding.) A signal added later (the PII report, #37) follows the same rule: Code is a
// class, never the text that matched.
type Finding struct {
	SourceID    uuid.UUID
	DocumentID  uuid.UUID // uuid.Nil: none (a link failure)
	Ref         string
	GroupNo     int32
	GroupSize   int32
	Code        string
	Detail      string
	Value       int64
	ObservedAt  time.Time // zero: unknown
	ConfirmedAt time.Time
}

// Result is what a signal measured.
type Result struct {
	State  string
	Reason string
	// Found is the true number of findings (for duplicates, of groups), which may exceed those kept (Truncated).
	Found     int64
	Truncated bool
	// Counts are named numbers that qualify the measurement (documents judged, answers seen, ...).
	Counts        map[string]int64
	ObservedSince *time.Time
	Findings      []Finding
}

func notApplicable(reason string) Result { return Result{State: StateNotApplicable, Reason: reason} }
func unavailable(reason string) Result   { return Result{State: StateUnavailable, Reason: reason} }

// Signal is one kind of finding. The five of the report register in Registry; the PII report (#37) can add one without a
// schema change (findings carry a free signal name, a code and a number). No such signal exists now, and a test fails if
// one is registered before its own decision.
type Signal interface {
	// Name is the signal's key, at most 32 characters.
	Name() string
	// Collect measures the signal for the scope. It must be bounded by its context and by MaxFindingsPerSignal, and must
	// not make a network call. It receives a staged copy of the environment: what it writes to the coverage is kept only when it
	// returns without error and in time.
	Collect(ctx context.Context, env *Env) (Result, error)
}

// timeoutNoter is implemented by a signal that records coverage: when it runs out of time, it says what its sources' coverage is
// then (never what a half-finished run wrote).
type timeoutNoter interface {
	NoteTimeout(env *Env)
}

// Registry is the signals of a report, in order.
func Registry() []Signal {
	return []Signal{staleSignal{}, linkSignal{}, duplicateSignal{}, citedSignal{}, failureSignal{}}
}
