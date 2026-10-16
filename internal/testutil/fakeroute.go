package testutil

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"unicode"
)

// The router's question (state {message, previous_message?}, choice question "route", options agent_1… plus
// small_talk and none): small_talk 0.96 for SMALLTALK or a bare greeting; none 0.9 with NOAGENT or when the message
// shares no word of four letters or more with any agent's description; otherwise the agent whose description shares
// the most such words (the first of a tie), 0.9, or 0.3 with the marker LOWROUTE (below the router's minimum).

// RouteRequests counts routing requests so far.
func (p *FakeProxy) RouteRequests() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.routeCalls
}

// FailRouteWith makes routing requests answer status (0 restores).
func (p *FakeProxy) FailRouteWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.routeFail = status
}

// routeAnswer answers a routing request.
func (p *FakeProxy) routeAnswer(w http.ResponseWriter, message string, q fakeQuestion) {
	p.mu.Lock()
	p.routeCalls++
	fail := p.routeFail
	p.mu.Unlock()
	if fail != 0 {
		writeErr(w, fail, "routing failure (test)")
		return
	}
	var opts map[string]string
	_ = json.Unmarshal(q.Criteria, &opts)
	choice, conf := FakeRouteChoice(message, opts)
	probs := map[string]float64{}
	for k := range opts {
		probs[k] = 0
		if len(opts) > 1 {
			probs[k] = (1 - conf) / float64(len(opts)-1)
		}
	}
	probs[choice] = conf
	_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-fake-1.0", "usage": map[string]int{"input_tokens": 100, "output_tokens": 0},
		"answers": map[string]any{"route": map[string]any{"type": "choice", "choice": choice, "probabilities": probs, "confidence": conf}}})
}

// FakeRouteChoice is the fake's answer to a routing question: the option and its confidence.
func FakeRouteChoice(message string, opts map[string]string) (string, float64) {
	up := strings.ToUpper(message)
	bare := strings.Trim(strings.ToLower(strings.TrimSpace(message)), "!.? ")
	switch {
	case strings.Contains(up, "SMALLTALK") || fakeGreetings[bare]:
		return "small_talk", 0.96
	case strings.Contains(up, "NOAGENT"):
		return "none", 0.9
	}
	words := routeWords(message)
	keys := make([]string, 0, len(opts))
	for k := range opts {
		if strings.HasPrefix(k, "agent_") {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return routeKeyNum(keys[i]) < routeKeyNum(keys[j]) })
	best, bestN := "", 0
	for _, k := range keys {
		have := routeWords(opts[k])
		n := 0
		for w := range words {
			if have[w] {
				n++
			}
		}
		if n > bestN {
			best, bestN = k, n
		}
	}
	switch {
	case best == "":
		return "none", 0.9
	case strings.Contains(up, "LOWROUTE"):
		return best, 0.3
	}
	return best, 0.9
}

func routeKeyNum(k string) int {
	n := 0
	for _, r := range strings.TrimPrefix(k, "agent_") {
		n = n*10 + int(r-'0')
	}
	return n
}

// routeStop are the words every description shares, and plain question words.
var routeStop = map[string]bool{"assistant": true, "helps": true, "help": true, "with": true, "instructions": true, "begin": true, "team": true,
	"what": true, "does": true, "this": true, "that": true, "have": true, "from": true, "your": true, "about": true, "when": true,
	"where": true, "which": true, "there": true, "their": true, "would": true, "could": true, "should": true}

func routeWords(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) }) {
		if len(w) >= 4 && !routeStop[w] {
			out[routeStem(w)] = true
		}
	}
	return out
}

// routeStem crudely drops a plural or an ending, so "benchmarks", "writing" and "write" match "benchmark" and "writ".
func routeStem(w string) string {
	for _, suf := range []string{"ing", "ed", "es", "s", "e"} {
		if strings.HasSuffix(w, suf) && len(w)-len(suf) >= 3 {
			return strings.TrimSuffix(w, suf)
		}
	}
	return w
}
