package httpapi

import (
	"context"
	"net/http"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// adminGetFeatures serves the admin Overview's Features card and setup
// checklist in one response (docs/v0.4.2.md M4, AD-03): the Overview read
// each setting from its own endpoint, about 17 requests on every load
// against a per-user rate limit. Each settings object is what its own GET
// returns, so the page primes those queries with it.
func (a *api) adminGetFeatures(w http.ResponseWriter, r *http.Request) {
	ctx, actor := r.Context(), a.actor(r)
	if !actor.CanReadPlatform() || actor.Key != nil {
		httpx.Error(w, http.StatusForbidden, "forbidden", "Platform administration requires the platform admin or auditor role")
		return
	}
	var out apitypes.AdminFeatures
	steps := []func() error{
		func() error { return a.featureSettings(ctx, actor, &out) },
		func() error { return a.featureCosts(ctx, actor, &out) },
		func() error { return a.featureModels(r, &out) },
		func() error { return a.featureSetup(ctx, actor, &out) },
	}
	for _, step := range steps {
		if failed(w, r, step()) {
			return
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

// featureSettings: the switches' settings (evaluations, MCP, saved
// answers), OCR, SSO rules, public access and maintenance.
func (a *api) featureSettings(ctx context.Context, actor authz.Actor, out *apitypes.AdminFeatures) error {
	ev, err := a.Evaluations.Settings(ctx, actor)
	if err != nil {
		return err
	}
	out.Evaluations = apitypes.EvaluationSettings{Enabled: ev.Enabled, Revision: ev.Revision, UpdatedAt: ev.UpdatedAt}
	mcp, err := a.Platform.MCPSettings(ctx, actor)
	if err != nil {
		return err
	}
	out.Mcp = toAPIMCPSettings(mcp)
	if a.AnswerCache != nil {
		st, err := a.AnswerCache.Platform(ctx, actor)
		if err != nil {
			return err
		}
		out.AnswerCache = &apitypes.AnswerCacheSettings{Enabled: st.Enabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt}
	}
	parsing, err := a.OCR.Get(ctx, actor)
	if err != nil {
		return err
	}
	out.Ocr = apitypes.AdminFeatureOCR{Enabled: parsing.Enabled, Backend: apitypes.OcrBackend(parsing.Backend)}
	sso, err := a.groups.Status(ctx, actor)
	if err != nil {
		return err
	}
	out.GroupMappingRules = int(sso.Stats.RuleCount)
	pub, err := a.Platform.Settings(ctx)
	if err != nil {
		return err
	}
	out.PublicAccess = a.withPublicAccessInfo(apitypes.PublicAccessSettings{PublicAgentsEnabled: pub.PublicAgentsEnabled, Revision: pub.Revision, UpdatedAt: pub.UpdatedAt})
	policy, err := a.Moderation.GetPolicy(ctx, actor, authz.AudiencePublic)
	if err != nil {
		return err
	}
	out.PublicModeration = policy.ModelID != nil
	maint, err := a.Platform.MaintenanceAdmin(ctx, actor)
	if err != nil {
		return err
	}
	out.Maintenance = toAPIMaintenanceSettings(maint)
	return nil
}

// featureCosts: the cost settings and the teams whose own mode differs
// from the platform's.
func (a *api) featureCosts(ctx context.Context, actor authz.Actor, out *apitypes.AdminFeatures) error {
	list, err := a.Costs.Budgets(ctx, actor)
	if err != nil {
		return err
	}
	out.Costs = apitypes.AdminFeatureCosts{Settings: toAPICostSettings(list.Settings), Teams: []apitypes.AdminFeatureTeamMode{}}
	for _, it := range list.Items {
		mode := budgetState(it.Status).Mode
		if string(mode) != list.Settings.Mode {
			out.Costs.Teams = append(out.Costs.Teams, apitypes.AdminFeatureTeamMode{Mode: mode, TeamName: it.TeamName})
		}
	}
	return nil
}

// featureModels: SystemOne and reranking, with the rerank model's name.
func (a *api) featureModels(r *http.Request, out *apitypes.AdminFeatures) error {
	ctx, actor := r.Context(), a.actor(r)
	so, err := a.SystemOne.Get(ctx, actor)
	if err != nil {
		return err
	}
	use, err := a.SystemOne.AgentUse(ctx, so)
	if err != nil {
		return err
	}
	out.SystemOne = toAPISystemOne(so, use)
	rr, err := a.Rerank.Get(ctx, actor)
	if err != nil {
		return err
	}
	if out.Rerank, err = a.rerankSettings(r, rr); err != nil {
		return err
	}
	if rr.ModelID == nil {
		return nil
	}
	m, err := a.q.GetModel(ctx, *rr.ModelID)
	if err != nil {
		return nil // deleted meanwhile: shown as off
	}
	conn, err := a.q.GetConnection(ctx, m.ConnectionID)
	out.RerankModel = &apitypes.AdminFeatureModel{DisplayName: m.DisplayName, Enabled: m.Enabled && err == nil && conn.Enabled}
	return nil
}

// featureSetup: what "Set up this install" checks.
func (a *api) featureSetup(ctx context.Context, actor authz.Actor, out *apitypes.AdminFeatures) error {
	conns, err := a.Catalog.ListConnections(ctx, actor)
	if err != nil {
		return err
	}
	chat := catalog.KindChat
	models, err := a.Catalog.ListModels(ctx, actor, catalog.ModelFilter{Kind: &chat})
	if err != nil {
		return err
	}
	profiles, err := a.Catalog.ListProfiles(ctx, actor)
	if err != nil {
		return err
	}
	counts, err := a.q.AdminOverviewCounts(ctx)
	if err != nil {
		return err
	}
	setup := apitypes.AdminSetupState{Connections: len(conns), ChatModelClassifications: []string{}, Teams: int(counts.ActiveTeams + counts.ArchivedTeams)}
	for _, m := range models {
		if m.Enabled {
			setup.ChatModelClassifications = append(setup.ChatModelClassifications, m.MaxClassification)
		}
	}
	for _, p := range profiles {
		setup.DefaultProfile = setup.DefaultProfile || (p.IsDefault && p.Status == catalog.ProfileActive)
	}
	out.Setup = setup
	return nil
}
