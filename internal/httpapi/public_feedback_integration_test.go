package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Feedback from anonymous visitors (walkthrough addition): only on answers
// in the session's own conversation, rate-limited like questions, refused
// for a killed agent and while public agents are off; a thumbs-down feeds
// the gap report (one person per session) and removes the saved answer.
func TestPublicFeedback(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	v := newVisitor(t, env.app.URL)
	v.start(pub.Id, "", "")
	avoidMinuteBoundary()
	code, evs, e := v.ask(pub.Id, "Where do students buy a parking permit?")
	if code != 200 {
		t.Fatalf("chat = %d %s", code, e)
	}
	var start agents.MessageStartEvent
	evs.one(t, "message_start", &start)
	msg := start.MessageID.String()
	path := "/v1/public/agents/" + pub.Id.String() + "/messages/" + msg + "/feedback"
	if n := env.scalar(t, `SELECT count(*) FROM answer_cache WHERE agent_id = $1`, pub.Id); n != 1 {
		t.Fatalf("saved answers = %d, want 1", n)
	}

	// Without a session, or from another session: refused.
	if code, e := newVisitor(t, env.app.URL).call("POST", path, map[string]any{"rating": "down"}, nil); code != 401 {
		t.Fatalf("without a session = %d %s", code, e)
	}
	other := newVisitor(t, env.app.URL)
	other.start(pub.Id, "", "")
	if code, e := other.call("POST", path, map[string]any{"rating": "down"}, nil); code != 404 || e != "message_not_found" {
		t.Fatalf("another session's message = %d %s", code, e)
	}
	if code, e := v.call("POST", path, map[string]any{"rating": "sideways"}, nil); code != 400 || e != "invalid_rating" {
		t.Fatalf("bad rating = %d %s", code, e)
	}

	// A shared thumbs-down: the gap report keeps the question (shared), the
	// saved answer goes.
	var res apitypes.FeedbackResult
	code, e = v.call("POST", path, map[string]any{"rating": "down", "reason": "missing_sources", "share": true}, &res)
	if code != 200 || !res.Shared || res.Rating != apitypes.Down {
		t.Fatalf("thumbs-down = %d %s %+v", code, e, res)
	}
	if n := env.scalar(t, `SELECT count(*) FROM gap_questions WHERE message_id = $1 AND shared AND signals = ARRAY['thumbs_down']
		AND feedback_reason = 'missing_sources' AND asker_key IS NOT NULL`, start.MessageID); n != 1 {
		t.Errorf("gap question = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE message_id = $1 AND feedback = 'down' AND feedback_shared`, start.MessageID); n != 1 {
		t.Errorf("feedback on the event = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM answer_cache WHERE agent_id = $1`, pub.Id); n != 0 {
		t.Errorf("saved answers after a thumbs-down = %d", n)
	}
	// A thumbs-up takes the question back.
	if code, e := v.call("POST", path, map[string]any{"rating": "up"}, nil); code != 200 ||
		env.scalar(t, `SELECT count(*) FROM gap_questions WHERE message_id = $1`, start.MessageID) != 0 {
		t.Errorf("thumbs-up = %d %s", code, e)
	}

	// Rate-limited like questions (per session per minute, counted apart).
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_queries_per_session_per_minute": 2})
	if code, e := v.call("POST", path, map[string]any{"rating": "up"}, nil); code != 429 || e != "rate_limited" {
		t.Fatalf("past the limit = %d %s", code, e)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_queries_per_session_per_minute": nil})

	// The kill switch and the public switch.
	code, e = env.admin.call("POST", "/v1/admin/agents/"+pub.Id.String()+"/status", map[string]string{"status": "disabled_by_platform", "reason": "Abuse report"}, nil, nil)
	mustCode(t, "kill switch", code, e, 200, "")
	if code, e := other.call("POST", path, map[string]any{"rating": "up"}, nil); code != 403 || e != "agent_disabled" {
		t.Fatalf("killed agent = %d %s", code, e)
	}
	env.admin.call("POST", "/v1/admin/agents/"+pub.Id.String()+"/status", map[string]string{"status": "active"}, nil, nil)
	env.setPublic(t, false)
	if code, e := v.call("POST", path, map[string]any{"rating": "up"}, nil); code != 503 || e != "public_disabled" {
		t.Fatalf("public off = %d %s", code, e)
	}
}
