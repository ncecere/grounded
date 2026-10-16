package demo

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// The fake gateway's SystemOne API (POST /v1/systemone), so the checks that need a SystemOne model can be tried in a demo: the scope
// check (a bare greeting is small talk, everything else is in scope) and a router's routing question (the agent whose description
// shares the most words of four letters or more with the message, or none). It is not a model: other questions answer conservatively
// (not the same question, no violation, the first option, level zero).

var fakeGreetingSet = map[string]bool{"hi": true, "hello": true, "hey": true, "thanks": true, "thank you": true, "good morning": true, "good afternoon": true, "bye": true, "goodbye": true}

func fakeSystemOne(w http.ResponseWriter, r *http.Request) {
	var in struct {
		State     json.RawMessage `json:"state"`
		Questions map[string]struct {
			Type     string          `json:"type"`
			Criteria json.RawMessage `json:"criteria"`
		} `json:"questions"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&in); err != nil || len(in.Questions) == 0 {
		fakeError(w, http.StatusUnprocessableEntity, "state, model and questions are required")
		return
	}
	var st struct {
		Message *string `json:"message"`
	}
	_ = json.Unmarshal(in.State, &st)
	message := ""
	if st.Message != nil {
		message = *st.Message
	}
	answers := map[string]any{}
	for id, q := range in.Questions {
		switch q.Type {
		case "choice":
			var opts map[string]string
			_ = json.Unmarshal(q.Criteria, &opts)
			choice, conf := fakeChoice(id, message, opts)
			probs := map[string]float64{}
			for k := range opts {
				probs[k] = 0
				if len(opts) > 1 {
					probs[k] = (1 - conf) / float64(len(opts)-1)
				}
			}
			probs[choice] = conf
			answers[id] = map[string]any{"type": "choice", "choice": choice, "probabilities": probs, "confidence": conf}
		case "score":
			answers[id] = map[string]any{"type": "score", "score": 0, "probabilities": map[string]float64{"0": 1}, "confidence": 0.9}
		default:
			answers[id] = map[string]any{"type": "noul", "noul": fakeNoulAnswer(id, message)}
		}
	}
	writeJSON(w, map[string]any{"model": "demo-systemone", "answers": answers, "usage": map[string]int{"input_tokens": 100, "output_tokens": 0}})
}

// fakeNoulAnswer: the scope check's two questions, and no for the rest.
func fakeNoulAnswer(id, message string) float64 {
	switch id {
	case "small_talk":
		if fakeGreetingSet[strings.Trim(strings.ToLower(strings.TrimSpace(message)), "!.? ")] {
			return 0.96
		}
		return 0.02
	case "in_scope":
		return 0.93
	}
	return 0.05
}

// fakeChoice answers a choice question: the routing question by word overlap, any other the first option.
func fakeChoice(id, message string, opts map[string]string) (string, float64) {
	if id != "route" {
		keys := make([]string, 0, len(opts))
		for k := range opts {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if len(keys) == 0 {
			return "", 1
		}
		return keys[0], 1
	}
	if fakeGreetingSet[strings.Trim(strings.ToLower(strings.TrimSpace(message)), "!.? ")] {
		return "small_talk", 0.96
	}
	words := fakeWords(message)
	best, bestN := "none", 0
	for n := 1; n <= len(opts); n++ { // agent_1, agent_2…: in order, the first of a tie wins
		key := "agent_" + strconv.Itoa(n)
		desc, ok := opts[key]
		if !ok {
			continue
		}
		have, hits := fakeWords(desc), 0
		for w := range words {
			if have[w] {
				hits++
			}
		}
		if hits > bestN {
			best, bestN = key, hits
		}
	}
	return best, 0.9
}

// fakeStop are the words every description shares, and plain question words.
var fakeStop = map[string]bool{"assistant": true, "helps": true, "help": true, "with": true, "instructions": true, "begin": true, "team": true,
	"what": true, "does": true, "this": true, "that": true, "have": true, "from": true, "your": true, "about": true, "when": true,
	"where": true, "which": true, "there": true, "their": true, "would": true, "could": true, "should": true}

func fakeWords(s string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) }) {
		if len(w) >= 4 && !fakeStop[w] {
			out[w] = true
		}
	}
	return out
}
