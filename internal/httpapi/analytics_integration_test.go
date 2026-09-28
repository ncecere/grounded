package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// analyticsQuestions are the questions asked in real chats; no analytics
// response may contain them.
var analyticsQuestions = []string{"Where do I buy a parking permit?", "When do residence halls open for move-in?"}

// seedAnalytics adds synthetic answers next to real chats: public and widget
// answers of the published agent with moderation records, and another
// team's authenticated agent answering over the API. It returns the other
// team's agent ID.
func seedAnalytics(t *testing.T, env *agentEnv, agentID uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var teamID, otherTeam, otherAgent uuid.UUID
	if err := env.app.Pool.QueryRow(ctx, `SELECT id FROM teams WHERE slug = $1`, env.team).Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	if err := env.app.Pool.QueryRow(ctx, `WITH t AS (INSERT INTO teams (slug, name, max_classification) VALUES ('library', 'Library', 'open') RETURNING id)
		INSERT INTO agents (team_id, slug, name) SELECT id, 'ask-a-librarian', 'Ask a librarian' FROM t RETURNING team_id, id`).Scan(&otherTeam, &otherAgent); err != nil {
		t.Fatal(err)
	}
	_, err := env.app.Pool.Exec(ctx, `
		INSERT INTO message_events (team_id, agent_id, created_at, channel, audience_type, latency_ms, pseudonymous_user, feedback,
			no_context, refused, moderation_input, moderation_output)
		VALUES
			($1, $2, now() - interval '1 day', 'public', 'public', 900, 'anon-one', NULL, false, false,
				'{"decision":"block","topCategory":"violence","score":0.93,"provider":"chat_classifier"}', NULL),
			($1, $2, now() - interval '1 day', 'public', 'public', 900, 'anon-one', NULL, false, false,
				'{"decision":"pass","score":0.01}', '{"decision":"block","topCategory":"sexual","score":0.8}'),
			($1, $2, now() - interval '2 days', 'public', 'public', 900, 'anon-two', 'up', false, false,
				'{"decision":"pass","score":0.01}', '{"decision":"pass","score":0}'),
			($1, $2, now() - interval '2 days', 'widget', 'public', 900, 'anon-two', 'down', false, false,
				'{"decision":"flag","topCategory":"personal_data","score":0.6}', NULL),
			($1, $2, now() - interval '2 days', 'widget', 'public', 900, NULL, NULL, false, false, '{"decision":"error","score":0}', NULL),
			($3, $4, now() - interval '10 days', 'api', 'all_authenticated', 1500, NULL, NULL, true, false, NULL, NULL),
			($3, $4, now() - interval '10 days', 'api', 'all_authenticated', 1500, NULL, NULL, false, true, NULL, NULL),
			($3, $4, now() - interval '10 days', 'api', 'all_authenticated', 1500, NULL, NULL, false, false, NULL, NULL),
			($3, $4, now() - interval '10 days', 'api', 'all_authenticated', 1500, NULL, NULL, false, false, NULL, NULL),
			($3, $4, now() - interval '40 days', 'api', 'all_authenticated', 1500, NULL, NULL, false, false, NULL, NULL),
			($3, $4, now() - interval '3 days', 'test', 'team', 1500, NULL, NULL, false, false, NULL, NULL)`,
		teamID, agentID, otherTeam, otherAgent)
	if err != nil {
		t.Fatal(err)
	}
	return otherAgent
}

