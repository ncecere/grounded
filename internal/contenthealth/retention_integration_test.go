package contenthealth

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/testutil"
)

// What the not-cited signal can see is what the analytics events keep, and the events outlive conversations: message_events.message_id
// is ON DELETE SET NULL, so deleting a conversation (a person, or retention) removes the messages and leaves the event, its time and
// the document IDs it cited. Only the analytics-events period (one platform-wide setting, not the classification level's
// conversation retention) removes events. These tests use the real conversation deletion and the real retention runner.

// conversation adds a signed-in conversation of the agent with one answer event that cites the documents and is linked to its
// assistant message; it returns the conversation and the event.
func (f *fixture) conversation(agent uuid.UUID, user uuid.UUID, version uuid.UUID, at time.Time, cited ...uuid.UUID) (conv uuid.UUID, event int64) {
	f.t.Helper()
	conv = f.id(`INSERT INTO conversations (agent_id, user_id, last_version_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING id`, agent, user, version, at)
	f.exec(`INSERT INTO messages (conversation_id, seq, role, content, created_at) VALUES ($1, 1, 'user', '{"text":"q"}', $2), ($1, 2, 'assistant', '[]', $2)`, conv, at)
	assistant := f.id(`SELECT id FROM messages WHERE conversation_id = $1 AND role = 'assistant'`, conv)
	if cited == nil {
		cited = []uuid.UUID{}
	}
	if err := f.pool.QueryRow(f.ctx, `INSERT INTO message_events (team_id, agent_id, message_id, channel, audience_type, created_at, cited_document_ids, hit_count)
		VALUES ($1, $2, $3, 'ui', 'team', $4, $5, 3) RETURNING id`, f.teamA, agent, assistant, at, cited).Scan(&event); err != nil {
		f.t.Fatal(err)
	}
	return conv, event
}

func (f *fixture) runner() *retention.Runner {
	return &retention.Runner{Pool: f.pool, Env: config.RetentionDefaults(), Log: testutil.Logger()}
}

func (f *fixture) setPeriods(periods string) {
	f.exec(`UPDATE retention_settings SET periods = $1::jsonb, revision = revision + 1`, periods)
}

func (f *fixture) cites(doc uuid.UUID) SignalView { // the report's reading of the signal now
	f.t.Helper()
	return signalOf(f.make(CreateInput{}), SignalNeverCited)
}

func TestDeletingConversationsKeepsTheCitationEvidenceAndAnalyticsRetentionRemovesIt(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	agent := f.served(f.teamA, src)
	version := f.id(`SELECT published_version_id FROM agents WHERE id = $1`, agent)
	user := f.user("asker", "none")
	cited := f.addDoc(f.teamA, src, doc{})
	f.addDoc(f.teamA, src, doc{}) // never cited
	// 60 answers, the last 30 of them real conversations that cited the document; the rest have no conversation.
	week := time.Now().AddDate(0, 0, -45)
	f.answers(f.teamA, agent, MinAnswers-5, week, "api")
	var convs []uuid.UUID
	var events []int64
	for i := range 30 {
		c, e := f.conversation(agent, user, version, week.Add(time.Duration(i)*time.Minute), cited)
		convs, events = append(convs, c), append(events, e)
	}
	before := f.cites(cited)
	if before.State != StateMeasured || before.Found != 1 {
		t.Fatalf("before: %+v, want the one uncited document found (the cited one is cited by the 30 conversations' events)", before)
	}

	// A user deletes half of the conversations and retention removes them for good (a grace period of 0): the messages go.
	f.exec(`UPDATE conversations SET deleted_at = now() - interval '2 days' WHERE id = ANY($1)`, convs[:15])
	f.setPeriods(`{"deleted_conversations": 0}`)
	res, err := f.runner().Apply(f.ctx, []retention.Kind{retention.DeletedConversations})
	if err != nil || res[retention.DeletedConversations].Deleted != 15 {
		t.Fatalf("retention = %+v, %v; want the 15 deleted conversations removed", res, err)
	}
	// The classification level's conversation retention removes the other half: not the events either.
	f.exec(`UPDATE classification_levels SET conversation_retention_days = 1 WHERE key = 'open'`)
	res, err = f.runner().Apply(f.ctx, []retention.Kind{retention.Conversations})
	if err != nil || res[retention.Conversations].Deleted != 15 {
		t.Fatalf("conversation retention = %+v, %v; want the other 15 removed by the level's period", res, err)
	}
	if n := f.count(`SELECT count(*) FROM messages`) + f.count(`SELECT count(*) FROM conversations`); n != 0 {
		t.Fatalf("%d messages or conversations left: the conversations were not deleted", n)
	}
	// The events stay, unlinked from their messages (ON DELETE SET NULL), still citing the document: deleting a conversation does
	// not remove analytics metadata, and the level's conversation retention is not the analytics period.
	if n := f.count(`SELECT count(*) FROM message_events WHERE id = ANY($1) AND message_id IS NULL AND $2 = ANY(cited_document_ids)`, events, cited); n != 30 {
		t.Fatalf("%d of the 30 events survive unlinked with their citation, want all", n)
	}
	after := f.cites(cited)
	if after.State != StateMeasured || after.Found != 1 || after.Counts["answers"] != MinAnswers+25 {
		t.Fatalf("after deleting the conversations: %+v, want the same reading: the document stays cited, 75 answers still seen", after)
	}

	// The analytics-events period is what removes them: one platform-wide setting. Older than it, they are gone, and the signal
	// sees fewer answers: here too few to say anything.
	f.setPeriods(`{"analytics_events": 30}`)
	res, err = f.runner().Apply(f.ctx, []retention.Kind{retention.AnalyticsEvents})
	if err != nil || res[retention.AnalyticsEvents].Deleted != int64(MinAnswers-5+30) {
		t.Fatalf("analytics retention = %+v, %v; want all %d events (45 days old) removed", res, err, MinAnswers-5+30)
	}
	gone := f.cites(cited)
	if gone.State != StateUnavailable || gone.Reason != ReasonNoAnswers {
		t.Fatalf("after analytics retention: %+v, want unavailable (no answers): expired evidence is invisible, not 'never cited'", gone)
	}
}
