package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/web"
)

// ownerFunc picks whose sources a route manages: the team in the path, or
// the platform (shared sources, under /v1/admin/shared-sources).
type ownerFunc func(*http.Request) sources.Owner

func teamOwner(r *http.Request) sources.Owner { return sources.Team(r.PathValue("team")) }

func platformOwner(*http.Request) sources.Owner { return sources.Platform }

func toAPIProfileOption(p catalog.Profile) apitypes.EmbeddingProfileOption {
	return apitypes.EmbeddingProfileOption{
		Id: p.ID, Key: p.Key, Name: p.Name, Description: p.Description, Dimensions: p.Dimensions,
		ChunkSize: p.ChunkSize, MaxClassification: p.Model.MaxClassification, IsDefault: p.IsDefault,
	}
}

func toAPICounts(st sources.Stats) apitypes.DocumentCounts {
	by := st.ByStatus
	c := apitypes.DocumentCounts{
		Pending: by["pending"] + by["queued"], Processing: by["processing"], Ready: by["ready"],
		Failed: by["failed"], Skipped: by["skipped"], Bytes: st.Bytes, Chunks: st.Chunks,
	}
	c.Total = c.Pending + c.Processing + c.Ready + c.Failed + c.Skipped
	return c
}

func toAPICrawl(c dbgen.WebCrawl) apitypes.Crawl {
	out := apitypes.Crawl{
		Id: c.ID, SourceId: c.SourceID, Status: apitypes.CrawlStatus(c.Status), Trigger: apitypes.CrawlTrigger(c.Trigger),
		PagesDiscovered: c.PagesDiscovered, PagesFetched: c.PagesFetched, PagesChanged: c.PagesChanged,
		PagesUnchanged: c.PagesUnchanged, PagesSkipped: c.PagesSkipped, PagesFailed: c.PagesFailed,
		DocumentsDeleted: c.DocumentsDeleted, Truncated: c.Truncated, Error: c.Error,
		CreatedAt: c.CreatedAt, StartedAt: c.StartedAt, FinishedAt: c.FinishedAt,
	}
	// Runs cancelled before P-07 stored the status as their note.
	if strings.EqualFold(strings.TrimSpace(c.Error), c.Status) {
		out.Error = ""
	}
	if c.TruncatedReason != "" {
		reason := apitypes.CrawlTruncatedReason(c.TruncatedReason)
		out.TruncatedReason = &reason
	} else if c.Truncated {
		reason := apitypes.MaxPages // runs from before reasons were recorded
		out.TruncatedReason = &reason
	}
	if c.WaitingReason != "" && web.Active(c) {
		reason := apitypes.CrawlWaitingReason(c.WaitingReason)
		out.WaitingReason, out.WaitingUntil = &reason, c.WaitingUntil
	}
	return out
}

