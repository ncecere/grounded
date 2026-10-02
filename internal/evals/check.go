// Checking one question (docs/evaluations.md §2-§3): whether its expected
// documents are in the knowledge base (diagnosis.go), then the retrieval
// check or the full answer, with waits for per-minute limits.

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
// check failed otherwise gets the error status. A question none of whose
// expected documents is in the knowledge base isn't scored (missing, with
// the reason), but what the search returns is still recorded.
func (x *executor) check(ctx context.Context, c dbgen.EvalCase) (dbgen.InsertEvalResultParams, error) {
	cs := DecodeCase(c)
	p := dbgen.InsertEvalResultParams{RunID: x.run.ID, CaseID: uuid.NullUUID{UUID: c.ID, Valid: true}, Question: c.Question,
		Hits: json.RawMessage(`[]`), Scores: json.RawMessage(`{}`)}
	start := time.Now()
	diag, err := x.diagnose(ctx, cs)
	if err != nil {
		return p, err
	}
	var sc *AnswerScores
	switch {
	case diag.Missing != "":
		p.Status = StatusMissing
		if err = x.retrieval(ctx, cs, &p, &diag); err != nil && !stopsRun(err) {
			err = nil // what came back stays empty
		}
	case x.run.Kind == KindAnswer:
		sc, err = x.answer(ctx, cs, &p)
	default:
		err = x.retrieval(ctx, cs, &p, &diag)
	}
	if err != nil && stopsRun(err) {
		return p, err
	}
	if err != nil {
		p.Status, p.Error = StatusError, errorText(err)
	}
	p.Scores = encodeScores(sc, diag)
	return finished(p, start), nil
}

func finished(p dbgen.InsertEvalResultParams, start time.Time) dbgen.InsertEvalResultParams {
	p.LatencyMs = int32(time.Since(start).Milliseconds())
	return p
}

// retrieval runs the knowledge base's or agent's retrieval, records what
// came back and ranks the expected documents in the top k. When none is
// there, a deeper search finds their rank beyond k.
func (x *executor) retrieval(ctx context.Context, cs Case, p *dbgen.InsertEvalResultParams, d *Diagnosis) error {
	docs, err := x.search(ctx, cs.Question, x.t.depth)
	if err != nil {
		return err
	}
	if d.K > 0 && len(docs) > d.K {
		docs = docs[:d.K]
	}
	rankItems(d.Expected, docs)
	p.Hits, _ = json.Marshal(hitViews(docs, cs.Want))
	if d.Missing != "" {
		return nil
	}
	p.Status = StatusFail
	if rank := cs.Want.Rank(docs); rank > 0 {
		r := int32(rank)
		p.Status, p.Rank = StatusPass, &r
		return nil
	}
	return x.rankDeeper(ctx, cs, d)
}

// rankDeeper searches for DeepSearch results, only for the ranks of the
// expected documents beyond k ("found at #11"). When that search fails,
// the ranks are left out, unless the failure stops the run.
func (x *executor) rankDeeper(ctx context.Context, cs Case, d *Diagnosis) error {
	if d.K >= DeepSearch {
		return nil
	}
	docs, err := x.search(ctx, cs.Question, DeepSearch)
	if err != nil {
		if stopsRun(err) {
			return err
		}
		return nil
	}
	rankItems(d.Expected, docs)
	d.Depth = DeepSearch
	return nil
}

// search runs the knowledge base's or agent's retrieval for a question:
// with its own results per search (depth 0) or for depth results.
func (x *executor) search(ctx context.Context, question string, depth int) ([]Doc, error) {
	var hits []kbs.Hit
	err := x.retry(ctx, func() error {
		var err error
		if x.t.kb != nil {
			var res kbs.Result
			res, err = x.s.KBs.RetrieveForEvaluation(ctx, x.actor, *x.t.kb, question, depth, x.t.cfg.Rerank != RerankOn, x.meta)
			hits = res.Hits
		} else {
			hits, err = x.s.Agents.EvalRetrieve(ctx, x.actor, *x.t.agent, question, depth, x.meta)
		}
		return err
	})
	docs := make([]Doc, 0, len(hits))
	for _, h := range hits {
		docs = append(docs, Doc{DocumentID: h.DocumentID, Title: h.Title, URL: h.URL, Filename: h.Filename, Snippet: shortSnippet(h.Content)})
	}
	return docs, err
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
			Expected: want.Matches(d), Snippet: d.Snippet})
		if len(out) == maxShownHits {
			break
		}
	}
	return out
}

// answer asks the agent and scores the answer.
func (x *executor) answer(ctx context.Context, cs Case, p *dbgen.InsertEvalResultParams) (*AnswerScores, error) {
	var ans agents.Answer
	var checks *agents.CitationsRecord
	err := x.retry(ctx, func() error {
		var err error
		ans, checks, err = x.s.Agents.EvalAnswer(ctx, x.actor, *x.t.agent, cs.Question, x.meta)
		return err
	})
	if err != nil {
		return nil, err
	}
	text := ans.Text
	p.Answer = &text
	if ans.ErrorCode != "" {
		return nil, apperr.New(http.StatusServiceUnavailable, ans.ErrorCode, ans.ErrorMessage)
	}
	cited, err := x.citedDocs(ctx, ans.Citations)
	if err != nil {
		return nil, err
	}
	refused := ans.Refused || agents.IsRefusal(ans.Text, x.t.agent.Config.RefusalMessage)
	scores, pass := ScoreAnswer(cs.Want, cs.MustMention, ans.Text, cited, refused, checks)
	p.Status = StatusFail
	if pass {
		p.Status = StatusPass
	}
	p.Hits, _ = json.Marshal(citationViews(ans.Citations, cited, cs.Want))
	return &scores, nil
}

// citationViews lists an answer's citations as it numbers them, one per
// marker ([1], [2]…, several of the same document included), with the
// cited passage, marking the expected documents. docs are the cited
// documents in citation order (citedDocs).
func citationViews(cites []agents.Citation, docs []Doc, want Expected) []HitView {
	out := make([]HitView, 0, len(cites))
	for i, c := range cites {
		d := docs[i]
		out = append(out, HitView{Rank: i + 1, N: c.N, DocumentID: d.DocumentID, Title: d.Title, URL: d.URL, Filename: d.Filename,
			Expected: want.Matches(d), Snippet: c.Snippet, HeadingPath: c.HeadingPath, PageStart: c.PageStart, PageEnd: c.PageEnd})
	}
	return out
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
