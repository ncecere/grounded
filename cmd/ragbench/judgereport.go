package main

import (
	"fmt"
	"math"
	"strings"

	"github.com/ncecere/grounded/internal/systemone"
)

// judgments turns a cached record back into routed judgments over the
// first n candidates.
func judgments(r judgeRecord, t systemone.Thresholds, n int) []systemone.Judgment {
	n = min(n, len(r.Scores))
	out := make([]systemone.Judgment, n)
	for i := 0; i < n; i++ {
		if r.Skipped[i] {
			out[i] = systemone.Judgment{Route: systemone.RouteEvidence, Skipped: true}
			continue
		}
		route, reason := systemone.Route(r.Scores[i], t)
		out[i] = systemone.Judgment{Scores: r.Scores[i], Route: route, Reason: reason}
	}
	return out
}

// Setups compared on the same candidates.
const (
	setupFused  = "fused"
	setupRerank = "rerank"
	setupRoute  = "route"
)

// setupResult accumulates one setup's metrics.
type setupResult struct {
	sum                 summary
	withRel, anyDropped int // queries with a relevant candidate; of those, with one dropped
	allDropped          int // … with every relevant candidate dropped
	kept                int
	reasons             map[string]int
	queries             int
}

// evalSetup ranks one query's first n candidates for a setup and scores it.
func (sr *setupResult) add(q judgeQuery, r judgeRecord, setup string, t systemone.Thresholds, n, k int) {
	js := judgments(r, t, n)
	var idx []int
	switch setup {
	case setupFused:
		for i := range js {
			idx = append(idx, i)
		}
	case setupRerank:
		idx = systemone.Rank(js, func(systemone.Judgment) bool { return true })
	default:
		idx = systemone.Rank(js, systemone.Kept)
	}
	docs := make([]string, len(idx))
	for i, c := range idx {
		docs[i] = q.cands[c].doc
	}
	sr.sum.add(score(dedupe(docs), q.rel, k))
	sr.queries++
	sr.kept += len(idx)
	if setup != setupRoute {
		return
	}
	if sr.reasons == nil {
		sr.reasons = map[string]int{}
	}
	rel, dropped := 0, 0
	for i, j := range js {
		if j.Route == systemone.RouteDropped {
			sr.reasons[j.Reason]++
		}
		if q.rel[q.cands[i].doc] > 0 {
			rel++
			if j.Route == systemone.RouteDropped {
				dropped++
			}
		}
	}
	if rel > 0 {
		sr.withRel++
		if dropped > 0 {
			sr.anyDropped++
		}
		if dropped == rel {
			sr.allDropped++
		}
	}
}

func share(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return float64(a) / float64(b)
}

// latencies returns p50, p95 (ms) and requests per query of a mode.
func latencies(recs []judgeRecord) (float64, float64, float64) {
	var lat []float64
	req := 0
	for _, r := range recs {
		lat = append(lat, float64(r.LatencyMs))
		req += r.Requests
	}
	return pct(lat, 50), pct(lat, 95), float64(req) / float64(max(len(recs), 1))
}

// reportJudging prints the comparison, the candidate-count table, the
// threshold sweep and the agreement between modes.
func reportJudging(qs []judgeQuery, recs map[string][]judgeRecord, k int) {
	t := systemone.DefaultThresholds
	n := len(qs[0].cands)
	fmt.Printf("\nthresholds: injection %.2f, relevant %.2f, contradicts %.2f, evidence %.2f; %d candidates\n\n",
		t.Injection, t.Relevant, t.Contradicts, t.Evidence, n)
	fmt.Printf("| setup | nDCG@%d | recall@%d | MRR | relevant dropped (any / all) | passages kept | p50 / p95 ms | requests/query |\n", k, k)
	fmt.Println("|---|---:|---:|---:|---:|---:|---:|---:|")
	var fused setupResult
	for i, q := range qs {
		for _, mode := range []string{systemone.ModePerPassage, systemone.ModeBatched} {
			if rs := recs[mode]; len(rs) > 0 {
				fused.add(q, rs[i], setupFused, t, n, k)
				break
			}
		}
	}
	printSetup("fused (no judging)", fused, "–", "0")
	printModes(qs, recs, t, n, k)
	if bt := recs[systemone.ModeBatched]; len(bt) > 0 && len(bt) < len(qs) {
		fmt.Printf("\nbatched ran on the first %d queries; all setups on those:\n\n", len(bt))
		fmt.Printf("| setup | nDCG@%d | recall@%d | MRR | relevant dropped (any / all) | passages kept | p50 / p95 ms | requests/query |\n", k, k)
		fmt.Println("|---|---:|---:|---:|---:|---:|---:|---:|")
		sub := map[string][]judgeRecord{systemone.ModeBatched: bt}
		if pp := recs[systemone.ModePerPassage]; len(pp) >= len(bt) {
			sub[systemone.ModePerPassage] = pp[:len(bt)]
		}
		var f setupResult
		for i, q := range qs[:len(bt)] {
			f.add(q, bt[i], setupFused, t, n, k)
		}
		printSetup("fused (no judging)", f, "–", "0")
		printModes(qs[:len(bt)], sub, t, n, k)
	}
	if rs := recs[systemone.ModePerPassage]; len(rs) > 0 {
		candidateTable(qs, rs, t, k)
		thresholdSweep(qs, rs, k)
	}
	agreement(recs)
}

