package agents

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Agent templates (v0.6.0, C4; docs/specs/v0.6.0/DESIGN.md "Agent templates"): a starting point for a new agent. Five are built in
// (templates_builtin.go); a platform admin can save an agent as another, shared with every team.
//
// A template is how an agent answers, never what it answers from or who may use it (TemplateConfig). Saving one reads a team's agent
// configuration, which platform admins have no default access to (ADR-0011), so it needs ordinary access to that agent: being an
// editor, admin or owner of its team. An admin who is not on the team gets the same 404 as for any other team content.

// Template is a starting point for an agent. ID is a slug for a built-in template and a UUID for a saved one.
type Template struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Description      string     `json:"description"`
	BuiltIn          bool       `json:"builtIn"`
	AccentColor      string     `json:"accentColor"`
	WelcomeMessage   string     `json:"welcomeMessage"`
	StarterQuestions []string   `json:"starterQuestions"`
	Config           Config     `json:"config"`
	CreatedAt        *time.Time `json:"createdAt,omitempty"`
}

// TemplateInput is the name and description of a template (a saved one can change both).
type TemplateInput struct{ Name, Description *string }

var (
	errNoTemplate      = apperr.NotFound("template_not_found", "Template not found")
	errTemplateBuiltIn = apperr.Conflict("template_builtin", "The built-in templates can't be changed")
	errTemplateName    = apperr.Conflict("template_name_taken", "A template with that name already exists")
)

// TemplateConfig is the part of an agent's configuration that a template carries: the instructions, the model, how it answers, its safety
// checks and its advanced settings. It is built from the defaults and copies the fields listed here, so a field added to Config later is
// left out until someone decides it belongs (TestTemplateConfigClassifiesEveryField fails until then).
//
// Left out on purpose: the knowledge bases and their filters (what it answers from), the tools (which are credentials of an MCP server)
// the audience (a template must never make an agent public or open to everyone) and whether routers may reach it.
func TemplateConfig(c Config) Config {
	t := DefaultConfig()
	t.Instructions = c.Instructions
	t.ChatModelID = c.ChatModelID
	t.Temperature, t.MaxOutputTokens, t.ReasoningEffort = c.Temperature, c.MaxOutputTokens, c.ReasoningEffort
	t.RetrievalMode, t.MaxTurns, t.ContextTokenBudget, t.MinSimilarity = c.RetrievalMode, c.MaxTurns, c.ContextTokenBudget, c.MinSimilarity
	t.StrictlyGrounded, t.RefusalMessage, t.CitationMode, t.QueryRewrite = c.StrictlyGrounded, c.RefusalMessage, c.CitationMode, c.QueryRewrite
	t.Moderation, t.SystemOne = c.Moderation, c.SystemOne
	t.Rerank, t.RerankTopN, t.FollowUpSuggestions = c.Rerank, c.RerankTopN, c.FollowUpSuggestions
	t.Router = c.Router // a router is how an agent answers; being reachable through routers is who may reach it (left out, like the audience)
	return t
}

func templateOf(row dbgen.AgentTemplate) Template {
	created := row.CreatedAt
	return Template{ID: row.ID.String(), Name: row.Name, Description: row.Description, AccentColor: row.AccentColor,
		WelcomeMessage: row.WelcomeMessage, StarterQuestions: row.StarterQuestions, Config: DecodeConfig(row.Config), CreatedAt: &created}
}

// ListTemplates returns the built-in templates and the saved ones, for people who can make an agent (an editor, admin or owner of a team)
// and for platform admins and auditors. Anyone else, and API keys, are refused: a saved template's instructions are not for everyone.
func (s *Service) ListTemplates(ctx context.Context, a authz.Actor) ([]Template, error) {
	if a.Delegated() {
		return nil, apperr.Forbidden("Templates are for people signing in")
	}
	if !a.CanReadPlatform() {
		ok, err := s.q.UserCanCreateAgents(ctx, a.UserID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, apperr.Forbidden("Only team editors, admins and owners can use agent templates")
		}
	}
	rows, err := s.q.ListAgentTemplates(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Template, 0, len(builtInTemplates)+len(rows))
	out = append(out, builtInTemplates...)
	for _, row := range rows {
		out = append(out, templateOf(row))
	}
	return out, nil
}

// findTemplate resolves a template by ID: a built-in slug or a saved template's UUID.
func (s *Service) findTemplate(ctx context.Context, id string) (Template, error) {
	for _, t := range builtInTemplates {
		if t.ID == id {
			return t, nil
		}
	}
	uid, err := uuid.Parse(id)
	if err != nil {
		return Template{}, errNoTemplate
	}
	row, err := s.q.GetAgentTemplate(ctx, uid)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Template{}, errNoTemplate
	} else if err != nil {
		return Template{}, err
	}
	return templateOf(row), nil
}

// overlayConfig is the configuration of an agent made from a template: the template's, with every key the request names replacing it
// (the knowledge bases and the model the person chose). The request's own JSON is checked by ParseConfig afterwards, so an unreadable one
// is handed on as it is and reported there.
func overlayConfig(base Config, over json.RawMessage) json.RawMessage {
	trimmed := strings.TrimSpace(string(over))
	if trimmed == "" || trimmed == "null" {
		return base.JSON()
	}
	var merged, top map[string]json.RawMessage
	if json.Unmarshal(base.JSON(), &merged) != nil || json.Unmarshal(over, &top) != nil {
		return over
	}
	for k, v := range top {
		merged[k] = v
	}
	out, err := json.Marshal(merged)
	if err != nil {
		return over
	}
	return out
}