// TestPlatformAnalytics: totals, breakdowns, top lists, daily rows and the
// CSV export on real and seeded events; who may read them; range checks;
// and no content or user identities in any response.
func TestPlatformAnalytics(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Help desk", env.agentConfig(env.kb.Id.String()))
	for _, q := range analyticsQuestions {
		code, _, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": q})
		mustCode(t, "chat", code, e, 200, "")
	}
	code, _, e := env.editor.stream(env.base+"/agents/"+ag.Id.String()+"/test", map[string]any{"message": analyticsQuestions[0]})
	mustCode(t, "test chat", code, e, 200, "")
	otherAgent := seedAnalytics(t, env, ag.Id)

	// Who may read: platform admins and auditors, not team members.
	var ov apitypes.PlatformAnalytics
	code = env.auditor.get("/v1/admin/analytics", &ov)
	mustCode(t, "auditor", code, "", 200, "")
	for _, s := range []*session{env.member, env.editor, env.owner} {
		code, e := s.call("GET", "/v1/admin/analytics", nil, nil, nil)
		mustCode(t, "non-admin", code, e, 403, "")
		code, _ = s.raw("GET", "/v1/admin/analytics/daily.csv", nil, nil)
		mustCode(t, "non-admin csv", code, "", 403, "")
	}
	code = env.admin.get("/v1/admin/analytics", &ov)
	mustCode(t, "admin", code, "", 200, "")
	checkOverview(t, env, ov, ag, otherAgent)

	// Ranges: validated, and an explicit range includes older events.
	today := time.Now().UTC()
	for q, want := range map[string]string{
		"?from=2026-09-10&to=2026-09-01": "invalid_range",
		"?from=yesterday":                "invalid_from",
		"?to=2026-13-01":                 "invalid_to",
		"?from=" + today.AddDate(0, 0, -400).Format(time.DateOnly): "invalid_range",
	} {
		code, e := env.admin.call("GET", "/v1/admin/analytics"+q, nil, nil, nil)
		mustCode(t, "range "+q, code, e, 400, want)
		code, body := env.admin.raw("GET", "/v1/admin/analytics/daily.csv"+q, nil, nil)
		mustCode(t, "csv range "+q, code, errorCode(body), 400, want)
	}
	var wide apitypes.PlatformAnalytics
	env.admin.get("/v1/admin/analytics?from="+today.AddDate(0, 0, -59).Format(time.DateOnly)+"&to="+today.Format(time.DateOnly), &wide)
	if wide.Totals.Answers != ov.Totals.Answers+1 || len(wide.Daily) != 60 {
		t.Errorf("60-day range = %d answers, %d days (30 days: %d)", wide.Totals.Answers, len(wide.Daily), ov.Totals.Answers)
	}

	checkAnalyticsFilters(t, env, ov)
	csvBody := checkDailyCSV(t, env, ov)
	var team apitypes.AgentAnalytics
	if code := env.editor.get(env.base+"/agents/"+ag.Id.String()+"/analytics", &team); code != 200 {
		t.Fatalf("team analytics = %d", code)
	}
	checkTeamBreakdowns(t, team)
	teamBody, _ := json.Marshal(team)
	ovBody, _ := json.Marshal(ov)
	assertNoContentOrIdentities(t, env, map[string]string{"overview": string(ovBody), "csv": csvBody, "team analytics": string(teamBody)})
}

