package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// viaJSON converts between types with the same JSON shape (domain structs
// whose tags match the generated API types).
func viaJSON[T any](v any) T {
	var out T
	b, _ := json.Marshal(v)
	_ = json.Unmarshal(b, &out)
	return out
}

// convertJSON copies src into dst through JSON.
func convertJSON(dst, src any) {
	b, _ := json.Marshal(src)
	_ = json.Unmarshal(b, dst)
}

func toAPIConfig(c agents.Config) apitypes.AgentConfig {
	out := viaJSON[apitypes.AgentConfig](c)
	if out.Kbs == nil {
		out.Kbs = []apitypes.AgentKB{}
	}
	return out
}

func toAPIVersion(v agents.Version) apitypes.AgentVersion {
	out := apitypes.AgentVersion{
		Id: v.ID, Version: v.Version, PublishedAt: v.PublishedAt, PublishedBy: nullUUID(v.PublishedBy),
		PublishedByName: v.PublishedByName, Note: v.Note, ChatModelId: v.ChatModelID, ChatModelName: v.ChatModelName,
		EffectiveRank: v.EffectiveRank, Classification: v.Classification, Config: toAPIConfig(v.Config),
		KnowledgeBases: make([]apitypes.AgentVersionKB, len(v.KBs)),
	}
	for i, kb := range v.KBs {
		out.KnowledgeBases[i] = apitypes.AgentVersionKB{Id: kb.ID, Name: kb.Name, TopK: kb.TopK, Inherited: kb.Inherited}
	}
	if len(v.Tools) > 0 {
		tools := make([]apitypes.AgentVersionTool, len(v.Tools))
		for i, t := range v.Tools {
			tools[i] = apitypes.AgentVersionTool{Id: t.ID, Name: t.Name, Title: t.Title, ServerName: t.ServerName}
		}
		out.Tools = &tools
	}
	return out
}

func toAPIAgent(v agents.View) apitypes.Agent {
	ag := v.Agent
	out := apitypes.Agent{
		Id: ag.ID, TeamId: ag.TeamID, TeamSlug: v.TeamSlug, Slug: ag.Slug, Name: ag.Name, Description: ag.Description,
		AccentColor: ag.AccentColor, WelcomeMessage: ag.WelcomeMessage, StarterQuestions: nonNilStrings(ag.StarterQuestions),
		Status: apitypes.AgentStatus(ag.Status), DisabledReason: ag.DisabledReason, DisabledAt: ag.DisabledAt,
		Audience: apitypes.Audience(v.Audience), Draft: toAPIConfig(v.Draft), DraftRevision: ag.DraftRevision,
		HasUnpublishedChanges: v.HasUnpublishedChanges, Warnings: make([]apitypes.AgentProblem, len(v.Warnings)),
		Revision: ag.Revision, CreatedAt: ag.CreatedAt, UpdatedAt: ag.UpdatedAt,
	}
	for i, p := range v.Warnings {
		out.Warnings[i] = apitypes.AgentProblem{Field: p.Field, Problem: p.Problem}
	}
	if v.Published != nil {
		pv := toAPIVersion(*v.Published)
		out.Published = &pv
	}
	return out
}

func toAPICard(c agents.Card) apitypes.AgentCard {
	ag := c.Agent
	return apitypes.AgentCard{
		Id: ag.ID, TeamSlug: c.TeamSlug, TeamName: c.TeamName, Slug: ag.Slug, Name: ag.Name, Description: ag.Description,
		AccentColor: ag.AccentColor, WelcomeMessage: ag.WelcomeMessage, StarterQuestions: nonNilStrings(ag.StarterQuestions),
		CitationMode: apitypes.CitationMode(c.CitationMode), Status: apitypes.AgentStatus(ag.Status),
		Audience: apitypes.Audience(c.Audience), ShortName: c.ShortName, Group: (*apitypes.AgentCardGroup)(nonEmpty(c.Group)),
	}
}

// nonEmpty is nil for "".
func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// agentBody is the create/update body. config stays raw so the agents
// package reports field-level problems.
type agentBody struct {
	Name             *string         `json:"name"`
	Slug             *string         `json:"slug"`
	Description      *string         `json:"description"`
	AccentColor      *string         `json:"accentColor"`
	WelcomeMessage   *string         `json:"welcomeMessage"`
	StarterQuestions *[]string       `json:"starterQuestions"`
	Config           json.RawMessage `json:"config"`
}

func (b agentBody) profile() agents.Profile {
	return agents.Profile{Name: b.Name, Slug: b.Slug, Description: b.Description, AccentColor: b.AccentColor,
		WelcomeMessage: b.WelcomeMessage, StarterQuestions: b.StarterQuestions}
}

func (a *api) listAgents(w http.ResponseWriter, r *http.Request) {
	list, err := a.Agents.List(r.Context(), a.actor(r), r.PathValue("team"))
	writeList(w, r, list, err, toAPIAgent)
}

func (a *api) createAgent(w http.ResponseWriter, r *http.Request) {
	var in agentBody
	if !httpx.Decode(w, r, &in) {
		return
	}
	if in.Name == nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_name", "Name is required")
		return
	}
	v, err := a.Agents.Create(r.Context(), a.actor(r), r.PathValue("team"), agents.CreateInput{Profile: in.profile(), Config: in.Config})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, v.Agent.Revision, toAPIAgent(v))
}

