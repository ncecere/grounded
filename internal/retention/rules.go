package retention

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Rule is the retention of one kind of data.
//
// candidates returns a query of the rows due for deletion at $1 (now), with
// the columns key, team_id (uuid, NULL for platform rows), rank (the
// classification rank, NULL when none applies), audience, reason and held
// (a legal hold covers the row). ok is false when the kind keeps everything
// under the current periods. Periods are inlined as integers.
//
// purge deletes up to batch unheld candidates in tx and returns how many.
type Rule struct {
	Kind       Kind
	candidates func(p Periods) (query string, ok bool)
	purge      func(ctx context.Context, r *Runner, tx pgx.Tx, candidates string, now time.Time, batch int) (int64, error)
}

// Rules returns every rule, in run order.
func Rules() []Rule {
	return []Rule{
		{Kind: Conversations, candidates: func(Periods) (string, bool) { return conversationsDue, true }, purge: deleteFrom("conversations", "id")},
		{Kind: DeletedConversations, candidates: periodic(DeletedConversations, deletedConversationsDue), purge: deleteFrom("conversations", "id")},
		{Kind: AccessLog, candidates: periodic(AccessLog, accessLogDue), purge: deleteFrom("access_log", "id")},
		{Kind: AnalyticsEvents, candidates: periodic(AnalyticsEvents, analyticsEventsDue), purge: deleteFrom("message_events", "id")},
		{Kind: UsageEvents, candidates: periodic(UsageEvents, usageEventsDue), purge: purgeUsage},
		{Kind: AuditLog, candidates: periodic(AuditLog, auditLogDue), purge: purgeAudit},
		{Kind: DeletedFiles, candidates: periodic(DeletedFiles, deletedFilesDue), purge: purgeFiles},
		{Kind: ExpiredInvites, candidates: periodic(ExpiredInvites, expiredInvitesDue), purge: deleteFrom("team_invites", "id")},
		{Kind: AnonymousSessions, candidates: func(Periods) (string, bool) { return anonymousSessionsDue, true }, purge: deleteFrom("anon_sessions", "id")},
	}
}

// periodic fills a kind's period (days) into its query; a kind without a
// period keeps everything.
func periodic(k Kind, query string) func(Periods) (string, bool) {
	return func(p Periods) (string, bool) {
		days, ok := p.Days(k)
		if !ok {
			return "", false
		}
		return fmt.Sprintf(query, days), true
	}
}

// deleteFrom deletes a batch of unheld candidates from table by key column.
func deleteFrom(table, key string) func(context.Context, *Runner, pgx.Tx, string, time.Time, int) (int64, error) {
	stmt := `DELETE FROM ` + table + ` WHERE ` + key + ` IN (SELECT c.key FROM (%s) c WHERE NOT c.held LIMIT $2)`
	return func(ctx context.Context, _ *Runner, tx pgx.Tx, candidates string, now time.Time, batch int) (int64, error) {
		tag, err := tx.Exec(ctx, fmt.Sprintf(stmt, candidates), now, batch)
		return tag.RowsAffected(), err
	}
}

// ---- conversations -----------------------------------------------------------------------

// conversationFrom joins a conversation to its team and to the level of the
// agent version it last used. A conversation of an unknown version counts as
// the lowest level when anonymous (as before) and has no retention when
// signed in.
const conversationFrom = `
FROM conversations c
JOIN agents a ON a.id = c.agent_id
LEFT JOIN agent_versions v ON v.id = c.last_version_id
LEFT JOIN LATERAL (
    SELECT l.conversation_retention_days, l.anonymous_retention_hours FROM classification_levels l
    WHERE l.rank <= coalesce(v.effective_rank, 0) ORDER BY l.rank DESC LIMIT 1
) lvl ON true`

// levelExpired: past the level's retention, from the last activity.
const levelExpired = `(CASE WHEN c.anonymous
        THEN c.updated_at + make_interval(hours => coalesce(lvl.anonymous_retention_hours, 24)) < $1::timestamptz
        ELSE v.id IS NOT NULL AND lvl.conversation_retention_days IS NOT NULL
             AND c.updated_at + make_interval(days => lvl.conversation_retention_days) < $1::timestamptz END)`

const conversationColumns = `SELECT c.id AS key, a.team_id, coalesce(v.effective_rank, 0) AS rank,
       (CASE WHEN c.anonymous THEN 'anonymous' ELSE 'signed_in' END)::text AS audience, %s::text AS reason,
       legal_hold_covers(ARRAY[c.id, c.agent_id, a.team_id, c.user_id], c.created_at, c.updated_at) AS held`

var conversationsDue = fmt.Sprintf(conversationColumns, `'retention'`) + conversationFrom + `
WHERE ` + levelExpired

// Deleted by their users longer ago than the grace period (%d days), and not
// already due under their level.
var deletedConversationsDue = fmt.Sprintf(conversationColumns, `'deleted'`) + conversationFrom + `
WHERE c.deleted_at < $1::timestamptz - make_interval(days => %d) AND NOT ` + levelExpired

// ---- logs and events ---------------------------------------------------------------------

// The access log: its agent's team, the rank used.
const accessLogDue = `SELECT l.id AS key, a.team_id, l.rank, l.channel AS audience, 'retention'::text AS reason,
       legal_hold_covers(ARRAY[l.user_id, l.agent_id, a.team_id], l.at, l.at) AS held
FROM access_log l
LEFT JOIN agents a ON a.id = l.agent_id
WHERE l.at < $1::timestamptz - make_interval(days => %d)`