func toAPIWebConfig(raw json.RawMessage) *apitypes.WebConfig {
	c, err := web.Stored(raw)
	if err != nil {
		return nil
	}
	return &apitypes.WebConfig{
		Mode: apitypes.WebMode(c.Mode), Urls: nonNilStrings(c.URLs), MaxDepth: c.MaxDepth, MaxPages: c.MaxPages,
		IncludePrefixes: nonNilStrings(c.IncludePrefixes), Exclude: nonNilStrings(c.Exclude),
		AllowSubdomains: c.AllowSubdomains, UseSitemaps: c.UseSitemaps, Schedule: apitypes.WebSchedule(c.Schedule),
		Tags: nonNilStrings(c.Tags),
	}
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func toAPISource(s sources.Summary) apitypes.DataSource {
	src := s.Source
	out := apitypes.DataSource{
		Id: src.ID, Name: src.Name, Description: src.Description, Type: apitypes.DataSourceType(src.Type),
		Classification: src.Classification, EmbeddingProfileId: src.EmbeddingProfileID,
		Status: apitypes.DataSourceStatus(src.Status), Documents: toAPICounts(s.Stats), Revision: src.Revision,
		CreatedAt: src.CreatedAt, UpdatedAt: src.UpdatedAt, LastSyncAt: src.LastSyncAt, NextSyncAt: src.NextSyncAt,
	}
	if src.Type == sources.TypeWeb {
		out.Web = toAPIWebConfig(src.Config)
	}
	if s.ActiveCrawl != nil {
		c := toAPICrawl(*s.ActiveCrawl)
		out.ActiveCrawl = &c
	}
	out.Boilerplate = toAPIBoilerplate(s.Boilerplate)
	return out
}

func toAPIBoilerplate(b sources.BoilerplateSummary) apitypes.SourceBoilerplate {
	return apitypes.SourceBoilerplate{
		Enabled: b.Effective.Enabled, MinDocs: b.Effective.MinDocs, Ratio: b.Effective.Ratio,
		Overrides:      apitypes.BoilerplateSettings{Enabled: b.Settings.Enabled, MinDocs: b.Settings.MinDocs, Ratio: b.Settings.Ratio},
		RepeatedBlocks: b.Blocks, PagesAffected: b.Pages, DocumentsCounted: b.Documents, Threshold: b.Threshold,
		RefreshedAt: b.RefreshedAt, Pending: b.Pending,
	}
}

// boilerplateInput converts the API's overrides (nil: unchanged).
func boilerplateInput(in *apitypes.BoilerplateSettings) *boilerplate.Settings {
	if in == nil {
		return nil
	}
	return &boilerplate.Settings{Enabled: in.Enabled, MinDocs: in.MinDocs, Ratio: in.Ratio}
}

func toAPIImpact(classification string, rows []sources.Impact, agents []sources.AgentImpact) apitypes.ClassificationImpact {
	out := apitypes.ClassificationImpact{
		Classification: classification,
		Affected:       make([]apitypes.ImpactedKnowledgeBase, len(rows)),
		Agents:         make([]apitypes.ImpactedAgent, len(agents)),
	}
	for i, r := range rows {
		out.Affected[i] = apitypes.ImpactedKnowledgeBase{
			TeamId: r.TeamID, TeamSlug: r.TeamSlug, TeamName: r.TeamName, TeamMaxClassification: r.TeamMaxClassification,
			KnowledgeBaseId: r.KBID, KnowledgeBaseName: r.KbName,
		}
	}
	for i, g := range agents {
		var reasons []apitypes.ImpactedAgentReasons
		if g.ModelBlocks {
			reasons = append(reasons, apitypes.ImpactedAgentReasonsModel)
		}
		if g.AudienceBlocks {
			reasons = append(reasons, apitypes.ImpactedAgentReasonsAudience)
		}
		out.Agents[i] = apitypes.ImpactedAgent{
			AgentId: g.AgentID, AgentName: g.AgentName, TeamId: g.TeamID, TeamSlug: g.TeamSlug, TeamName: g.TeamName,
			ModelName: g.ModelName, ModelMaxClassification: g.ModelMaxClassification, Audience: g.Audience, Reasons: reasons,
			ReasonText: sources.AgentReasonText(g),
		}
	}
	return out
}

// fail renders errors that carry structured details, then anything else.
func (a *api) fail(w http.ResponseWriter, r *http.Request, err error) {
	var busy *web.InProgressError
	var impact *sources.ImpactError
	switch {
	case errors.As(err, &busy):
		e, _ := apperr.As(err)
		httpx.ErrorDetails(w, e.Status, e.Code, e.Message, map[string]any{"crawl": toAPICrawl(busy.Crawl)})
	case errors.As(err, &impact):
		e, _ := apperr.As(err)
		httpx.ErrorDetails(w, e.Status, e.Code, e.Message, toAPIImpact(impact.Classification, impact.Affected, impact.Agents))
	default:
		httpx.Fail(w, r, err)
	}
}

func (a *api) listUsableChatModels(w http.ResponseWriter, r *http.Request) {
	models, err := a.Catalog.ListUsableChatModels(r.Context())
	if failed(w, r, err) {
		return
	}
	out := make([]apitypes.ChatModelOption, len(models))
	for i, m := range models {
		c := catalog.DecodeCompat(m.Compat)
		out[i] = apitypes.ChatModelOption{
			Id: m.ID, Key: m.Key, DisplayName: m.DisplayName, Description: m.Description,
			MaxClassification: m.MaxClassification, ContextWindow: m.ContextWindow, MaxOutputTokens: m.MaxOutputTokens,
			SupportsTools: m.SupportsTools, SupportsReasoningEffort: c.SupportsReasoningEffort != nil && *c.SupportsReasoningEffort,
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) listUsableProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := a.Catalog.ListUsableProfiles(r.Context())
	writeList(w, r, profiles, err, toAPIProfileOption)
}

func (a *api) listSources(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := a.Sources.List(r.Context(), a.actor(r), owner(r))
		writeList(w, r, list, err, toAPISource)
	}
}

// listSharedSources is the catalog of platform-shared sources for teams.
func (a *api) listSharedSources(w http.ResponseWriter, r *http.Request) {
	list, err := a.Sources.ListShared(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := make([]apitypes.SharedSource, len(list))
	for i, s := range list {
		src := s.Source
		out[i] = apitypes.SharedSource{
			Id: src.ID, Name: src.Name, Description: src.Description, Type: apitypes.SharedSourceType(src.Type),
			Classification: src.Classification, EmbeddingProfileId: src.EmbeddingProfileID,
			Status: apitypes.SharedSourceStatus(src.Status), Documents: toAPICounts(s.Stats),
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

// webInput re-encodes the typed web configuration for the service, which
// validates it (and fills defaults) itself.
func webInput(in *apitypes.WebConfigInput) json.RawMessage {
	if in == nil {
		return nil
	}
	b, _ := json.Marshal(in)
	return b
}

func (a *api) createSource(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in apitypes.DataSourceCreate
		if !httpx.Decode(w, r, &in) {
			return
		}
		s, err := a.Sources.Create(r.Context(), a.actor(r), owner(r), sources.CreateInput{
			Name: in.Name, Description: deref(in.Description, ""), Type: string(deref(in.Type, "upload")),
			Classification: in.Classification, ProfileID: in.EmbeddingProfileId, Web: webInput(in.Web),
			Boilerplate: boilerplateInput(in.Boilerplate),
		})
		if err != nil {
			a.fail(w, r, err)
			return
		}
		setETag(w, s.Source.Revision)
		httpx.JSON(w, http.StatusCreated, toAPISource(s))
	}
}

func (a *api) getSource(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		s, err := a.Sources.Get(r.Context(), a.actor(r), owner(r), id)
		if failed(w, r, err) {
			return
		}
		writeRevised(w, http.StatusOK, s.Source.Revision, toAPISource(s))
	}
}

func (a *api) updateSource(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		in, rev, ok := decodeRevised[apitypes.DataSourceUpdate](w, r)
		if !ok {
			return
		}
		o := owner(r)
		if o == sources.Platform && r.URL.Query().Get("preview") == "true" {
			// Impact preview of a classification change: nothing changes.
			if in.Classification == nil {
				httpx.Error(w, http.StatusBadRequest, "classification_required", "Send the classification to preview")
				return
			}
			rows, agents, err := a.Sources.ClassificationImpact(r.Context(), a.actor(r), id, *in.Classification)
			if err != nil {
				httpx.Fail(w, r, err)
				return
			}
			httpx.JSON(w, http.StatusOK, toAPIImpact(*in.Classification, rows, agents))
			return
		}
		s, err := a.Sources.Update(r.Context(), a.actor(r), o, id, sources.UpdateInput{
			Name: in.Name, Description: in.Description, Classification: in.Classification,
			Status: (*string)(in.Status), Reason: in.Reason, Web: webInput(in.Web),
			Boilerplate: boilerplateInput(in.Boilerplate),
		}, rev)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		setETag(w, s.Source.Revision)
		httpx.JSON(w, http.StatusOK, toAPISource(s))
	}
}

func (a *api) deleteSource(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		writeOK(w, r, a.Sources.Delete(r.Context(), a.actor(r), owner(r), id))
	}
}

// listBoilerplate lists a source's most repeated blocks (ADR-0021).
func (a *api) listBoilerplate(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		limit := int32(20)
		if v := r.URL.Query().Get("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 50 {
				httpx.Error(w, http.StatusBadRequest, "invalid_limit", "limit must be 1-50")
				return
			}
			limit = int32(n)
		}
		list, err := a.Sources.TopBoilerplate(r.Context(), a.actor(r), owner(r), id, limit)
		writeList(w, r, list, err, func(b sources.BoilerplateBlock) apitypes.BoilerplateBlock {
			return apitypes.BoilerplateBlock{Text: b.Text, Documents: b.Documents}
		})
	}
}

