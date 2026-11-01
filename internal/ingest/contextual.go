// Contextual chunks in ingestion (docs/contextual-chunks.md, ADR-0028): the one place that decides what text a document's passages are
// embedded with. Without a snapshot for the source and profile (every source and profile that has not been through an index preview with
// contextualChunks) it returns exactly what embedTexts did before, and nothing else here runs.

package ingest

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/contextual"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// WaitContextLimit is the document error code of a document waiting for a contextual-chunks limit (cap, budget or daily quota).
const WaitContextLimit = "context_limit"

// ctxScope says whose passages are embedded, and for which profile.
type ctxScope struct {
	src   dbgen.DataSource
	docID uuid.UUID
	title string
	team  uuid.NullUUID
	user  uuid.NullUUID
	own   bool // the source's own profile (a live document), not an extra set
}

// ctxMark is how a document was embedded for a profile; written in the transaction that writes its chunks.
type ctxMark struct {
	profileID  uuid.UUID
	version    int32
	state      string
	code       string
	passages   int
	contextual int
}

// snapshot returns the contextual settings this source was snapshotted with for the target's profile, or nil when the document is
// embedded as it always was: no generator, a profile without context, or a source that was not part of the preview that built it.
func (p *Processor) snapshot(ctx context.Context, q *dbgen.Queries, srcID uuid.UUID, t catalog.EmbedTarget) (*dbgen.SetContextual, error) {
	if p.Contextual == nil || !t.Profile.Contextual {
		return nil, nil
	}
	snap, err := q.GetSetContextual(ctx, dbgen.GetSetContextualParams{SourceID: srcID, ProfileID: t.Profile.ID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if snap.PromptVersion != contextual.PromptVersion {
		return nil, &contextual.StopError{Reason: "this worker does not support the contextual snapshot's prompt version"}
	}
	return &snap, nil
}

// contextualTexts are the inputs to embed for a document's passages. mark is nil when contextual chunks do not apply.
func (p *Processor) contextualTexts(ctx context.Context, sc ctxScope, version int32, t catalog.EmbedTarget, chunks []chunk.Chunk) ([]string, *ctxMark, error) {
	base := p.embedTexts(t, sc.title, chunks)
	q := dbgen.New(p.Pool)
	snap, err := p.snapshot(ctx, q, sc.src.ID, t)
	if err != nil || snap == nil {
		return base, nil, err
	}
	mark := &ctxMark{profileID: t.Profile.ID, version: version, passages: len(chunks)}
	settings, err := q.GetSourceContextual(ctx, sc.src.ID)
	if err != nil && !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, nil, err
	}
	phase := contextual.PhaseLive
	if !sc.own {
		if status, err := q.EmbeddingSetStatus(ctx, dbgen.EmbeddingSetStatusParams{SourceID: sc.src.ID, ProfileID: t.Profile.ID}); err == nil && status == "building" {
			phase = contextual.PhaseBuild
		}
	}
	if p.ContextualOff || !settings.Enabled {
		if phase == contextual.PhaseBuild {
			return nil, nil, &contextual.Failure{Code: contextual.CodeOff, Err: errors.New("contextual chunks were switched off while the set was built"), Permanent: true}
		}
		mark.state = contextual.StateOff
		return base, mark, nil
	}
	req := contextual.Request{SourceID: sc.src.ID, ProfileID: t.Profile.ID, DocumentID: sc.docID, Version: version, Team: sc.team, User: sc.user, Phase: phase,
		Model: snap.ModelID, Policy: snap.FailurePolicy, Title: sc.title, Chunks: chunks, Checkpoint: p.checkpoint(sc, t, snap.ModelID)}
	if phase == contextual.PhaseBuild {
		req.Cap = int(settings.MaxCalls)
	} else {
		req.Cap, req.Since = int(settings.MaxCallsPerDay), startOfDay(time.Now())
	}
	res, err := p.Contextual.Contextualize(ctx, req)
	if err != nil {
		return nil, nil, err
	}
	mark.state, mark.code = res.State, string(res.Code)
	if res.State != contextual.StateContext {
		return base, mark, nil
	}
	texts, n := p.withContexts(t, sc.title, chunks, res.Contexts)
	mark.contextual = n
	if n == 0 {
		mark.state = contextual.StateNoRoom
	}
	return texts, mark, nil
}

func startOfDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// withContexts embeds each passage with its context where the embedding model's input has room for it, without ever cutting the passage's own
// text: a passage with no room is embedded as it always was. It returns how many passages got one.
func (p *Processor) withContexts(t catalog.EmbedTarget, title string, chunks []chunk.Chunk, contexts []string) ([]string, int) {
	texts := make([]string, len(chunks))
	n := 0
	for i, c := range chunks {
		base := chunk.EmbedText(title, c)
		texts[i] = t.Profile.DocumentPrefix + truncateTokens(base, t.MaxInputTokens, p.Counter)
		ctxText := contexts[i]
		if ctxText == "" {
			continue
		}
		if max := t.MaxInputTokens; max > 0 {
			room := max - p.Counter.Count(base) - contextual.LabelTokens
			if room < contextual.MinRoomTokens {
				continue
			}
			ctxText = truncateTokens(ctxText, min(room, contextual.ContextMaxTokens), p.Counter)
		}
		full := chunk.EmbedTextContext(title, c, ctxText)
		if t.MaxInputTokens > 0 && p.Counter.Count(full) > t.MaxInputTokens {
			continue // counted differently than planned: the passage's own text wins
		}
		texts[i] = t.Profile.DocumentPrefix + full
		n++
	}
	return texts, n
}

// checkpoint gates calls and cached returns: platform/source opt-in, current
// own-profile or extra-set scope, and current model/connection eligibility.
func (p *Processor) checkpoint(sc ctxScope, t catalog.EmbedTarget, modelID uuid.UUID) func(context.Context) error {
	return func(ctx context.Context) error {
		if p.ContextualOff {
			return &contextual.StopError{Reason: "the platform switch is off"}
		}
		q := dbgen.New(p.Pool)
		set, err := q.GetSourceContextual(ctx, sc.src.ID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && !set.Enabled) {
			return &contextual.StopError{Reason: "the source is switched off"}
		} else if err != nil {
			return err
		}
		if !sc.own {
			status, err := q.EmbeddingSetStatus(ctx, dbgen.EmbeddingSetStatusParams{SourceID: sc.src.ID, ProfileID: t.Profile.ID})
			if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && status == "deleting") {
				return &contextual.StopError{Reason: "the set was discarded"}
			} else if err != nil {
				return err
			}
		}
		expectedOwn := uuid.Nil
		if sc.own {
			expectedOwn = t.Profile.ID
		}
		return modelAllowed(ctx, q, sc.src.ID, modelID, expectedOwn)
	}
}

