// Checking one question (docs/evaluations.md §2-§3): whether its expected
// documents still exist, then the retrieval check or the full answer, with
// waits for per-minute limits.

package evals

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// maxShownHits is how many documents a result keeps for the editor.
const maxShownHits = 20

// check checks one question. A returned error stops the run (a limit or
// budget refused it, the agent can't answer at all); a question whose
// check failed otherwise gets the error status.
func (x *executor) check(ctx context.Context, c dbgen.EvalCase) (dbgen.InsertEvalResultParams, error) {
	cs := DecodeCase(c)
	p := dbgen.InsertEvalResultParams{RunID: x.run.ID, CaseID: uuid.NullUUID{UUID: c.ID, Valid: true}, Question: c.Question,
		Hits: json.RawMessage(`[]`), Scores: json.RawMessage(`{}`)}
	start := time.Now()
	docs, urls, prefixes, names := cs.Want.existence()
	exists, err := x.s.q.ExpectedDocumentExists(ctx, dbgen.ExpectedDocumentExistsParams{SourceIds: x.sources, DocumentIds: docs,
		Urls: urls, UrlPrefixes: prefixes, Filenames: names})
	if err != nil {
		return p, err
	}
	if !exists {
		p.Status = StatusMissing
		return finished(p, start), nil
	}
	if x.run.Kind == KindAnswer {
		err = x.answer(ctx, cs, &p)
	} else {
		err = x.retrieval(ctx, cs, &p)
	}
	if err != nil && stopsRun(err) {
		return p, err
	}
	if err != nil {
		p.Status, p.Error = StatusError, errorText(err)
	}
	return finished(p, start), nil
}

func finished(p dbgen.InsertEvalResultParams, start time.Time) dbgen.InsertEvalResultParams {
	p.LatencyMs = int32(time.Since(start).Milliseconds())
	return p
}

// retrieval runs the knowledge base's or agent's retrieval and ranks the
// expected documents in the top k.
func (x *executor) retrieval(ctx context.Context, cs Case, p *dbgen.InsertEvalResultParams) error {
	var hits []kbs.Hit
	err := x.retry(ctx, func() error {
		var err error
		if x.t.kb != nil {
			var res kbs.Result
			res, err = x.s.KBs.RetrieveForEvaluation(ctx, x.actor, *x.t.kb, cs.Question, x.meta)
			hits = res.Hits
		} else {
			hits, err = x.s.Agents.EvalRetrieve(ctx, x.actor, *x.t.agent, cs.Question, x.meta)
		}
		return err
	})
	if err != nil {
		return err
	}
	docs := make([]Doc, 0, len(hits))
	for _, h := range hits {
		docs = append(docs, Doc{DocumentID: h.DocumentID, Title: h.Title, URL: h.URL, Filename: h.Filename})
	}
	if k := x.t.cfg.ResultsPerSearch; k > 0 && len(docs) > k {
		docs = docs[:k]
	}
	rank := cs.Want.Rank(docs)
	p.Status = StatusFail
	if rank > 0 {
		r := int32(rank)
		p.Status, p.Rank = StatusPass, &r
	}
	p.Hits, _ = json.Marshal(hitViews(docs, cs.Want))
	return nil
}

// hitViews lists the documents that came back once each, at their best
// rank, marking the expected ones.
func hitViews(docs []Doc, want Expected) []HitView {
	out := []HitView{}
	seen := map[uuid.UUID]bool{}
	for i, d := range docs {
		if seen[d.DocumentID] {
			continue
		}
		seen[d.DocumentID] = true
		out = append(out, HitView{Rank: i + 1, DocumentID: d.DocumentID, Title: d.Title, URL: d.URL, Filename: d.Filename,
			Expected: want.Matches(d)})
		if len(out) == maxShownHits {
			break
		}
	}
	return out
}

// answer asks the agent and scores the answer.
func (x *executor) answer(ctx context.Context, cs Case, p *dbgen.InsertEvalResultParams) error {
	var ans agents.Answer
	var checks *agents.CitationsRecord
	err := x.retry(ctx, func() error {
		var err error
		ans, checks, err = x.s.Agents.EvalAnswer(ctx, x.actor, *x.t.agent, cs.Question, x.meta)
		return err
	})
	if err != nil {
		return err
	}
	text := ans.Text
	p.Answer = &text
	if ans.ErrorCode != "" {
		return apperr.New(http.StatusServiceUnavailable, ans.ErrorCode, ans.ErrorMessage)
	}
	cited, err := x.citedDocs(ctx, ans.Citations)
	if err != nil {
		return err
	}
	refused := ans.Refused || agents.IsRefusal(ans.Text, x.t.agent.Config.RefusalMessage)
	scores, pass := ScoreAnswer(cs.Want, cs.MustMention, ans.Text, cited, refused, checks)
	p.Status = StatusFail
	if pass {
		p.Status = StatusPass
	}
	p.Scores, _ = json.Marshal(scores)
	p.Hits, _ = json.Marshal(hitViews(cited, cs.Want))
	return nil
}

// citedDocs are the documents an answer cites, in citation order, with
// their filenames (citations carry titles and links only).
func (x *executor) citedDocs(ctx context.Context, cites []agents.Citation) ([]Doc, error) {
	ids := make([]uuid.UUID, 0, len(cites))
	for _, c := range cites {
		ids = append(ids, c.DocumentID)
	}
	rows, err := x.s.q.EvalDocumentsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := map[uuid.UUID]dbgen.EvalDocumentsByIDRow{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	out := make([]Doc, 0, len(cites))
	for _, c := range cites {
		d := Doc{DocumentID: c.DocumentID, Title: c.Title, URL: c.URL}
		if r, ok := byID[c.DocumentID]; ok {
			d.Filename, d.URL = r.Filename, r.URL
		}
		out = append(out, d)
	}
	return out, nil
}

// maxRetries is how many times a check waits for a per-minute limit.
const maxRetries = 6

// retry runs fn again after a per-minute limit's Retry-After (at most
// retryWait), a few times.
func (x *executor) retry(ctx context.Context, fn func() error) error {
	for attempt := 0; ; attempt++ {
		err := fn()
		wait, ok := retryAfter(err, x.s.retryWait)
		if !ok || attempt == maxRetries {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

// retryAfter reports a per-minute limit worth waiting for (429 with a short
// Retry-After). Daily quotas and budgets wait until tomorrow: not retried.
func retryAfter(err error, bound time.Duration) (time.Duration, bool) {
	e, ok := apperr.As(err)
	if !ok || e.Status != http.StatusTooManyRequests || e.RetryAfter <= 0 || e.RetryAfter > bound {
		return 0, false
	}
	return e.RetryAfter, true
}

// stopsRun reports an error every other question would get too: a refusal
// by a limit or budget, an agent that can't answer (disabled, invalid, no
// longer there), or shutting down. Model and gateway failures (5xx) only
// fail the question.
func stopsRun(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	e, ok := apperr.As(err)
	return ok && e.Status >= 400 && e.Status < 500
}

func errorText(err error) string {
	if e, ok := apperr.As(err); ok {
		return e.Message
	}
	return "The check failed."
}