func checkOverview(t *testing.T, env *agentEnv, ov apitypes.PlatformAnalytics, ag apitypes.Agent, otherAgent uuid.UUID) {
	t.Helper()
	tot := ov.Totals
	// 2 real chats + 5 public/widget + 4 API; not the test chats or the
	// answer 40 days ago.
	if tot.Answers != 11 || tot.UniqueUsers != 3 || tot.Up != 1 || tot.Down != 1 || tot.Satisfaction == nil || *tot.Satisfaction != 0.5 {
		t.Errorf("totals = %+v", tot)
	}
	if want := env.scalar(t, `SELECT count(*) FROM conversations WHERE created_at >= now() - interval '29 days'`); tot.Conversations != want || want < 2 {
		t.Errorf("conversations = %d, want %d", tot.Conversations, want)
	}
	if tot.Moderation != (apitypes.ModerationTotals{QuestionsBlocked: 1, AnswersWithheld: 1, Flagged: 1}) {
		t.Errorf("moderation totals = %+v", tot.Moderation)
	}
	if tot.RefusalRate == nil || tot.NoContextRate == nil || tot.LatencyP50Ms == nil || tot.LatencyP95Ms == nil || *tot.LatencyP95Ms < *tot.LatencyP50Ms {
		t.Errorf("rates = %+v", tot)
	}
	shares := map[string]float64{}
	answers := map[string]int64{}
	for _, a := range ov.Audiences {
		answers["audience/"+string(a.Audience)], shares["audience/"+string(a.Audience)] = a.Answers, a.Share
	}
	for _, c := range ov.Channels {
		answers["channel/"+string(c.Channel)], shares["channel/"+string(c.Channel)] = c.Answers, c.Share
	}
	for k, want := range map[string]int64{"audience/public": 5, "audience/all_authenticated": 4, "audience/team": 2,
		"channel/public": 3, "channel/widget": 2, "channel/api": 4, "channel/ui": 2, "channel/test": 0} {
		if answers[k] != want {
			t.Errorf("%s = %d, want %d (all %v)", k, answers[k], want, answers)
		}
	}
	if ov.Audiences[0].Audience != "public" || shares["audience/public"] != 5.0/11 {
		t.Errorf("audiences = %+v", ov.Audiences)
	}
	mod := map[string]int64{}
	for _, m := range ov.Moderation {
		mod[string(m.Stage)+"/"+string(m.Decision)+"/"+m.Category] = m.Count
	}
	for k, want := range map[string]int64{"input/block/violence": 1, "output/block/sexual": 1, "input/flag/personal_data": 1, "input/error/": 1} {
		if mod[k] != want || len(mod) != 4 {
			t.Errorf("moderation %s = %d, want %d (all %v)", k, mod[k], want, mod)
		}
	}
	if len(ov.TopAgents) != 2 || ov.TopAgents[0].AgentId != ag.Id || ov.TopAgents[0].Answers != 7 || ov.TopAgents[0].AgentName != "Help desk" ||
		ov.TopAgents[0].TeamSlug != env.team || ov.TopAgents[1].AgentId != otherAgent || ov.TopAgents[1].TeamName != "Library" ||
		ov.TopAgents[1].NoContextRate != 0.25 || ov.TopAgents[1].Satisfaction != nil {
		t.Errorf("top agents = %+v", ov.TopAgents)
	}
	if len(ov.TopTeams) != 2 || ov.TopTeams[0].TeamSlug != env.team || ov.TopTeams[0].Answers != 7 || ov.TopTeams[1].TeamSlug != "library" || ov.TopTeams[1].Agents != 1 {
		t.Errorf("top teams = %+v", ov.TopTeams)
	}
	kinds := map[string]apitypes.PlatformAnalyticsModel{}
	for _, m := range ov.Models {
		kinds[m.Kind] = m
	}
	if c, e := kinds["chat"], kinds["embedding"]; c.ModelName != "Chat Tools" || c.ChatInputTokens == 0 || c.ChatOutputTokens == 0 || e.EmbeddingTokens == 0 {
		t.Errorf("models = %+v", ov.Models)
	}
	var sum int64
	for _, d := range ov.Daily {
		sum += d.Answers
	}
	tenDays := ov.Daily[len(ov.Daily)-11]
	if len(ov.Daily) != 30 || sum != 11 || tenDays.Answers != 4 || tenDays.NoContext != 1 || tenDays.Refused != 1 {
		t.Errorf("daily: %d days, %d answers, 10 days ago %+v", len(ov.Daily), sum, tenDays)
	}
}

// checkAnalyticsFilters: the team and audience filters (docs/ui-review A9)
// narrow every count, and unknown values are refused.
func checkAnalyticsFilters(t *testing.T, env *agentEnv, all apitypes.PlatformAnalytics) {
	t.Helper()
	var lib apitypes.PlatformAnalytics
	mustCode(t, "team filter", env.admin.get("/v1/admin/analytics?team=library", &lib), "", 200, "")
	if lib.Totals.Answers != 4 || len(lib.TopTeams) != 1 || lib.TopTeams[0].TeamSlug != "library" || len(lib.TopAgents) != 1 ||
		lib.Totals.Conversations != 0 || len(lib.Moderation) != 0 {
		t.Errorf("team=library: %d answers, %d conversations, top teams %+v, top agents %d, moderation %v",
			lib.Totals.Answers, lib.Totals.Conversations, lib.TopTeams, len(lib.TopAgents), lib.Moderation)
	}
	var pub apitypes.PlatformAnalytics
	mustCode(t, "audience filter", env.admin.get("/v1/admin/analytics?audience=public", &pub), "", 200, "")
	if pub.Totals.Answers != 5 || len(pub.Audiences) != 1 || pub.Audiences[0].Share != 1 || pub.Totals.Moderation.QuestionsBlocked != 1 {
		t.Errorf("audience=public: %+v, audiences %+v", pub.Totals, pub.Audiences)
	}
	var both apitypes.PlatformAnalytics
	env.admin.get("/v1/admin/analytics?team="+env.team+"&audience=team", &both)
	if both.Totals.Answers != 2 || both.Totals.Conversations != all.Totals.Conversations {
		t.Errorf("team+audience: %d answers, %d conversations (all: %d)", both.Totals.Answers, both.Totals.Conversations, all.Totals.Conversations)
	}
	code, e := env.admin.call("GET", "/v1/admin/analytics?team=no-such-team", nil, nil, nil)
	mustCode(t, "unknown team", code, e, 404, "team_not_found")
	code, e = env.admin.call("GET", "/v1/admin/analytics?audience=everyone", nil, nil, nil)
	mustCode(t, "unknown audience", code, e, 400, "invalid_audience")
	code, body := env.admin.raw("GET", "/v1/admin/analytics/daily.csv?team=library", nil, nil)
	if code != 200 || strings.Count(strings.TrimSpace(string(body)), "\n") != 30 {
		t.Errorf("filtered csv = %d", code)
	}
}