// modelAllowed checks current own-profile identity, source classification,
// model/connection eligibility and configured prompt capacity (ADR-0006 rule 4).
func modelAllowed(ctx context.Context, q *dbgen.Queries, sourceID, modelID, expectedOwn uuid.UUID) error {
	src, err := q.GetSource(ctx, sourceID)
	if err != nil {
		return err
	}
	if expectedOwn != uuid.Nil && src.EmbeddingProfileID != expectedOwn {
		return &contextual.StopError{Reason: "the source's own embedding profile changed"}
	}
	m, err := q.GetModel(ctx, modelID)
	if err != nil {
		return &contextual.Failure{Code: contextual.CodeForbidden, Err: err, Permanent: true}
	}
	ok, err := catalog.ModelAllows(ctx, q, m, src.Classification)
	if err != nil {
		return err
	}
	if !ok || !m.Enabled || m.Kind != catalog.KindChat {
		return &contextual.Failure{Code: contextual.CodeForbidden, Err: errors.New("the context model may not read this source's classification, or is disabled"), Permanent: true}
	}
	conn, err := q.GetConnection(ctx, m.ConnectionID)
	if err != nil {
		return err
	}
	if !conn.Enabled {
		return &contextual.Failure{Code: contextual.CodeForbidden, Err: errors.New("the context model connection is disabled"), Permanent: true}
	}
	if m.ContextWindow == nil {
		return &contextual.Failure{Code: contextual.CodeModelError, Err: errors.New("the configured context model window is unknown"), Permanent: true}
	}
	if int(*m.ContextWindow) < contextual.MinContextWindow() {
		return &contextual.Failure{Code: contextual.CodeUnavailable, Err: errors.New("the configured context model window is too small for the bounded prompt")}
	}
	return nil
}

// contextualRechunk reports whether a source's own-profile re-chunk must embed every passage again: a passage's context depends on its
// section, so an unchanged passage's old vector is not known to match (docs/contextual-chunks.md section 4).
func (p *Processor) contextualRechunk(ctx context.Context, q *dbgen.Queries, srcID uuid.UUID, t catalog.EmbedTarget) (bool, error) {
	snap, err := p.snapshot(ctx, q, srcID, t)
	return snap != nil, err
}

