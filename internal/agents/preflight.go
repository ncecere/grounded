// The reads an answer makes before its conversation is stored, run together (#251). Before, admission, the knowledge
// bases, the caller's document permissions, the rerank and SystemOne plans and the history were read one after another,
// so the wait before the first model call was their sum; now it is the slowest of them.

package agents

import (
	"context"
	"slices"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/parallel"
	"github.com/ncecere/grounded/internal/rerank"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// preflightPlans are the platform's rerank and SystemOne plans read with the other steps, applied once the answer
// cache has said whether they're needed, and their settings revisions for the cache's key (cache.go). Each comes
// from one read of its settings, so a saved answer is keyed by the settings that produced it.
type preflightPlans struct {
	rerank    *rerank.Plan
	rerankRev int64
	rerankOK  bool // the rerank settings were read (else the answer isn't cached: its key is unknown)
	systemOne systemone.Plans
	s1Err     error
}

// preflight runs admission and the reads that don't depend on each other concurrently: admission (the limits, the
// concurrent-chat slot and the access log, admit.go), the knowledge bases and whether they hold restricted documents,
// the caller's document permissions, the rerank and SystemOne plans, and a stored conversation's recent turns. It sets
// the retriever. release frees the chat slot.
//
// It answers as the serial steps did. Every step runs to its end: none is cancelled by another's failure, and none is
// left running. When several fail, the error is the one the serial order met first (admission, then the knowledge
// bases, the caller and the restricted check), whichever finished first, so a refused question gets the same answer
// every time; and the chat slot is released when any other step failed. The plans never fail an answer (reranking and
// SystemOne fail open); the history's error is returned where the serial steps met it, when the conversation is
// stored (history.go). The chat target is read before (run.go): a question whose model is unusable isn't admitted.
func (ru *run) preflight(ctx context.Context) (func(), error) {
	var (
		resolved   []kbs.KB
		resolveErr error
		resolvedCh = make(chan struct{})
		caller     access.Caller
	)
	release, err := admitAlongside(
		func() (func(), error) { return ru.admit(ctx) },
		func() error {
			defer close(resolvedCh)
			resolved, resolveErr = ru.s.KBs.ResolveKBs(ctx, ru.cfg.KBIDs())
			return resolveErr
		},
		func() (err error) {
			caller, err = ru.readCaller(ctx)
			return err
		},
		func() (err error) {
			<-resolvedCh
			if resolveErr != nil {
				return nil // the knowledge bases' error is returned
			}
			ru.restricted, err = restrictedKnowledge(ctx, ru.s.KBs, resolved)
			return err
		},
		func() error {
			ru.loadPlans(ctx)
			return nil
		},
		func() error {
			ru.loadHistory(ctx)
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	ru.retr = newRetriever(ru.s.KBs, resolved, ru.cfg, ru.userTag(), caller)
	return release, nil
}

// admitAlongside runs admission and the other steps concurrently and waits for all of them (parallel.InOrder):
// admission's error wins, then the steps' in the order given. When admission succeeded and a step failed, what
// admission holds (the concurrent-chat slot) is released before the error is returned.
func admitAlongside(admit func() (release func(), err error), steps ...func() error) (func(), error) {
	release := func() {}
	err := parallel.InOrder(append([]func() error{func() error {
		r, err := admit()
		if err == nil {
			release = r
		}
		return err
	}}, steps...)...)
	if err != nil {
		release()
		return nil, err
	}
	return release, nil
}

// loadPlans reads the rerank and SystemOne plans (settings cached briefly, internal/ttlcache).
func (ru *run) loadPlans(ctx context.Context) {
	p := &ru.plans
	p.rerank, p.rerankRev, p.rerankOK = nil, 0, true
	if ru.s.KBs != nil {
		p.rerank, p.rerankRev, p.rerankOK = ru.s.KBs.RerankPlanRevision(ctx)
	}
	if ru.s.SystemOne != nil {
		var o systemone.Override
		if ru.cfg.SystemOne != nil {
			o = *ru.cfg.SystemOne
		}
		p.systemOne, p.s1Err = ru.s.SystemOne.Plans(ctx, o)
	}
}

// applyPlans sets the rerank and SystemOne plans on a live answer (rerank.go, judge.go).
func (ru *run) applyPlans() {
	ru.retr.useRerank(ru.plans.rerank, ru.cfg)
	ru.useSystemOne(ru.plans.systemOne, ru.plans.s1Err)
}

// history is a stored conversation's recent turns, read with the other preflight steps (nil rows: not read).
type history struct {
	rows []dbgen.RecentTurnsRow
	err  error
	read bool
}

// loadHistory reads a stored conversation's recent turns (history.go uses them).
func (ru *run) loadHistory(ctx context.Context) {
	if !ru.persist || ru.conv == nil {
		return
	}
	rows, err := ru.s.q.RecentTurns(ctx, dbgen.RecentTurnsParams{ConversationID: ru.conv.ID, Limit: historyRows})
	slices.Reverse(rows) // oldest first
	ru.turns = history{rows: rows, err: err, read: true}
}