// Crawls of web sources.

func (a *api) syncSource(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		c, err := a.Sources.Sync(r.Context(), a.actor(r), owner(r), id)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		httpx.JSON(w, http.StatusAccepted, toAPICrawl(c))
	}
}

func (a *api) listCrawls(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		limit, ok := pageLimit(w, r)
		if !ok {
			return
		}
		list, err := a.Sources.Crawls(r.Context(), a.actor(r), owner(r), id, limit)
		writeList(w, r, list, err, toAPICrawl)
	}
}

func (a *api) cancelCrawl(owner ownerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "sourceId")
		if !ok {
			return
		}
		crawlID, ok := pathUUID(w, r, "crawlId")
		if !ok {
			return
		}
		c, err := a.Sources.CancelCrawl(r.Context(), a.actor(r), owner(r), id, crawlID)
		if failed(w, r, err) {
			return
		}
		httpx.JSON(w, http.StatusOK, toAPICrawl(c))
	}
}

// limitDetails converts limit_reached details for an upload result.
func limitDetails(v any) *apitypes.LimitErrorDetails {
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	key, _ := m["limit"].(string)
	max, _ := m["max"].(int64)
	cur, _ := m["current"].(int64)
	return &apitypes.LimitErrorDetails{Limit: apitypes.LimitKey(key), Max: max, Current: cur}
}
