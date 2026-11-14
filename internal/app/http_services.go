package app

import "github.com/ncecere/grounded/internal/httpapi"

// HTTPDeps adds the domain services to the transport's infrastructure (the
// config, pool, KV, metrics, health and log in d). It is the one mapping from
// Services to httpapi.Deps: Run and the API test harness both use it, so a
// new service is wired once (#253). The transport builds no service itself.
func (s *Services) HTTPDeps(d httpapi.Deps) httpapi.Deps {
	d.AuditExports = s.AuditExports
	d.AuditStream = s.AuditStream
	d.DocumentAccess = s.DocumentAccess
	d.Teams, d.Platform, d.Catalog = s.Teams, s.Platform, s.Catalog
	d.Sources, d.WebSources, d.KBs = s.Sources, s.Web, s.KBs
	d.APIKeys, d.Limits, d.Costs = s.APIKeys, s.Limits, s.Costs
	d.Agents, d.Notify, d.Moderation = s.Agents, s.Notify, s.Moderation
	d.SystemOne, d.OCR, d.Public, d.Rerank, d.PII, d.SCIM = s.SystemOne, s.OCR, s.Public, s.Rerank, s.PII, s.SCIM
	d.Retention, d.BreakGlass = s.Retention, s.BreakGlass
	d.ProfileMigrations, d.Evaluations, d.MCP, d.OAuth = s.ProfileMigrations, s.Evaluations, s.MCP, s.OAuth
	d.Contextual = s.Contextual
	d.TeamRequests, d.Webhooks, d.TeamConfig = s.TeamRequests, s.Webhooks, s.TeamConfig
	d.Gaps, d.ContentHealth, d.AnswerCache = s.Gaps, s.ContentHealth, s.AnswerCache
	d.Analytics, d.Groups, d.HealthChecks = s.Analytics, s.Groups, s.HealthChecks
	return d
}
