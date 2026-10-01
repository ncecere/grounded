// Package httpapi assembles the HTTP surface: the route table, middleware,
// operational endpoints and the /v1 handlers.
//
// Every route is declared in a table (apiRoutes, grouped by area) so tests
// can verify that the served surface matches api/openapi.yaml exactly.
package httpapi

import (
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/analytics"
	"github.com/ncecere/grounded/internal/apikeys"
	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/captcha"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/healthcheck"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/mcpclient"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/oauth"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/profilemig"
	"github.com/ncecere/grounded/internal/public"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/web"
)

// Deps are the dependencies shared by handlers.
type Deps struct {
	Config   config.Config
	Pool     *pgxpool.Pool
	KV       *kv.Store
	Auth     *auth.Service
	Teams    *teams.Service
	Platform *platform.Service
	Catalog  *catalog.Service
	Sources  *sources.Service
	KBs      *kbs.Service
	APIKeys  *apikeys.Service
	// WebSources runs web sources: allowlist, domain requests, map.
	WebSources *web.Service
	// Limits reads and changes team limits.
	Limits *limits.Service
	// Costs reads and changes prices and budgets and reports spend.
	Costs *costs.Service
	// Agents manages agents and runs chats.
	Agents *agents.Service
	// Notify is the caller's inbox and notification settings.
	Notify *notify.Service
	// Moderation stores moderation policies and tests providers.
	Moderation *moderation.Service
	// SystemOne stores the platform SystemOne settings and tests SystemOne
	// models (ADR-0020).
	SystemOne *systemone.Service
	// OCR stores the parsing settings and tests OCR backends (docs/ocr.md).
	OCR *ocr.Service
	// Public serves public agents to anonymous visitors and the widget.
	Public *public.Service
	// Retention administers retention periods, runs and legal holds.
	Retention *retention.Service
	// BreakGlass runs break-glass sessions (ADR-0024).
	BreakGlass *breakglass.Service

	// Web is the built single-page app; WebBuilt is false when only the
	// placeholder is embedded.
	Web      fs.FS
	WebBuilt bool
	Metrics  *observability.Metrics
	Health   *Health
	Log      *slog.Logger

	// ProfileMigrations moves knowledge bases between embedding profiles
	// (docs/phase5-deploy.md §5 P2).
	ProfileMigrations *profilemig.Service
	// Evaluations runs evaluation sets (docs/evaluations.md).
	Evaluations *evals.Service
	// MCP registers MCP servers and approves their tools (docs/mcp-client.md).
	MCP *mcpclient.Service
	// OAuth is the authorization server for /mcp (experimental, docs/mcp.md).
	OAuth *oauth.Service
}

type api struct {
	Deps
	q *dbgen.Queries
	// analytics reads platform analytics; it needs only the pool.
	analytics *analytics.Service
	widget    *widgetAssets
	// groups administers SSO group mapping rules; it needs only the pool
	// and the OIDC settings.
	groups *ssogroups.Service
	// health stores and reads connection and model health (Test buttons).
	health *healthcheck.Service
}

// route is one entry in the served surface.
type route struct {
	Method  string
	Path    string
	Handler http.Handler
}

func (r route) pattern() string { return r.Method + " " + r.Path }

func opsRoutes(d Deps) []route {
	return []route{
		{"GET", "/healthz", http.HandlerFunc(d.Health.Live)},
		{"GET", "/readyz", http.HandlerFunc(d.Health.Ready)},
		{"GET", "/metrics", d.Metrics.Handler()},
	}
}

// publicOpsRoutes are the ops routes on the api listener: /metrics stays off
// it when the metrics have their own listener (Config.MetricsAddr), so an
// ingress in front of the api never exposes them.
func publicOpsRoutes(d Deps) []route {
	if d.Config.MetricsAddr == "" {
		return opsRoutes(d)
	}
	return opsRoutes(d)[:2]
}