func (a *api) getAgent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	v, err := a.Agents.Get(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.Agent.Revision, toAPIAgent(v))
}

func (a *api) updateAgent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[agentBody](w, r)
	if !ok {
		return
	}
	cfg := in.Config
	if string(cfg) == "null" {
		cfg = nil
	}
	v, err := a.Agents.Update(r.Context(), a.actor(r), r.PathValue("team"), id, agents.UpdateInput{Profile: in.profile(), Config: cfg}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.Agent.Revision, toAPIAgent(v))
}

func (a *api) deleteAgent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	writeOK(w, r, a.Agents.Delete(r.Context(), a.actor(r), r.PathValue("team"), id))
}

func (a *api) publishAgent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.AgentPublish
	if r.ContentLength != 0 && !httpx.Decode(w, r, &in) {
		return
	}
	v, err := a.Agents.Publish(r.Context(), a.actor(r), r.PathValue("team"), id, deref(in.Note, ""))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPIVersion(v))
}

func (a *api) listAgentVersions(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	list, err := a.Agents.Versions(r.Context(), a.actor(r), r.PathValue("team"), id)
	writeList(w, r, list, err, toAPIVersion)
}

func (a *api) getAgentVersion(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	n, err := strconv.ParseInt(r.PathValue("version"), 10, 32)
	if err != nil || n < 1 {
		httpx.Error(w, http.StatusBadRequest, "invalid_version", "Version must be a positive number")
		return
	}
	v, err := a.Agents.GetVersion(r.Context(), a.actor(r), r.PathValue("team"), id, int32(n))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIVersion(v))
}

func (a *api) revertAgent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.AgentRevert
	if !httpx.Decode(w, r, &in) {
		return
	}
	v, err := a.Agents.Revert(r.Context(), a.actor(r), r.PathValue("team"), id, in.Version)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.Agent.Revision, toAPIAgent(v))
}

func (a *api) setAgentStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.AgentStatusChange
	if !httpx.Decode(w, r, &in) {
		return
	}
	v, err := a.Agents.SetStatus(r.Context(), a.actor(r), r.PathValue("team"), id, string(in.Status), deref(in.Reason, ""))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.Agent.Revision, toAPIAgent(v))
}

func parseDate(w http.ResponseWriter, r *http.Request, name string) (time.Time, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return time.Time{}, true
	}
	t, err := time.Parse(time.DateOnly, raw)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_"+name, name+" must be a date such as 2026-09-01")
		return time.Time{}, false
	}
	return t, true
}

func date(t time.Time) openapi_types.Date { return openapi_types.Date{Time: t} }

func (a *api) getAgentAnalytics(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	from, ok := parseDate(w, r, "from")
	if !ok {
		return
	}
	to, ok := parseDate(w, r, "to")
	if !ok {
		return
	}
	an, err := a.Agents.Analytics(r.Context(), a.actor(r), r.PathValue("team"), id, from, to)
	if failed(w, r, err) {
		return
	}
	t := an.Totals
	out := apitypes.AgentAnalytics{
		From: date(an.From), To: date(an.To),
		Totals: apitypes.AgentAnalyticsTotals{
			Conversations: t.Conversations, Answers: t.Answers, UniqueUsers: t.UniqueUsers, Up: t.Up, Down: t.Down,
			Satisfaction: t.Satisfaction, NoContextRate: t.NoContextRate, RefusalRate: t.RefusalRate, ErrorRate: t.ErrorRate,
			LatencyP50Ms: t.LatencyP50Ms, LatencyP95Ms: t.LatencyP95Ms, FirstTokenP50Ms: t.FirstTokenP50Ms,
			Moderation: moderationTotals(t.Moderation), Judging: judgingTotals(t.Judging),
			Citations: citationTotals(t.Citations), Scope: scopeTotals(t.Scope),
		},
		Daily: make([]apitypes.AgentAnalyticsDay, len(an.Daily)), Models: make([]apitypes.AgentAnalyticsModel, len(an.Models)),
		TopDocuments: make([]apitypes.AgentAnalyticsDocument, len(an.TopDocs)),
	}
	for i, d := range an.Daily {
		out.Daily[i] = apitypes.AgentAnalyticsDay{Date: date(d.Date), Conversations: d.Conversations, Answers: d.Answers}
	}
	for i, m := range an.Models {
		out.Models[i] = apitypes.AgentAnalyticsModel{ModelId: m.ModelID, ModelName: m.ModelName, Answers: m.Answers,
			InputTokens: m.Input, OutputTokens: m.Output, ReasoningTokens: m.ReasoningTokens}
	}
	for i, d := range an.TopDocs {
		out.TopDocuments[i] = apitypes.AgentAnalyticsDocument{DocumentId: d.DocumentID, Title: d.Title, Citations: d.Citations}
	}
	out.FeedbackReasons = viaJSON[[]struct {
		Count  int64                   `json:"count"`
		Reason apitypes.FeedbackReason `json:"reason"`
	}](func() []map[string]any {
		l := []map[string]any{}
		for _, r := range an.Reasons {
			l = append(l, map[string]any{"reason": r.Reason, "count": r.Count})
		}
		return l
	}())
	// The service's lists have the same fields (JSON matches names without
	// regard to case) and are never nil.
	convertJSON(&out.Channels, an.Channels)
	convertJSON(&out.Audiences, an.Audiences)
	convertJSON(&out.Moderation, an.Moderation)
	httpx.JSON(w, http.StatusOK, out)
}