// checkDailyCSV checks the export's headers and rows, and returns it.
func checkDailyCSV(t *testing.T, env *agentEnv, ov apitypes.PlatformAnalytics) string {
	t.Helper()
	req, _ := http.NewRequest("GET", env.app.URL+"/v1/admin/analytics/daily.csv", nil)
	res, err := env.auditor.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var b strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := res.Body.Read(buf)
		b.Write(buf[:n])
		if err != nil {
			break
		}
	}
	body := b.String()
	name := `attachment; filename="analytics-` + ov.From.Format(time.DateOnly) + `-to-` + ov.To.Format(time.DateOnly) + `.csv"`
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "text/csv; charset=utf-8" || res.Header.Get("Content-Disposition") != name {
		t.Fatalf("csv = %d %v", res.StatusCode, res.Header)
	}
	lines := strings.Split(strings.TrimSuffix(body, "\n"), "\n")
	if len(lines) != 31 || lines[0] != "date,answers,conversations,no_context,refused,moderation_blocked,moderation_flagged" {
		t.Fatalf("csv lines = %d, header %q", len(lines), lines[0])
	}
	tenDays := ov.Daily[len(ov.Daily)-11]
	if want := tenDays.Date.Format(time.DateOnly) + ",4,0,1,1,0,0"; lines[len(lines)-11] != want {
		t.Errorf("csv row = %q, want %q", lines[len(lines)-11], want)
	}
	return body
}

// checkTeamBreakdowns: the agent's audience and channel breakdowns and
// moderation totals.
func checkTeamBreakdowns(t *testing.T, an apitypes.AgentAnalytics) {
	t.Helper()
	aud := map[string]int64{}
	for _, a := range an.Audiences {
		aud[string(a.Audience)] = a.Answers
	}
	ch := map[string]int64{}
	for _, c := range an.Channels {
		ch[string(c.Channel)] = c.Answers
	}
	if len(aud) != 2 || aud["public"] != 5 || aud["team"] != 2 || an.Audiences[0].Audience != "public" {
		t.Errorf("audiences = %+v", an.Audiences)
	}
	if ch["public"] != 3 || ch["widget"] != 2 || ch["ui"] != 2 || ch["test"] != 1 {
		t.Errorf("channels = %+v", an.Channels)
	}
	if an.Totals.Moderation != (apitypes.ModerationTotals{QuestionsBlocked: 1, AnswersWithheld: 1, Flagged: 1}) || len(an.Moderation) != 4 {
		t.Errorf("moderation = %+v %+v", an.Totals.Moderation, an.Moderation)
	}
}

// assertNoContentOrIdentities fails when a response contains a question,
// an answer, a conversation, or anything that identifies a user.
func assertNoContentOrIdentities(t *testing.T, env *agentEnv, bodies map[string]string) {
	t.Helper()
	forbidden := append([]string{}, analyticsQuestions...)
	forbidden = append(forbidden, "permit decal", "blair@localhost", "anon-one", "anon-two", "user_id", "userId", "email", "pseudonym")
	rows, err := env.app.Pool.Query(context.Background(), `
		SELECT id::text FROM users UNION ALL SELECT display_name FROM users WHERE display_name <> ''
		UNION ALL SELECT id::text FROM conversations UNION ALL SELECT title FROM conversations WHERE title <> ''
		UNION ALL SELECT pseudonymous_user FROM message_events WHERE pseudonymous_user IS NOT NULL
		UNION ALL SELECT id::text FROM messages`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		forbidden = append(forbidden, s)
	}
	rows.Close()
	if len(forbidden) < 20 {
		t.Fatalf("too few identities to check: %v", forbidden)
	}
	for name, body := range bodies {
		for _, f := range forbidden {
			if strings.Contains(strings.ToLower(body), strings.ToLower(f)) {
				t.Errorf("%s contains %q", name, f)
			}
		}
	}
}
