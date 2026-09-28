package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/ncecere/grounded/internal/systemone"
)

// scopeItem is one labelled message of a scope evaluation set (JSONL), judged
// against the agent below. InScope is nil for borderline messages (either
// answer is defensible):
//
//	{"id":"o01","group":"on_topic","text":"How do I order a transcript?","smallTalk":false,"inScope":true}
type scopeItem struct {
	ID        string `json:"id"`
	Group     string `json:"group"` // small_talk, on_topic, borderline, off_topic
	Text      string `json:"text"`
	SmallTalk bool   `json:"smallTalk"`
	InScope   *bool  `json:"inScope"`
}

// scopeResult is one cached check.
type scopeResult struct {
	ID        string  `json:"id"`
	SmallTalk float64 `json:"smallTalk"`
	InScope   float64 `json:"inScope"`
	LatencyMs int64   `json:"latencyMs"`
	Error     string  `json:"error,omitempty"`
}

// The registrar agent of the evaluation (and of the live check).
const (
	scopeAgentName        = "Registrar help"
	scopeAgentDescription = "Answers questions about the registrar's office: registration and drop/add, transcripts, diplomas, enrollment verification, residency, petitions and withdrawals."
	scopeAgentSubject     = "You help students, parents, faculty and staff with the registrar's services and policies: registration, drop/add and waitlists, transcripts, diplomas and degree applications, enrollment verification, residency for tuition purposes, petitions, withdrawals, FERPA and academic records. Answer from the registrar's pages and point people to the right form or office."
)

func cmdScope(args []string) error {
	fs := flag.NewFlagSet("scope", flag.ExitOnError)
	var s1 s1Flags
	s1.register(fs)
	evalPath := fs.String("eval", "", "labelled messages (JSONL {id, group, text, smallTalk, inScope}; required)")
	cache := fs.String("cache", "/tmp/ragbench/scope.jsonl", "results cache")
	_ = fs.Parse(args)
	if *evalPath == "" {
		return errors.New("-eval is required: a JSONL file of {id, group, text, smallTalk, inScope}")
	}
	var items []scopeItem
	if err := readJSONL(*evalPath, func(it scopeItem) error { items = append(items, it); return nil }); err != nil {
		return err
	}
	cl, err := s1.client()
	if err != nil {
		return err
	}
	rs, err := runScope(cl, items, *cache)
	if err != nil {
		return err
	}
	reportScope(items, rs)
	return nil
}

func runScope(cl *systemone.Client, items []scopeItem, path string) ([]scopeResult, error) {
	cached := map[string]scopeResult{}
	_ = readJSONL(path, func(r scopeResult) error { cached[r.ID] = r; return nil })
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	agent := systemone.ScopeAgent{Name: scopeAgentName, Description: scopeAgentDescription, Subject: systemone.Summary(scopeAgentSubject)}
	out := make([]scopeResult, len(items))
	for i, it := range items {
		if r, ok := cached[it.ID]; ok && r.Error == "" {
			out[i] = r
			continue
		}
		start := time.Now()
		res := cl.CheckScope(context.Background(), systemone.ScopeState{Message: it.Text, Agent: agent}, systemone.DefaultScope())
		r := scopeResult{ID: it.ID, SmallTalk: res.SmallTalk, InScope: res.InScope, LatencyMs: time.Since(start).Milliseconds()}
		if res.Err != nil {
			r.Error = res.Err.Error()
		}
		out[i] = r
		if err := appendJSONL(f, r); err != nil {
			return nil, err
		}
		fmt.Fprintf(os.Stderr, "%s %-10s small_talk %.2f in_scope %.2f (%d ms)\n", it.ID, it.Group, r.SmallTalk, r.InScope, r.LatencyMs)
	}
	return out, nil
}

// scopeOutcome is what the pipeline would do with a message.
func scopeOutcome(r scopeResult, s systemone.Scope) string {
	return systemone.RouteScope(r.SmallTalk, r.InScope, s)
}

// scopeRight reports whether the decision is right for the item
// (borderline messages: anything but small talk).
func scopeRight(it scopeItem, d string) bool {
	switch {
	case it.SmallTalk:
		return d == systemone.ScopeSmallTalk
	case d == systemone.ScopeSmallTalk:
		return false
	case it.InScope == nil:
		return true
	case *it.InScope:
		return d == systemone.ScopeInScope
	}
	return d == systemone.ScopeOutOfScope
}

func reportScope(items []scopeItem, rs []scopeResult) {
	def := systemone.DefaultScope()
	fmt.Printf("defaults: small talk >= %.2f, in scope < %.2f is out of scope\n\n", def.SmallTalk, def.InScope)
	fmt.Println("| id | group | small_talk | in_scope | decision | right |")
	fmt.Println("|---|---|---:|---:|---|---|")
	var lat []float64
	for i, it := range items {
		d := scopeOutcome(rs[i], def)
		fmt.Printf("| %s | %s | %.2f | %.2f | %s | %v |\n", it.ID, it.Group, rs[i].SmallTalk, rs[i].InScope, d, scopeRight(it, d))
		lat = append(lat, float64(rs[i].LatencyMs))
	}
	sort.Float64s(lat)
	fmt.Printf("\nlatency: p50 %.0f ms, p95 %.0f ms, max %.0f ms\n\n", pct(lat, 50), pct(lat, 95), lat[len(lat)-1])
	fmt.Println("| small talk >= | in scope < | right | small talk found | on-topic refused (strict) | off-topic caught | borderline refused |")
	fmt.Println("|---:|---:|---:|---:|---:|---:|---:|")
	for _, st := range []float64{0.3, 0.5, 0.7} {
		for _, in := range []float64{0.1, 0.2, 0.3, 0.5} {
			s := systemone.Scope{SmallTalk: st, InScope: in}
			var right, small, smallN, onRefused, onN, offCaught, offN, bordRefused, bordN int
			for i, it := range items {
				d := scopeOutcome(rs[i], s)
				if scopeRight(it, d) {
					right++
				}
				switch it.Group {
				case "small_talk":
					smallN++
					if d == systemone.ScopeSmallTalk {
						small++
					}
				case "on_topic":
					onN++
					if d != systemone.ScopeInScope {
						onRefused++
					}
				case "off_topic":
					offN++
					if d == systemone.ScopeOutOfScope {
						offCaught++
					}
				case "borderline":
					bordN++
					if d == systemone.ScopeOutOfScope {
						bordRefused++
					}
				}
			}
			fmt.Printf("| %.1f | %.1f | %d / %d | %d / %d | %d / %d | %d / %d | %d / %d |\n", st, in, right, len(items), small, smallN,
				onRefused, onN, offCaught, offN, bordRefused, bordN)
		}
	}
}