// printModes prints the re-rank and routing rows of each mode.
func printModes(qs []judgeQuery, recs map[string][]judgeRecord, t systemone.Thresholds, n, k int) {
	for _, mode := range []string{systemone.ModePerPassage, systemone.ModeBatched} {
		rs := recs[mode]
		if len(rs) == 0 {
			continue
		}
		p50, p95, req := latencies(rs)
		lat, reqs := fmt.Sprintf("%.0f / %.0f", p50, p95), fmt.Sprintf("%.1f", req)
		for _, setup := range []string{setupRerank, setupRoute} {
			var sr setupResult
			for i, q := range qs[:len(rs)] {
				sr.add(q, rs[i], setup, t, n, k)
			}
			printSetup(mode+" "+setup, sr, lat, reqs)
		}
	}
}

func printSetup(name string, sr setupResult, lat, reqs string) {
	nd, rc, mr := means(sr.sum)
	dropped := "–"
	if sr.reasons != nil {
		dropped = fmt.Sprintf("%.1f%% / %.1f%%", 100*share(sr.anyDropped, sr.withRel), 100*share(sr.allDropped, sr.withRel))
	}
	fmt.Printf("| %s | %.3f | %.3f | %.3f | %s | %.1f | %s | %s |\n", name, nd, rc, mr, dropped,
		float64(sr.kept)/float64(max(sr.queries, 1)), lat, reqs)
	if sr.reasons != nil {
		fmt.Printf("|   drops by reason | injection %d, irrelevant %d, not usable %d | | | | | | |\n",
			sr.reasons[systemone.ReasonInjection], sr.reasons[systemone.ReasonIrrelevant], sr.reasons[systemone.ReasonNotUsable])
	}
}

// candidateTable shows re-rank and routing quality when only the first n
// fused candidates are judged (same scores, fewer requests).
func candidateTable(qs []judgeQuery, rs []judgeRecord, t systemone.Thresholds, k int) {
	fmt.Printf("\nper_passage, by candidates judged (nDCG@%d / recall@%d; routing: all-relevant-dropped share):\n\n", k, k)
	fmt.Println("| candidates | fused | re-rank | routing | all relevant dropped |")
	fmt.Println("|---:|---:|---:|---:|---:|")
	for _, n := range []int{5, 10, 15, 20, 30, 50} {
		if n > len(qs[0].cands) {
			break
		}
		var f, rr, ro setupResult
		for i, q := range qs {
			f.add(q, rs[i], setupFused, t, n, k)
			rr.add(q, rs[i], setupRerank, t, n, k)
			ro.add(q, rs[i], setupRoute, t, n, k)
		}
		a, b, c := meanPair(f), meanPair(rr), meanPair(ro)
		fmt.Printf("| %d | %s | %s | %s | %.1f%% |\n", n, a, b, c, 100*share(ro.allDropped, ro.withRel))
	}
}

func meanPair(sr setupResult) string {
	nd, rc, _ := means(sr.sum)
	return fmt.Sprintf("%.3f / %.3f", nd, rc)
}

// thresholdSweep re-routes the stored answers (no requests) over the
// relevant and evidence thresholds.
func thresholdSweep(qs []judgeQuery, rs []judgeRecord, k int) {
	rels := []float64{0.2, 0.3, 0.45, 0.6}
	evs := []float64{0.3, 0.45, 0.55, 0.7}
	fmt.Printf("\nrouting sweep (per_passage): nDCG@%d / all-relevant-dropped share / kept per query, by relevant (rows) and evidence (columns) thresholds:\n\n", k)
	fmt.Printf("| relevant \\ evidence |")
	for _, e := range evs {
		fmt.Printf(" %.2f |", e)
	}
	fmt.Printf("\n|---|%s\n", strings.Repeat("---:|", len(evs)))
	for _, r := range rels {
		fmt.Printf("| %.2f |", r)
		for _, e := range evs {
			t := systemone.DefaultThresholds
			t.Relevant, t.Evidence = r, e
			var sr setupResult
			for i, q := range qs {
				sr.add(q, rs[i], setupRoute, t, len(q.cands), k)
			}
			nd, _, _ := means(sr.sum)
			fmt.Printf(" %.3f / %.1f%% / %.1f |", nd, 100*share(sr.allDropped, sr.withRel), float64(sr.kept)/float64(max(sr.queries, 1)))
		}
		fmt.Println()
	}
}

// agreement compares per-passage and batched answers on the same
// candidates: mean absolute difference per question and route agreement.
func agreement(recs map[string][]judgeRecord) {
	pp, bt := recs[systemone.ModePerPassage], recs[systemone.ModeBatched]
	if len(pp) == 0 || len(bt) == 0 || len(pp) < len(bt) {
		return
	}
	var dRel, dEv, dCon, dInj float64
	same, n := 0, 0
	t := systemone.DefaultThresholds
	for i := range bt {
		for j := range pp[i].Scores {
			if pp[i].Skipped[j] || bt[i].Skipped[j] {
				continue
			}
			a, b := pp[i].Scores[j], bt[i].Scores[j]
			dRel += math.Abs(a.Relevant - b.Relevant)
			dEv += math.Abs(a.Evidence - b.Evidence)
			dCon += math.Abs(a.Contradicts - b.Contradicts)
			dInj += math.Abs(a.Injection - b.Injection)
			ra, _ := systemone.Route(a, t)
			rb, _ := systemone.Route(b, t)
			if ra == rb {
				same++
			}
			n++
		}
	}
	if n == 0 {
		return
	}
	f := float64(n)
	fmt.Printf("\nbatched vs per_passage on %d passages: mean |Δ| relevant %.3f, evidence %.3f, contradicts %.3f, injection %.3f; same route %.1f%%\n",
		n, dRel/f, dEv/f, dCon/f, dInj/f, 100*float64(same)/f)
}