// apiRoutes is the full served surface, grouped by area.
func apiRoutes(d Deps) []route {
	a := &api{Deps: d, q: dbgen.New(d.Pool), analytics: analytics.New(d.Pool), widget: &widgetAssets{},
		groups: ssogroups.New(d.Pool, d.Config.OIDC.GroupsClaim, d.Config.OIDC.Enabled()), health: healthcheck.New(d.Pool)}
	routes := publicOpsRoutes(d)
	for _, group := range [][]route{
		a.authRoutes(), a.notificationRoutes(), a.teamRoutes(), a.sourceRoutes(), a.kbRoutes(), a.agentRoutes(), a.chatRoutes(),
		a.platformAdminRoutes(), a.catalogAdminRoutes(), a.sharedSourceAdminRoutes(), a.moderationAdminRoutes(), a.systemOneRoutes(), a.analyticsRoutes(),
		a.publicRoutes(), a.publishingRoutes(), a.maintenanceRoutes(),
		a.keyRotationRoutes(), a.retentionRoutes(), a.breakGlassRoutes(),
		a.profileMigrationRoutes(), a.searchRoutes(), a.groupMappingRoutes(), a.parsingRoutes(), a.documentProblemRoutes(), a.costsRoutes(), a.evaluationRoutes(),
		a.mcpSettingsRoutes(), a.mcpClientRoutes(), a.oauthRESTRoutes(),
	} {
		routes = append(routes, group...)
	}
	return routes
}

// session requires a browser session.
func (a *api) session(h http.HandlerFunc) http.Handler { return a.Auth.RequireSession(h) }

// admin requires a session, then a platform admin or auditor. Write
// operations additionally require platform_admin inside the service.
func (a *api) admin(h http.HandlerFunc) http.Handler { return a.session(a.requirePlatformRead(h)) }

// either accepts a session or an API key; scopes are enforced by services.
func (a *api) either(h http.HandlerFunc) http.Handler { return a.sessionOrKey(h) }

// authRoutes: sign-in and the caller's own identity.
func (a *api) authRoutes() []route {
	return []route{
		{"GET", "/auth/login", http.HandlerFunc(a.Auth.Login)},
		{"GET", "/auth/callback", http.HandlerFunc(a.Auth.Callback)},
		{"POST", "/auth/dev", http.HandlerFunc(a.Auth.DevLogin)},
		{"POST", "/auth/logout", a.session(a.Auth.Logout)},
		{"GET", "/v1/auth/config", http.HandlerFunc(a.Auth.AuthConfig)},
		{"GET", "/v1/me", a.meRoute()},
		{"GET", "/v1/classifications", a.session(a.listClassifications)},
	}
}

// teamRoutes: teams, members, invites, the team audit log, limits and API keys.
func (a *api) teamRoutes() []route {
	return []route{
		{"GET", "/v1/teams", a.session(a.listMyTeams)},
		{"GET", "/v1/teams/{team}", a.session(a.getTeam)},
		{"GET", "/v1/teams/{team}/members", a.session(a.listMembers)},
		{"POST", "/v1/teams/{team}/members", a.session(a.addMember)},
		{"PATCH", "/v1/teams/{team}/members/{userId}", a.session(a.updateMember)},
		{"DELETE", "/v1/teams/{team}/members/{userId}", a.session(a.removeMember)},
		{"GET", "/v1/teams/{team}/invites", a.session(a.listInvites)},
		{"DELETE", "/v1/teams/{team}/invites/{inviteId}", a.session(a.revokeInvite)},
		{"GET", "/v1/teams/{team}/audit", a.session(a.listTeamAudit)},
		{"GET", "/v1/teams/{team}/audit/{entryId}", a.session(a.getTeamAuditEntry)},
		{"GET", "/v1/teams/{team}/limits", a.session(a.getTeamLimits)},
		{"GET", "/v1/teams/{team}/api-keys", a.session(a.listAPIKeys)},
		{"POST", "/v1/teams/{team}/api-keys", a.session(a.createAPIKey)},
		{"GET", "/v1/teams/{team}/api-keys/{keyId}", a.session(a.getAPIKey)},
		{"PATCH", "/v1/teams/{team}/api-keys/{keyId}", a.session(a.updateAPIKeyContact)},
		{"DELETE", "/v1/teams/{team}/api-keys/{keyId}", a.session(a.revokeAPIKey)},
	}
}

