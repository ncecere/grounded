package app

import "github.com/ncecere/grounded/internal/httpapi"

// withHTTPServices adds domain services to the transport's existing infrastructure.
// Keeping this mapping separate lets Run own lifecycle rather than field wiring.
func (s *Services) withHTTPServices(d httpapi.Deps) httpapi.Deps {
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
	return d
}