// writeMark records how a document was embedded, in the transaction that wrote its chunks.
func writeMark(ctx context.Context, tx pgx.Tx, srcID, docID uuid.UUID, m *ctxMark) error {
	if m == nil {
		return nil
	}
	return dbgen.New(tx).UpsertDocumentContextual(ctx, dbgen.UpsertDocumentContextualParams{DocumentID: docID, ProfileID: m.profileID, SourceID: srcID,
		Version: m.version, State: m.state, Code: m.code, Passages: int32(m.passages), Contextual: int32(m.contextual)})
}

// classifyContext classifies a document that could not be given context. The messages are fixed text: never the reply or the prompt.
func classifyContext(err error) (outcome, bool) {
	var f *contextual.Failure
	if !errors.As(err, &f) {
		return outcome{}, false
	}
	o := outcome{status: StatusFailed, code: string(f.Code)}
	switch f.Code {
	case contextual.CodeUnavailable:
		o.retry, o.message = true, "The model that writes contextual-chunk descriptions is unavailable. This document is retried."
	case contextual.CodeInvalid:
		o.message = "The model's description of this document could not be used. Retry it, or set the source's failure policy to embed such documents without context."
	case contextual.CodeForbidden:
		o.message = "The model for contextual chunks may not read this source's classification, or is disabled. Ask a platform admin."
	case contextual.CodeOff:
		o.message = "Contextual chunks were switched off for this source while its index was built. Discard the preview."
	default:
		o.message = "The model or request configuration cannot produce a contextual-chunk description. Ask a platform admin to check the context window and gateway settings."
	}
	return o, true
}

// contextLimit is a stop that is a wait, not a failure: the team's budget or daily quota, or a cap. It says until when and why people see.
type contextLimit struct {
	Until   time.Time
	Message string
}

// ContextWait reports whether err is a contextual-chunks limit and how long a job should wait: until the limit's time, or ten minutes when
// there is none (a build's cap, a budget: they change when an admin acts, so the job looks again).
func ContextWait(err error) (time.Duration, string, bool) {
	l, ok := asContextLimit(err)
	if !ok {
		return 0, "", false
	}
	d := 10 * time.Minute
	if !l.Until.IsZero() {
		d = min(max(time.Until(l.Until), time.Minute), 24*time.Hour)
	}
	return d, l.Message, true
}

func asContextLimit(err error) (contextLimit, bool) {
	var w *contextual.Wait
	var c *contextual.CapError
	switch {
	case errors.As(err, &w):
		return contextLimit{Until: w.Until, Message: w.Message}, true
	case errors.As(err, &c):
		msg := c.Error() + ". It continues when the limit is raised"
		if c.Daily {
			msg += " or after midnight UTC"
		}
		return contextLimit{Until: c.Until, Message: msg + "."}, true
	}
	return contextLimit{}, false
}

// waitForContext parks a document until a contextual-chunks limit allows it: pending, not counted as an attempt, with the reason people see.
func (p *Processor) waitForContext(ctx context.Context, doc dbgen.Document, l contextLimit) error {
	paused, err := p.paused(ctx)
	if err != nil {
		return err
	}
	until := l.Until
	if until.IsZero() {
		until = time.Now().Add(10 * time.Minute)
	}
	return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		n, err := dbgen.New(tx).WaitDocument(ctx, dbgen.WaitDocumentParams{ID: doc.ID, WaitingUntil: &until, ErrorCode: WaitContextLimit, ErrorMessage: clip(l.Message, 1000)})
		if err != nil || n == 0 {
			return err
		}
		return p.refill(ctx, tx, paused)
	})
}

// WakeContextWaiting makes a team's documents waiting for a contextual-chunks limit (every team's when team is not set) pending again and
// kicks the dispatcher: a cap or the budget changed. A document the limit still stops waits again. client may be insert-only; nil skips the
// kick (the periodic dispatch picks them up).
func WakeContextWaiting(ctx context.Context, pool *pgxpool.Pool, client *river.Client[pgx.Tx], team uuid.NullUUID) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var err error
		n, err = dbgen.New(tx).WakeWaitingDocuments(ctx, dbgen.WakeWaitingDocumentsParams{ErrorCode: WaitContextLimit, TeamID: team})
		if err != nil || n == 0 || client == nil {
			return err
		}
		return Kick(ctx, client, tx)
	})
	return n, err
}
