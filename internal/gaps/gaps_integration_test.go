package gaps_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/gaps"
)

const parking = "Where do I buy a parking permit?"

// TestTopicsMinimumCrowdLabelsAndStableIDs: questions are embedded and
// grouped by the job; a topic shows (and is labelled from its questions
// only) once 3 different askers are in it, keeps its ID as it grows, and
// the job's model use is metered to the team.
func TestTopicsMinimumCrowdLabelsAndStableIDs(t *testing.T) {
	f := newFixture(t)
	f.ask("a1", parking, false, "no_context")
	f.ask("a2", "Where do I buy a parking permit", true, "thumbs_down")
	f.ask("a2", "where do I buy a parking permit?", false, "refused") // the same asker again
	f.ask("a4", "When does the library open on Sunday?", false, "no_context")
	sum := f.run()
	if sum.Embedded != 4 || sum.Assigned != 4 || sum.NewTopics != 2 || sum.Labelled != 0 {
		t.Fatalf("first run = %+v", sum)
	}
	list, err := f.svc.List(f.ctx, f.editor, f.slug, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Topics) != 0 || list.Pending != 4 {
		t.Fatalf("below 3 askers = %d topics, %d pending; want none shown and 4 pending", len(list.Topics), list.Pending)
	}
	f.ask("a3", "Where do I buy a parking permit please?", false, "judged_out")
	sum = f.run()
	if sum.NewTopics != 0 || sum.Labelled != 1 {
		t.Fatalf("second run = %+v", sum)
	}
	list, _ = f.svc.List(f.ctx, f.editor, f.slug, nil, "")
	if len(list.Topics) != 1 {
		t.Fatalf("topics = %+v", list.Topics)
	}
	top := list.Topics[0]
	if top.Label != "Parking permits" || top.Questions != 4 || top.Askers != 3 || top.Shared != 1 || top.Signals["refused"] != 1 ||
		top.Trend[len(top.Trend)-1] != 4 || list.Pending != 1 {
		t.Fatalf("topic = %+v, pending %d", top, list.Pending)
	}
	reqs := f.labels.sent()
	if len(reqs) != 1 || reqs[0].SystemPrompt != gaps.LabelPrompt || strings.Contains(userText(reqs[0]), "library") ||
		!strings.Contains(userText(reqs[0]), "parking permit") {
		t.Fatalf("label requests = %+v", reqs)
	}
	if n := f.count(`SELECT count(*) FROM usage_events WHERE team_id = $1 AND metadata->>'source' = 'gaps' AND kind IN ('embed_tokens', 'chat_tokens_in', 'chat_tokens_out')`, f.team); n < 3 {
		t.Fatalf("metered usage events = %d", n)
	}
	f.ask("a5", "where do i buy a parking permit", false, "no_context")
	f.run()
	again, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, "")
	if len(again.Topics) != 1 || again.Topics[0].ID != top.ID || again.Topics[0].Askers != 4 {
		t.Fatalf("after a new question = %+v, want the same topic %s", again.Topics, top.ID)
	}
	d, err := f.svc.Get(f.ctx, f.owner, f.slug, top.ID)
	if err != nil || len(d.Shared) != 1 || d.Shared[0].Question != "Where do I buy a parking permit" {
		t.Fatalf("detail = %+v, %v", d, err)
	}
}

// TestDeletedConversations: a conversation its user deleted leaves the
// counts at once (the topic hides below 3 askers), and its question goes
// with it when retention removes the conversation.
func TestDeletedConversations(t *testing.T) {
	f := newFixture(t)
	f.ask("a1", parking, false, "no_context")
	f.ask("a2", parking, false, "no_context")
	conv := f.ask("a3", parking, false, "no_context")
	f.run()
	if list, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, ""); len(list.Topics) != 1 {
		t.Fatalf("topics = %d", len(list.Topics))
	}
	f.exec(`UPDATE conversations SET deleted_at = now() WHERE id = $1`, conv)
	if list, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, ""); len(list.Topics) != 0 {
		t.Fatalf("after a user delete: %d topics shown", len(list.Topics))
	}
	f.exec(`DELETE FROM conversations WHERE id = $1`, conv)
	if n := f.count(`SELECT count(*) FROM gap_questions WHERE conversation_id = $1`, conv); n != 0 {
		t.Fatalf("questions of a purged conversation = %d", n)
	}
}

