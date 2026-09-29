package httpapi

import (
	"bytes"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/analytics"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/store"
)

// analyticsRoutes: platform analytics (docs/phase4-publishing.md §9).
func (a *api) analyticsRoutes() []route {
	return []route{
		{"GET", "/v1/admin/analytics", a.admin(a.adminGetAnalytics)},
		{"GET", "/v1/admin/analytics/daily.csv", a.admin(a.adminExportAnalyticsDaily)},
		{"GET", "/v1/admin/analytics/moderation-events", a.admin(a.adminListModerationEvents)},
	}
}

// dateRange reads the optional from and to query dates.
func dateRange(w http.ResponseWriter, r *http.Request) (from, to time.Time, ok bool) {
	if from, ok = parseDate(w, r, "from"); !ok {
		return
	}
	to, ok = parseDate(w, r, "to")
	return
}

// analyticsFilter reads the optional team (a slug) and audience filters (A9).
func (a *api) analyticsFilter(w http.ResponseWriter, r *http.Request) (analytics.Filter, bool) {
	f := analytics.Filter{Audience: r.URL.Query().Get("audience")}
	if slug := r.URL.Query().Get("team"); slug != "" {
		t, err := a.q.GetTeamBySlug(r.Context(), slug)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "team_not_found", "Team not found")
			return f, false
		} else if failed(w, r, err) {
			return f, false
		}
		f.Team = uuid.NullUUID{UUID: t.ID, Valid: true}
	}
	return f, true
}

func (a *api) adminGetAnalytics(w http.ResponseWriter, r *http.Request) {
	from, to, ok := dateRange(w, r)
	if !ok {
		return
	}
	f, ok := a.analyticsFilter(w, r)
	if !ok {
		return
	}
	ov, err := a.analytics.Overview(r.Context(), a.actor(r), from, to, f)
	if failed(w, r, err) {
		return
	}
	t := ov.Totals
	out := apitypes.PlatformAnalytics{
		From: date(ov.From), To: date(ov.To),
		Totals: apitypes.PlatformAnalyticsTotals{
			Answers: t.Answers, Conversations: t.Conversations, UniqueUsers: t.UniqueUsers, Up: t.Up, Down: t.Down,
			Satisfaction: t.Satisfaction, NoContextRate: t.NoContextRate, RefusalRate: t.RefusalRate, ErrorRate: t.ErrorRate,
			LatencyP50Ms: t.LatencyP50Ms, LatencyP95Ms: t.LatencyP95Ms, FirstTokenP50Ms: t.FirstTokenP50Ms,
			Moderation: moderationTotals(t.Moderation), Judging: judgingTotals(t.Judging),
			Citations: citationTotals(t.Citations), Scope: scopeTotals(t.Scope),
		},
		Models:    make([]apitypes.PlatformAnalyticsModel, len(ov.Models)),
		TopAgents: make([]apitypes.PlatformAnalyticsAgent, len(ov.TopAgents)),
		TopTeams:  make([]apitypes.PlatformAnalyticsTeam, len(ov.TopTeams)),
		Daily:     make([]apitypes.PlatformAnalyticsDay, len(ov.Daily)),
	}
	convertJSON(&out.Audiences, sharesJSON("audience", ov.Audiences))
	convertJSON(&out.Channels, sharesJSON("channel", ov.Channels))
	convertJSON(&out.Moderation, ov.Moderation)
	for i, m := range ov.Models {
		out.Models[i] = apitypes.PlatformAnalyticsModel{ModelId: m.ModelID, ModelName: m.ModelName, Kind: m.Kind,
			ChatInputTokens: m.ChatInput, ChatOutputTokens: m.ChatOutput, EmbeddingTokens: m.Embedding}
	}
	for i, ag := range ov.TopAgents {
		out.TopAgents[i] = apitypes.PlatformAnalyticsAgent{AgentId: ag.AgentID, AgentSlug: ag.AgentSlug, AgentName: ag.AgentName,
			TeamId: ag.TeamID, TeamSlug: ag.TeamSlug, TeamName: ag.TeamName, Deleted: ag.Deleted, Answers: ag.Answers,
			NoContextRate: ag.NoContextRate, Satisfaction: ag.Satisfaction, CitationSupportRate: ag.CitationSupportRate}
	}
	for i, tm := range ov.TopTeams {
		out.TopTeams[i] = apitypes.PlatformAnalyticsTeam{TeamId: tm.TeamID, TeamSlug: tm.Slug, TeamName: tm.Name, Answers: tm.Answers, Agents: tm.Agents}
	}
	for i, d := range ov.Daily {
		out.Daily[i] = apitypes.PlatformAnalyticsDay{Date: date(d.Date), Answers: d.Answers, Conversations: d.Conversations,
			NoContext: d.NoContext, Refused: d.Refused, ModerationBlocked: d.Blocked, ModerationFlagged: d.Flagged}
	}
	httpx.JSON(w, http.StatusOK, out)
}