// sourceRoutes: a team's data sources, documents and crawls, site maps and domain requests.
func (a *api) sourceRoutes() []route {
	return []route{
		{"GET", "/v1/embedding-profiles", a.session(a.listUsableProfiles)},
		{"GET", "/v1/chat-models", a.session(a.listUsableChatModels)},
		{"GET", "/v1/teams/{team}/sources", a.either(a.listSources(teamOwner))},
		{"POST", "/v1/teams/{team}/sources", a.session(a.createSource(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}", a.either(a.getSource(teamOwner))},
		{"PATCH", "/v1/teams/{team}/sources/{sourceId}", a.session(a.updateSource(teamOwner))},
		{"DELETE", "/v1/teams/{team}/sources/{sourceId}", a.session(a.deleteSource(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/documents", a.either(a.listDocuments(teamOwner))},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/documents", a.either(a.uploadDocuments(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/documents/{documentId}", a.either(a.getDocument(teamOwner))},
		{"PATCH", "/v1/teams/{team}/sources/{sourceId}/documents/{documentId}", a.session(a.updateDocument(teamOwner))},
		{"DELETE", "/v1/teams/{team}/sources/{sourceId}/documents/{documentId}", a.session(a.deleteDocument(teamOwner))},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/documents/retry", a.session(a.retryDocuments(teamOwner))},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/retry", a.session(a.retryDocument(teamOwner))},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/refetch", a.session(a.refetchDocument(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/passages", a.either(a.listDocumentPassages(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/documents/{documentId}/text", a.either(a.getDocumentText(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/tags", a.either(a.listSourceTags(teamOwner))},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/sync", a.either(a.syncSource(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/crawls", a.either(a.listCrawls(teamOwner))},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/boilerplate", a.either(a.listBoilerplate(teamOwner))},
		{"POST", "/v1/teams/{team}/sources/{sourceId}/crawls/{crawlId}/cancel", a.either(a.cancelCrawl(teamOwner))},
		{"POST", "/v1/teams/{team}/web/map", a.either(a.mapSite)},
		{"GET", "/v1/teams/{team}/domain-requests", a.session(a.listTeamDomainRequests)},
		{"POST", "/v1/teams/{team}/domain-requests", a.session(a.createDomainRequest)},
		{"DELETE", "/v1/teams/{team}/domain-requests/{requestId}", a.session(a.withdrawDomainRequest)},
		{"GET", "/v1/shared-sources", a.session(a.listSharedSources)},
		{"PUT", "/v1/teams/{team}/kbs/{kbId}/sources/{sourceId}", a.session(a.attachSource)},
		{"DELETE", "/v1/teams/{team}/kbs/{kbId}/sources/{sourceId}", a.session(a.detachSource)},
	}
}

// kbRoutes: knowledge bases and retrieval.
func (a *api) kbRoutes() []route {
	return []route{
		{"GET", "/v1/teams/{team}/kbs", a.either(a.listKBs)},
		{"POST", "/v1/teams/{team}/kbs", a.session(a.createKB)},
		{"GET", "/v1/teams/{team}/kbs/{kbId}", a.either(a.getKB)},
		{"PATCH", "/v1/teams/{team}/kbs/{kbId}", a.session(a.updateKB)},
		{"DELETE", "/v1/teams/{team}/kbs/{kbId}", a.session(a.deleteKB)},
		{"POST", "/v1/teams/{team}/kbs/{kbId}/retrieve", a.either(a.retrieve)},
	}
}

// agentRoutes: a team's agents (editing, versions, status, test chats and analytics).
func (a *api) agentRoutes() []route {
	return []route{
		{"GET", "/v1/teams/{team}/agents", a.either(a.listAgents)},
		{"POST", "/v1/teams/{team}/agents", a.session(a.createAgent)},
		{"GET", "/v1/teams/{team}/agents/{agentId}", a.either(a.getAgent)},
		{"PATCH", "/v1/teams/{team}/agents/{agentId}", a.session(a.updateAgent)},
		{"DELETE", "/v1/teams/{team}/agents/{agentId}", a.session(a.deleteAgent)},
		{"POST", "/v1/teams/{team}/agents/{agentId}/publish", a.session(a.publishAgent)},
		{"GET", "/v1/teams/{team}/agents/{agentId}/versions", a.either(a.listAgentVersions)},
		{"GET", "/v1/teams/{team}/agents/{agentId}/versions/{version}", a.either(a.getAgentVersion)},
		{"POST", "/v1/teams/{team}/agents/{agentId}/revert", a.session(a.revertAgent)},
		{"POST", "/v1/teams/{team}/agents/{agentId}/status", a.session(a.setAgentStatus)},
		{"POST", "/v1/teams/{team}/agents/{agentId}/test", a.session(a.testAgent)},
		{"GET", "/v1/teams/{team}/agents/{agentId}/analytics", a.session(a.getAgentAnalytics)},
	}
}

// chatRoutes: the agent directory, chat, conversations and the OpenAI-compatible API.
func (a *api) chatRoutes() []route {
	return []route{
		{"GET", "/v1/agents", a.either(a.listAgentDirectory)},
		{"GET", "/v1/agents/{team}/{agent}", a.either(a.getAgentProfile)},
		{"GET", "/v1/agents/id/{agentId}", a.either(a.getAgentProfileByID)},
		{"GET", "/v1/agents/short/{shortName}", a.either(a.getAgentProfileByShortName)},
		{"POST", "/v1/agents/{team}/{agent}/chat", a.either(a.chat)},
		{"GET", "/v1/conversations", a.either(a.listConversations)},
		{"GET", "/v1/conversations/{conversationId}", a.either(a.getConversation)},
		{"PATCH", "/v1/conversations/{conversationId}", a.either(a.renameConversation)},
		{"DELETE", "/v1/conversations/{conversationId}", a.either(a.deleteConversation)},
		{"GET", "/v1/conversations/{conversationId}/export", a.either(a.exportConversation)},
		{"GET", "/v1/messages/{messageId}/sources/{n}", a.either(a.getCitedPassage)},
		{"POST", "/v1/messages/{messageId}/feedback", a.either(a.setMessageFeedback)},
		{"GET", "/v1/models", a.openaiAuth(a.openaiListModels)},
		{"POST", "/v1/chat/completions", a.openaiAuth(a.openaiChatCompletions)},
	}
}

// platformAdminRoutes: users, teams, limits, classifications, audit, agents and the access log across the platform.
func (a *api) platformAdminRoutes() []route {
	return []route{
		{"GET", "/v1/admin/users", a.admin(a.adminListUsers)},
		{"GET", "/v1/admin/users/{userId}", a.admin(a.adminGetUser)},
		{"PATCH", "/v1/admin/users/{userId}", a.admin(a.adminUpdateUser)},
		{"GET", "/v1/admin/teams", a.admin(a.adminListTeams)},
		{"POST", "/v1/admin/teams", a.admin(a.adminCreateTeam)},
		{"GET", "/v1/admin/teams/{team}", a.admin(a.adminGetTeam)},
		{"PATCH", "/v1/admin/teams/{team}", a.admin(a.adminUpdateTeam)},
		{"POST", "/v1/admin/teams/{team}/owners", a.admin(a.adminAssignOwner)},
		{"GET", "/v1/admin/teams/{team}/limits", a.admin(a.adminGetTeamLimits)},
		{"PUT", "/v1/admin/teams/{team}/limits", a.admin(a.adminUpdateTeamLimits)},
		{"GET", "/v1/admin/limits", a.admin(a.adminGetLimits)},
		{"PUT", "/v1/admin/limits", a.admin(a.adminUpdateLimits)},
		{"POST", "/v1/admin/classifications", a.admin(a.adminCreateClassification)},
		{"PATCH", "/v1/admin/classifications/{key}", a.admin(a.adminUpdateClassification)},
		{"GET", "/v1/admin/audit", a.admin(a.adminListAudit)},
		{"GET", "/v1/admin/audit/{entryId}", a.admin(a.adminGetAuditEntry)},
		{"GET", "/v1/admin/agents", a.admin(a.adminListAgents)},
		{"POST", "/v1/admin/agents/{agentId}/status", a.admin(a.adminSetAgentStatus)},
		{"GET", "/v1/admin/access-log", a.admin(a.adminListAccessLog)},
	}
}

// catalogAdminRoutes: gateway connections, models and embedding profiles.
func (a *api) catalogAdminRoutes() []route {
	return []route{
		{"GET", "/v1/admin/connections", a.admin(a.adminListConnections)},
		{"POST", "/v1/admin/connections", a.admin(a.adminCreateConnection)},
		{"GET", "/v1/admin/connections/{connectionId}", a.admin(a.adminGetConnection)},
		{"PATCH", "/v1/admin/connections/{connectionId}", a.admin(a.adminUpdateConnection)},
		{"DELETE", "/v1/admin/connections/{connectionId}", a.admin(a.adminDeleteConnection)},
		{"POST", "/v1/admin/connections/{connectionId}/test", a.admin(a.adminTestConnection)},
		{"GET", "/v1/admin/models", a.admin(a.adminListModels)},
		{"POST", "/v1/admin/models", a.admin(a.adminCreateModel)},
		{"GET", "/v1/admin/models/{modelId}", a.admin(a.adminGetModel)},
		{"PATCH", "/v1/admin/models/{modelId}", a.admin(a.adminUpdateModel)},
		{"DELETE", "/v1/admin/models/{modelId}", a.admin(a.adminDeleteModel)},
		{"POST", "/v1/admin/models/{modelId}/test", a.admin(a.adminTestModel)},
		{"GET", "/v1/admin/catalog-usage", a.admin(a.adminGetCatalogUsage)},
		{"GET", "/v1/admin/health-checks", a.admin(a.adminListHealthChecks)},
		{"GET", "/v1/admin/embedding-profiles", a.admin(a.adminListEmbeddingProfiles)},
		{"POST", "/v1/admin/embedding-profiles", a.admin(a.adminCreateEmbeddingProfile)},
		{"GET", "/v1/admin/embedding-profiles/{profileId}", a.admin(a.adminGetEmbeddingProfile)},
		{"PATCH", "/v1/admin/embedding-profiles/{profileId}", a.admin(a.adminUpdateEmbeddingProfile)},
		{"DELETE", "/v1/admin/embedding-profiles/{profileId}", a.admin(a.adminDeleteEmbeddingProfile)},
	}
}

// sharedSourceAdminRoutes: the crawl allowlist, domain requests and platform-shared sources.
func (a *api) sharedSourceAdminRoutes() []route {
	return []route{
		{"GET", "/v1/admin/crawl-allowlist", a.admin(a.adminListAllowlist)},
		{"POST", "/v1/admin/crawl-allowlist", a.admin(a.adminAddAllowlist)},
		{"DELETE", "/v1/admin/crawl-allowlist/{entryId}", a.admin(a.adminRemoveAllowlist)},
		{"GET", "/v1/admin/domain-requests", a.admin(a.adminListDomainRequests)},
		{"GET", "/v1/admin/attention", a.admin(a.adminGetAttention)},
		{"GET", "/v1/admin/overview", a.admin(a.adminGetOverview)},
		{"POST", "/v1/admin/domain-requests/{requestId}/review", a.admin(a.adminReviewDomainRequest)},
		// Platform-shared sources: the team source handlers with the platform
		// as owner (admins change them; auditors read).
		{"GET", "/v1/admin/shared-sources", a.admin(a.listSources(platformOwner))},
		{"GET", "/v1/admin/shared-source-usage", a.admin(a.adminListSharedSourceUsage)},
		{"POST", "/v1/admin/shared-sources", a.admin(a.createSource(platformOwner))},
		{"GET", "/v1/admin/shared-sources/{sourceId}", a.admin(a.getSource(platformOwner))},
		{"PATCH", "/v1/admin/shared-sources/{sourceId}", a.admin(a.updateSource(platformOwner))},
		{"DELETE", "/v1/admin/shared-sources/{sourceId}", a.admin(a.deleteSource(platformOwner))},
		{"GET", "/v1/admin/shared-sources/{sourceId}/documents", a.admin(a.listDocuments(platformOwner))},
		{"POST", "/v1/admin/shared-sources/{sourceId}/documents", a.admin(a.uploadDocuments(platformOwner))},
		{"GET", "/v1/admin/shared-sources/{sourceId}/documents/{documentId}", a.admin(a.getDocument(platformOwner))},
		{"PATCH", "/v1/admin/shared-sources/{sourceId}/documents/{documentId}", a.admin(a.updateDocument(platformOwner))},
		{"DELETE", "/v1/admin/shared-sources/{sourceId}/documents/{documentId}", a.admin(a.deleteDocument(platformOwner))},
		{"POST", "/v1/admin/shared-sources/{sourceId}/documents/retry", a.admin(a.retryDocuments(platformOwner))},
		{"POST", "/v1/admin/shared-sources/{sourceId}/documents/{documentId}/retry", a.admin(a.retryDocument(platformOwner))},
		{"POST", "/v1/admin/shared-sources/{sourceId}/documents/{documentId}/refetch", a.admin(a.refetchDocument(platformOwner))},
		{"GET", "/v1/admin/shared-sources/{sourceId}/documents/{documentId}/passages", a.admin(a.listDocumentPassages(platformOwner))},
		{"GET", "/v1/admin/shared-sources/{sourceId}/tags", a.admin(a.listSourceTags(platformOwner))},
		{"POST", "/v1/admin/shared-sources/{sourceId}/sync", a.admin(a.syncSource(platformOwner))},
		{"GET", "/v1/admin/shared-sources/{sourceId}/crawls", a.admin(a.listCrawls(platformOwner))},
		{"GET", "/v1/admin/shared-sources/{sourceId}/boilerplate", a.admin(a.listBoilerplate(platformOwner))},
		{"POST", "/v1/admin/shared-sources/{sourceId}/crawls/{crawlId}/cancel", a.admin(a.cancelCrawl(platformOwner))},
	}
}

func build(d Deps, routes []route, fallback http.Handler) http.Handler {
	mux := http.NewServeMux()
	for _, rt := range routes {
		mux.Handle(rt.pattern(), rt.Handler)
	}
	mux.Handle("/", fallback)
	return chain(mux, d)
}

var notFound = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	httpx.Error(w, http.StatusNotFound, "not_found", "Not found")
})

// spaOptions personalise the app's index.html and its CSP.
func (d Deps) spaOptions() spaOptions {
	in := d.Config.Instance
	o := spaOptions{Title: in.Name, Theme: in.Theme, LogoOrigin: in.LogoOrigin()}
	if d.Config.Public.CaptchaProvider == config.CaptchaTurnstile {
		o.CaptchaOrigin = captcha.TurnstileScriptOrigin
	}
	return o
}

// NewAPIHandler serves the full application surface and the web app (api and
// serve modes).
func NewAPIHandler(d Deps) http.Handler {
	var fallback http.Handler = notFound
	if d.Web != nil {
		fallback = spaHandler(d.Web, d.WebBuilt, d.spaOptions())
	}
	return build(d, append(append(apiRoutes(d), mcpRoutes(d)...), oauthRoutes(d)...), fallback)
}

// NewOpsHandler serves only health and metrics (worker mode).
func NewOpsHandler(d Deps) http.Handler { return build(d, opsRoutes(d), notFound) }