// Analytics events: a hold on the conversation (or its user) of the answer
// keeps its event too.
const analyticsEventsDue = `SELECT e.id AS key, e.team_id, NULL::int AS rank, e.audience_type AS audience, 'retention'::text AS reason,
       legal_hold_covers(ARRAY[e.team_id, e.agent_id, m.conversation_id, cv.user_id], e.created_at, e.created_at) AS held
FROM message_events e
LEFT JOIN messages m ON m.id = e.message_id
LEFT JOIN conversations cv ON cv.id = m.conversation_id
WHERE e.created_at < $1::timestamptz - make_interval(days => %d)`

const usageEventsDue = `SELECT u.id AS key, u.team_id, NULL::int AS rank, coalesce(u.metadata->>'channel', '')::text AS audience, 'retention'::text AS reason,
       legal_hold_covers(ARRAY[u.team_id, u.agent_id, u.user_id], u.occurred_at, u.occurred_at) AS held
FROM usage_events u
WHERE u.occurred_at < $1::timestamptz - make_interval(days => %d)`

// purgeUsage rolls the deleted events up per UTC day, kind, team, agent,
// model and channel (usage_daily), in the same statement, so analytics
// totals over any range stay the same.
func purgeUsage(ctx context.Context, _ *Runner, tx pgx.Tx, candidates string, now time.Time, batch int) (int64, error) {
	var n int64
	err := tx.QueryRow(ctx, fmt.Sprintf(`WITH del AS (
    DELETE FROM usage_events WHERE id IN (SELECT c.key FROM (%s) c WHERE NOT c.held LIMIT $2)
    RETURNING occurred_at, kind, team_id, agent_id, model_id, coalesce(metadata->>'channel', '') AS channel, quantity
), ins AS (
    INSERT INTO usage_daily (day, kind, team_id, agent_id, model_id, channel, quantity, events)
    SELECT (occurred_at AT TIME ZONE 'UTC')::date, kind, team_id, agent_id, model_id, channel, sum(quantity), count(*)
    FROM del GROUP BY 1, 2, 3, 4, 5, 6
    ON CONFLICT ON CONSTRAINT usage_daily_key DO UPDATE
    SET quantity = usage_daily.quantity + EXCLUDED.quantity, events = usage_daily.events + EXCLUDED.events
    RETURNING 1
)
SELECT count(*) FROM del`, candidates), now, batch).Scan(&n)
	return n, err
}

// The audit log, except legal hold entries, which are kept for good. A hold
// on the acting user, the team or the target keeps an entry.
const auditLogDue = `SELECT a.id AS key, a.team_id, NULL::int AS rank, ''::text AS audience, 'retention'::text AS reason,
       legal_hold_covers(ARRAY[a.team_id, a.actor_user_id, t.id], a.occurred_at, a.occurred_at) AS held
FROM audit_log a
CROSS JOIN LATERAL (
    SELECT CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.target_id::uuid END AS id
) t
WHERE a.occurred_at < $1::timestamptz - make_interval(days => %d) AND a.action NOT LIKE 'legal\_hold.%%' ESCAPE '\'`

// purgeAudit sets the setting the audit log's append-only trigger allows
// deletes under (migration 00001), for this transaction only.
func purgeAudit(ctx context.Context, r *Runner, tx pgx.Tx, candidates string, now time.Time, batch int) (int64, error) {
	if _, err := tx.Exec(ctx, `SELECT set_config('ragd.audit_purge', 'on', true)`); err != nil {
		return 0, err
	}
	return deleteFrom("audit_log", "id")(ctx, r, tx, candidates, now, batch)
}

// ---- files, invites, sessions ------------------------------------------------------------

// Stored files of deleted documents and sources, after the grace period. A
// hold on their team keeps them.
const deletedFilesDue = `SELECT f.id AS key, f.team_id, NULL::int AS rank, ''::text AS audience, 'deleted'::text AS reason,
       legal_hold_covers(ARRAY[f.team_id, f.source_id], f.content_from, f.deleted_at) AS held
FROM deleted_files f
WHERE f.deleted_at < $1::timestamptz - make_interval(days => %d)`

// Invites that expired or were revoked, the period after that (accepted
// invites are kept: they record how someone joined).
const expiredInvitesDue = `SELECT i.id AS key, i.team_id, NULL::int AS rank, ''::text AS audience, 'expired'::text AS reason,
       legal_hold_covers(ARRAY[i.team_id, i.invited_by], i.created_at, coalesce(i.revoked_at, i.expires_at)) AS held
FROM team_invites i
WHERE i.accepted_at IS NULL AND coalesce(i.revoked_at, i.expires_at) < $1::timestamptz - make_interval(days => %d)`

// Anonymous sessions end at expiry; their conversations keep their own
// retention. Sessions hold no content, so holds don't apply.
const anonymousSessionsDue = `SELECT s.id AS key, a.team_id, NULL::int AS rank, s.channel AS audience, 'expired'::text AS reason, false AS held
FROM anon_sessions s
JOIN agents a ON a.id = s.agent_id
WHERE s.expires_at < $1::timestamptz`