func requireTemplateAdmin(a authz.Actor) error {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return apperr.Forbidden("Only platform admins can manage agent templates")
	}
	return nil
}

// isTemplateNameTaken reports a unique violation on a template's name: the index of migration 00054 (lower() of the name under the ICU root
// collation, so "qa über" and "QA ÜBER" are one name whatever the cluster's locale) or the older one on the database's own lower(), which
// stays until a later release drops it (ADR-0013).
func isTemplateNameTaken(err error) bool {
	return apperr.IsUniqueViolation(err, "agent_templates_name_fold_key") || apperr.IsUniqueViolation(err, "agent_templates_name_key")
}

func templateName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if l := len([]rune(n)); l < 1 || l > 80 {
		return "", apperr.Invalid("invalid_name", "Name must be 1-80 characters")
	}
	for _, t := range builtInTemplates {
		if strings.EqualFold(t.Name, n) {
			return "", errTemplateName
		}
	}
	return n, nil
}

func templateDescription(d string) (string, error) {
	d = strings.TrimSpace(d)
	if len([]rune(d)) > 500 {
		return "", apperr.Invalid("invalid_description", "Description must be at most 500 characters")
	}
	return d, nil
}

// SaveAsTemplate saves an agent's draft as a template shared with every team (platform admins, who are editors, admins or owners of the
// agent's team). The team's audit log records it, so the team can see its agent was copied; the template keeps no link to the agent.
func (s *Service) SaveAsTemplate(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID, in TemplateInput) (Template, error) {
	if err := requireTemplateAdmin(a); err != nil {
		return Template{}, err
	}
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return Template{}, err
	}
	ag, err := s.loadAgent(ctx, s.q, acc.Team.ID, agentID, false)
	if err != nil {
		return Template{}, err
	}
	name := ""
	if in.Name != nil {
		name = *in.Name
	}
	if name, err = templateName(name); err != nil {
		return Template{}, err
	}
	desc := ag.Description
	if in.Description != nil {
		desc = *in.Description
	}
	if desc, err = templateDescription(desc); err != nil {
		return Template{}, err
	}
	var out dbgen.AgentTemplate
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		out, err = q.InsertAgentTemplate(ctx, dbgen.InsertAgentTemplateParams{
			Name: name, Description: desc, AccentColor: ag.AccentColor, WelcomeMessage: ag.WelcomeMessage,
			StarterQuestions: ag.StarterQuestions, Config: TemplateConfig(DecodeConfig(ag.Draft)).JSON(),
			CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		})
		if isTemplateNameTaken(err) {
			return errTemplateName
		} else if err != nil {
			return err
		}
		e := a.Audit("agent_template.create", "agent_template", out.ID.String())
		e.TeamID = acc.Team.ID
		e.After = map[string]any{"name": out.Name}
		e.Metadata = map[string]any{"sourceAgentId": ag.ID.String()}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Template{}, err
	}
	return templateOf(out), nil
}

// UpdateTemplate renames a saved template or changes its description (platform admins).
func (s *Service) UpdateTemplate(ctx context.Context, a authz.Actor, id string, in TemplateInput) (Template, error) {
	if err := requireTemplateAdmin(a); err != nil {
		return Template{}, err
	}
	cur, err := s.findTemplate(ctx, id)
	if err != nil {
		return Template{}, err
	}
	if cur.BuiltIn {
		return Template{}, errTemplateBuiltIn
	}
	name, desc := cur.Name, cur.Description
	if in.Name != nil {
		if name, err = templateName(*in.Name); err != nil {
			return Template{}, err
		}
	}
	if in.Description != nil {
		if desc, err = templateDescription(*in.Description); err != nil {
			return Template{}, err
		}
	}
	var out dbgen.AgentTemplate
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		out, err = q.UpdateAgentTemplate(ctx, dbgen.UpdateAgentTemplateParams{ID: uuid.MustParse(cur.ID), Name: name, Description: desc})
		if isTemplateNameTaken(err) {
			return errTemplateName
		} else if err != nil {
			return err
		}
		e := a.Audit("agent_template.update", "agent_template", cur.ID)
		e.Before, e.After = map[string]any{"name": cur.Name, "description": cur.Description}, map[string]any{"name": out.Name, "description": out.Description}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Template{}, err
	}
	return templateOf(out), nil
}

// DeleteTemplate removes a saved template (platform admins). Agents made from it are not touched: they hold their own copy.
func (s *Service) DeleteTemplate(ctx context.Context, a authz.Actor, id string) error {
	if err := requireTemplateAdmin(a); err != nil {
		return err
	}
	cur, err := s.findTemplate(ctx, id)
	if err != nil {
		return err
	}
	if cur.BuiltIn {
		return errTemplateBuiltIn
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if _, err := q.DeleteAgentTemplate(ctx, uuid.MustParse(cur.ID)); err != nil {
			return store.NotFound(err)
		}
		e := a.Audit("agent_template.delete", "agent_template", cur.ID)
		e.Before = map[string]any{"name": cur.Name}
		return audit.Record(ctx, q, e)
	})
}