// adminExportAnalyticsDaily sends the daily table as a CSV attachment.
func (a *api) adminExportAnalyticsDaily(w http.ResponseWriter, r *http.Request) {
	from, to, ok := dateRange(w, r)
	if !ok {
		return
	}
	f, ok := a.analyticsFilter(w, r)
	if !ok {
		return
	}
	from, to, days, err := a.analytics.Daily(r.Context(), a.actor(r), from, to, f)
	if failed(w, r, err) {
		return
	}
	var buf bytes.Buffer
	if err := analytics.WriteDailyCSV(&buf, days); err != nil {
		failed(w, r, err)
		return
	}
	name := "analytics-" + from.Format(time.DateOnly) + "-to-" + to.Format(time.DateOnly) + ".csv"
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// sharesJSON names each share's key (audience or channel) for convertJSON.
func sharesJSON(key string, shares []analytics.Share) []map[string]any {
	out := make([]map[string]any, len(shares))
	for i, s := range shares {
		out[i] = map[string]any{key: s.Key, "answers": s.Answers, "share": s.Share}
	}
	return out
}

func moderationTotals(m analytics.ModerationTotals) apitypes.ModerationTotals {
	return apitypes.ModerationTotals{QuestionsBlocked: m.QuestionsBlocked, AnswersWithheld: m.AnswersWithheld, Flagged: m.Flagged,
		Supported: m.Supported}
}

// citationTotals converts the SystemOne citation-check totals.
func citationTotals(c analytics.CitationTotals) apitypes.CitationTotals {
	return apitypes.CitationTotals{Answers: c.Answers, Pairs: c.Pairs, Verified: c.Verified, Unsupported: c.Unsupported,
		Contradicted: c.Contradicted, Unchecked: c.Unchecked, LowConfidence: c.LowConfidence, Removed: c.Removed,
		Refused: c.Refused, SupportRate: c.SupportRate, LatencyP50Ms: c.LatencyP50Ms, LatencyP95Ms: c.LatencyP95Ms,
		SupportedClaims: c.SupportedClaims, NotSupportedClaims: c.NotSupportedClaims, UncitedClaims: c.UncitedClaims,
		ClaimSupportRate: c.ClaimSupportRate}
}

// scopeTotals converts the SystemOne scope-check totals.
func scopeTotals(s analytics.ScopeTotals) apitypes.ScopeTotals {
	return apitypes.ScopeTotals{Checked: s.Checked, SmallTalk: s.SmallTalk, OutOfScope: s.OutOfScope, Refused: s.Refused,
		Skipped: s.Skipped, LatencyP50Ms: s.LatencyP50Ms}
}

// judgingTotals converts the SystemOne passage-judging totals.
func judgingTotals(j analytics.JudgingTotals) apitypes.JudgingTotals {
	out := apitypes.JudgingTotals{Answers: j.Answers, Candidates: j.Candidates, Evidence: j.Evidence,
		Conflicting: j.Conflicting, Kept: j.Kept, Skipped: j.Skipped, JudgedOut: j.JudgedOut, Requests: j.Requests,
		LatencyP50Ms: j.LatencyP50Ms, LatencyP95Ms: j.LatencyP95Ms}
	out.Dropped.Injection, out.Dropped.Irrelevant, out.Dropped.NotUsable = j.DroppedInjection, j.DroppedIrrelevant, j.DroppedNotUsable
	return out
}

// adminListModerationEvents is the moderation drill-down (docs/ui-review
// F-02): content-free decisions, newest first.
func (a *api) adminListModerationEvents(w http.ResponseWriter, r *http.Request) {
	from, to, ok := dateRange(w, r)
	if !ok {
		return
	}
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	keys, ok := decodeCursor(w, r, 2)
	if !ok {
		return
	}
	q := r.URL.Query()
	f := analytics.ModerationEventFilter{From: from, To: to, Decision: q.Get("decision"), Category: q.Get("category"), Limit: limit}
	if keys != nil {
		id, err := strconv.ParseInt(keys[0], 10, 64)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		f.BeforeID, f.BeforeStage = &id, keys[1]
	}
	if v := q.Get("agentId"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_agent", "agentId must be an agent ID")
			return
		}
		f.AgentID = &id
	}
	rows, more, err := a.analytics.ModerationEvents(r.Context(), a.actor(r), f)
	if failed(w, r, err) {
		return
	}
	page := apitypes.ModerationEventPage{Items: make([]apitypes.ModerationEvent, len(rows))}
	for i, e := range rows {
		page.Items[i] = apitypes.ModerationEvent{Id: e.ID, At: e.At, AgentId: e.AgentID, AgentName: e.AgentName, AgentSlug: e.AgentSlug,
			TeamSlug: e.TeamSlug, AgentDeleted: e.Deleted, Channel: apitypes.ModerationEventChannel(e.Channel),
			Audience: apitypes.Audience(e.Audience), Stage: apitypes.ModerationEventStage(e.Stage),
			Decision: apitypes.ModerationEventDecision(e.Decision), TopCategory: e.TopCategory, Score: e.Score,
			Categories: e.Categories, Downgraded: e.Downgraded, Provider: e.Provider, Calibrated: e.Calibrated, LatencyMs: e.LatencyMs}
	}
	if more {
		last := rows[len(rows)-1]
		page.NextCursor = encodeCursor(strconv.FormatInt(last.ID, 10), last.Stage)
	}
	httpx.JSON(w, http.StatusOK, page)
}