// TestDismissReopenResolve: an editor dismisses a topic (audited, without
// the label); a newer failure reopens it; good answers after the last
// failure resolve it.
func TestDismissReopenResolve(t *testing.T) {
	f := newFixture(t)
	for _, a := range []string{"a1", "a2", "a3"} {
		f.ask(a, parking, false, "no_context")
	}
	f.run()
	list, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, "")
	id := list.Topics[0].ID
	top, err := f.svc.Dismiss(f.ctx, f.editor, f.slug, id, "", "We don't sell permits.")
	if err != nil || top.State != gaps.StateDismissed || top.StateReason != "We don't sell permits." {
		t.Fatalf("dismiss = %+v, %v", top, err)
	}
	if _, err := f.svc.Fix(f.ctx, f.editor, f.slug, id); !isCode(err, "gap_topic_closed") {
		t.Fatalf("fix a dismissed topic: %v", err)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE action = 'gap_topic.dismiss' AND target_id = $1 AND team_id = $2
		AND metadata::text NOT LIKE '%Parking%'`, id.String(), f.team); n != 1 {
		t.Fatalf("dismiss audit entries = %d", n)
	}
	if open, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, "open"); len(open.Topics) != 0 {
		t.Fatal("a dismissed topic is listed as open")
	}
	time.Sleep(10 * time.Millisecond)
	f.ask("a4", parking, false, "no_context")
	if sum := f.run(); sum.Reopened != 1 {
		t.Fatalf("run after a new failure = %+v", sum)
	}
	d, _ := f.svc.Get(f.ctx, f.editor, f.slug, id)
	if d.Topic.State != gaps.StateOpen {
		t.Fatalf("state after a new failure = %s", d.Topic.State)
	}
	// Two good answers near the topic after its last failure (internal/agents notes them).
	f.exec(`UPDATE gap_topics SET answered_since = $2, last_answered_at = now() + interval '1 second' WHERE id = $1`, id, gaps.ResolveAfter)
	if sum := f.run(); sum.Resolved != 1 {
		t.Fatalf("run after good answers = %+v", sum)
	}
	closed, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, "closed")
	if len(closed.Topics) != 1 || closed.Topics[0].State != gaps.StateResolved {
		t.Fatalf("closed topics = %+v", closed.Topics)
	}
}

// TestPermissions: members and platform staff get 404 for topics; platform
// staff read counts per team only.
func TestPermissions(t *testing.T) {
	f := newFixture(t)
	for _, a := range []string{"a1", "a2", "a3"} {
		f.ask(a, parking, false, "no_context", "uncited")
	}
	f.run()
	for name, actor := range map[string]authz.Actor{"member": f.member, "platform admin": f.admin} {
		if _, err := f.svc.List(f.ctx, actor, f.slug, nil, ""); !isStatus(err, 404) {
			t.Errorf("%s: list = %v, want 404", name, err)
		}
	}
	if _, err := f.svc.Counts(f.ctx, f.editor, time.Now().Add(-time.Hour), time.Now().Add(time.Hour), ""); !isStatus(err, 403) {
		t.Errorf("editor counts = %v, want 403", err)
	}
	counts, err := f.svc.Counts(f.ctx, f.admin, time.Now().Add(-time.Hour), time.Now().Add(time.Hour), "")
	if err != nil || len(counts) != 1 || counts[0].Questions != 3 || counts[0].Signals["uncited"] != 3 {
		t.Fatalf("counts = %+v, %v", counts, err)
	}
	if _, err := f.svc.List(f.ctx, f.editor, f.slug, nil, "sideways"); !isCode(err, "invalid_state") {
		t.Errorf("bad state = %v", err)
	}
}

func isStatus(err error, status int) bool {
	var ae *apperr.Error
	return errors.As(err, &ae) && ae.Status == status
}

func isCode(err error, code string) bool {
	var ae *apperr.Error
	return errors.As(err, &ae) && ae.Code == code
}
