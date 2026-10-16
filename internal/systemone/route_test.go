package systemone

import (
	"strings"
	"testing"
	"unicode/utf8"
)

var routeAgents = []RouteAgent{{Key: "agent_1", Name: "Parking help"}, {Key: "agent_2", Name: "Housing help"}}

func TestRouteDecisionNeedsConfidenceForAnAgent(t *testing.T) {
	for _, c := range []struct {
		choice     string
		confidence float64
		decision   string
		key        string
	}{
		{"agent_1", 0.9, RouteRouted, "agent_1"},
		{"agent_2", RouteMinConfidence, RouteRouted, "agent_2"},
		{"agent_1", RouteMinConfidence - 0.01, RouteNone, ""},
		{"agent_9", 0.99, RouteNone, ""}, // not a candidate
		{"none", 0.99, RouteNone, ""},
		{"small_talk", 0.2, RouteSmallTalk, ""}, // small talk is not held to the agents' bar
	} {
		if d, k := routeDecision(c.choice, c.confidence, routeAgents); d != c.decision || k != c.key {
			t.Errorf("%s at %.2f = %s %q, want %s %q", c.choice, c.confidence, d, k, c.decision, c.key)
		}
	}
}

func TestRouteQuestionOffersEveryCandidateAndTheTwoOthers(t *testing.T) {
	long := RouteAgent{Key: "agent_3", Name: "Long", Description: strings.Repeat("word ", 400), Subject: strings.Repeat("more ", 400)}
	q := RouteQuestion(append([]RouteAgent{{Key: "agent_1", Name: "Parking help", Team: "Transport", Description: "Permits", Subject: "Decals"}}, long))
	opts, _ := q.Criteria.(map[string]string)
	if len(opts) != 4 {
		t.Fatalf("%d options, want the two agents, small talk and none", len(opts))
	}
	for _, k := range []string{"agent_1", "agent_3", "small_talk", "none"} {
		if opts[k] == "" {
			t.Errorf("no option %s", k)
		}
	}
	if d := opts["agent_1"]; !strings.Contains(d, "Parking help") || !strings.Contains(d, "Transport") || !strings.Contains(d, "Permits") || !strings.Contains(d, "Decals") {
		t.Errorf("description = %q", d)
	}
	if n := utf8.RuneCountInString(opts["agent_3"]); n > maxRouteDescription+2 {
		t.Errorf("a description is %d characters, want at most %d", n, maxRouteDescription)
	}
}
