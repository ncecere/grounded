package demo

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func askSystemOne(t *testing.T, state any, questions map[string]any) map[string]map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"state": state, "model": "m", "questions": questions})
	req := httptest.NewRequest(http.MethodPost, "/v1/systemone", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+FakeAPIKey)
	rec := httptest.NewRecorder()
	NewFakeModels(FakeAPIKey).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var out struct {
		Answers map[string]map[string]any `json:"answers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Answers
}

func TestFakeSystemOneRoutesByWords(t *testing.T) {
	opts := map[string]string{
		"agent_1":    `The assistant "Parking help" of Transport. It helps with: Student parking permits and decals.`,
		"agent_2":    `The assistant "Housing help" of Residence. It helps with: Residence halls and move-in dates.`,
		"agent_3":    `The assistant "Go testing help" of Demo. It helps with: Writing and running tests, benchmarks and fuzzing in Go.`,
		"small_talk": "only small talk", "none": "nothing fits",
	}
	route := map[string]any{"route": map[string]any{"type": "choice", "criteria": opts}}
	for _, c := range []struct{ message, want string }{
		{"Where do I buy a parking permit?", "agent_1"},
		{"When can I move into the residence halls?", "agent_2"},
		{"Who won the football game?", "none"},
		{"Parking or housing?", "agent_1"},                    // a tie: the first agent
		{"How do I write a benchmark test in Go?", "agent_3"}, // plurals and endings: benchmark, benchmarks; write, writing
		{"Hello!", "small_talk"},
	} {
		got := askSystemOne(t, map[string]any{"message": c.message}, route)["route"]["choice"]
		if got != c.want {
			t.Errorf("%q routed to %v, want %s", c.message, got, c.want)
		}
	}
}

func TestFakeSystemOneScopeCheck(t *testing.T) {
	qs := map[string]any{"small_talk": map[string]any{"type": "noul"}, "in_scope": map[string]any{"type": "noul"}}
	hello := askSystemOne(t, map[string]any{"message": "Thanks!"}, qs)
	ask := askSystemOne(t, map[string]any{"message": "How do I request a transcript?"}, qs)
	if hello["small_talk"]["noul"].(float64) < 0.9 || ask["small_talk"]["noul"].(float64) > 0.1 || ask["in_scope"]["noul"].(float64) < 0.9 {
		t.Errorf("scope answers: %v / %v", hello, ask)
	}
}
