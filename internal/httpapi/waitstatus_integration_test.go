package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// While an answer waits for the model's connection (requests per minute), the reader's status says "waiting" instead of
// standing still (roadmap G22), goes back to the step it was on, and says nothing once the answer is being written.
func TestAnswerStatusSaysWaitingWhileTheConnectionIsBusy(t *testing.T) {
	env := newPublishEnv(t)

	var conns []apitypes.Connection
	env.admin.get("/v1/admin/connections", &conns)
	if len(conns) != 1 {
		t.Fatalf("connections = %+v", conns)
	}
	// 30 a minute is one request every 2 s: the second request of the answer (after the search's embedding) queues
	code, e := env.admin.call("PATCH", "/v1/admin/connections/"+conns[0].Id.String(), map[string]any{"requestsPerMinute": 30}, nil, ifMatch(conns[0].Revision))
	mustCode(t, "slow connection", code, e, 200, "")

	pub := env.publicAgent(t, "Open help")
	v := newVisitor(t, env.app.URL)
	v.start(pub.Id, "", "")
	avoidMinuteBoundary()
	code, evs, e := v.ask(pub.Id, "Where do students buy a parking permit?")
	if code != 200 {
		t.Fatalf("chat = %d %s", code, e)
	}

	var steps []string
	wrote := false
	for _, ev := range evs {
		switch ev.name {
		case "text_delta":
			wrote = true
		case "status":
			var st apitypes.ChatEventStatus
			_ = json.Unmarshal(ev.data, &st)
			if st.Step == "waiting" && wrote {
				t.Error("a waiting status came after the answer's first words")
			}
			steps = append(steps, string(st.Step))
		}
	}
	got := strings.Join(steps, ",")
	t.Logf("status steps: %s", got)
	if !strings.Contains(got, "waiting") {
		t.Fatalf("status steps = %s: want a waiting step while the connection is busy", got)
	}
	for i, s := range steps {
		if s == "waiting" && i+1 < len(steps) && steps[i+1] == "waiting" {
			t.Errorf("two waiting steps in a row: %s", got)
		}
	}
	if !strings.HasSuffix(got, "answering") {
		t.Errorf("status steps = %s: want the answer to end them", got)
	}
	if len(evs.all("text_delta")) == 0 {
		t.Error("the slow connection still has to answer")
	}
}
