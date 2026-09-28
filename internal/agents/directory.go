// The agent directory and resolving a published agent the actor may chat
// with (docs/phase4-publishing.md §3).

package agents

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Card is an agent's public profile.
type Card struct {
	Agent    dbgen.Agent
	TeamSlug string
	TeamName string
	// CitationMode of the published version.
	CitationMode string
	// Audience of the published version (its grant).
	Audience string
	// Group is where the directory lists it for the caller: team,
	// organisation or public.
	Group     string
	ShortName *string
}

// DirectoryFilter narrows the directory.
type DirectoryFilter struct {
	// Search matches the agent's name or description, or the team's name.
	Search string
	// Team is a team slug or ID.
	Team string
}

// Directory lists the agents the actor may chat with: published, active
// agents of the actor's teams, every all_authenticated agent, and every
// public agent while the public switch is on. An API key sees its team's
// agents within its KBs.
func (s *Service) Directory(ctx context.Context, a authz.Actor, f DirectoryFilter) ([]Card, error) {
	if a.Key != nil {
		return s.keyDirectory(ctx, a, f)
	}
	on, err := s.publicEnabled(ctx)
	if err != nil {
		return nil, err
	}
	p := dbgen.DirectoryAgentsParams{UserID: a.UserID, PublicEnabled: on}
	if q := strings.TrimSpace(f.Search); q != "" {
		esc := store.EscapeLike(q)
		p.Search = &esc
	}
	if t := strings.ToLower(strings.TrimSpace(f.Team)); t != "" {
		p.Team = &t
	}
	rows, err := s.q.DirectoryAgents(ctx, p)
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(rows))
	for _, r := range rows {
		c := Card{Agent: agentFromDirectoryRow(r), TeamSlug: r.TeamSlug, TeamName: r.TeamName, CitationMode: CitationSnippetLink,
			Audience: r.Audience, Group: r.GroupKey, ShortName: r.ShortName}
		if v, err := s.q.GetAgentVersion(ctx, r.PublishedVersionID.UUID); err == nil {
			c.CitationMode = DecodeConfig(v.Config).CitationMode
		}
		out = append(out, c)
	}
	return out, nil
}

// keyDirectory is an API key's directory: its team's agents within its KBs.
func (s *Service) keyDirectory(ctx context.Context, a authz.Actor, f DirectoryFilter) ([]Card, error) {
	if !a.Key.HasScope(authz.ScopeQuery) {
		return []Card{}, nil
	}
	rows, err := s.q.DirectoryForTeam(ctx, a.Key.TeamID)
	if err != nil {
		return nil, err
	}
	search := strings.ToLower(strings.TrimSpace(f.Search))
	out := make([]Card, 0, len(rows))
	for _, r := range rows {
		if search != "" && !strings.Contains(strings.ToLower(r.Name+" "+r.Description+" "+r.TeamName), search) {
			continue
		}
		if t := strings.ToLower(strings.TrimSpace(f.Team)); t != "" && t != r.TeamSlug && t != r.TeamID.String() {
			continue
		}
		if keyHides(a, r.ID) {
			continue
		}
		c := Card{Agent: agentFromRow(dbgen.DirectoryForUserRow(r)), TeamSlug: r.TeamSlug, TeamName: r.TeamName,
			CitationMode: CitationSnippetLink, Audience: authz.AudienceTeam, Group: GroupTeam}
		if g, err := s.q.GetAudienceGrant(ctx, r.ID); err == nil {
			c.Audience = g.PrincipalType
		}
		if v, err := s.q.GetAgentVersion(ctx, r.PublishedVersionID.UUID); err == nil {
			cfg := DecodeConfig(v.Config)
			c.CitationMode = cfg.CitationMode
			if !keyAllowsKBs(a.Key, cfg.KBIDs()) {
				continue
			}
		}
		out = append(out, c)
	}
	return out, nil
}

func agentFromRow(r dbgen.DirectoryForUserRow) dbgen.Agent {
	return dbgen.Agent{
		ID: r.ID, TeamID: r.TeamID, Slug: r.Slug, Name: r.Name, Description: r.Description, AccentColor: r.AccentColor,
		WelcomeMessage: r.WelcomeMessage, StarterQuestions: r.StarterQuestions, Status: r.Status, DisabledReason: r.DisabledReason,
		DisabledBy: r.DisabledBy, DisabledAt: r.DisabledAt, Draft: r.Draft, DraftRevision: r.DraftRevision,
		PublishedVersionID: r.PublishedVersionID, Revision: r.Revision, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt, DeletedAt: r.DeletedAt,
	}
}

func agentFromDirectoryRow(r dbgen.DirectoryAgentsRow) dbgen.Agent {
	return dbgen.Agent{
		ID: r.ID, TeamID: r.TeamID, Slug: r.Slug, Name: r.Name, Description: r.Description, AccentColor: r.AccentColor,
		WelcomeMessage: r.WelcomeMessage, StarterQuestions: r.StarterQuestions, Status: r.Status, DisabledReason: r.DisabledReason,
		DisabledBy: r.DisabledBy, DisabledAt: r.DisabledAt, Draft: r.Draft, DraftRevision: r.DraftRevision,
		PublishedVersionID: r.PublishedVersionID, Revision: r.Revision, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt, DeletedAt: r.DeletedAt,
	}
}

func keyAllowsKBs(k *authz.KeyGrant, ids []uuid.UUID) bool {
	for _, id := range ids {
		if !k.AllowsKB(id) {
			return false
		}
	}
	return true
}

// resolved is a published agent the actor may use.
type resolved struct {
	agent   dbgen.Agent
	team    dbgen.Team
	version dbgen.AgentVersion
	config  Config
	grant   string
}

// findAgent looks an agent up by team and slug, or by ID when teamRef is
// "", without any access check.
func (s *Service) findAgent(ctx context.Context, teamRef, agentRef string) (dbgen.Agent, error) {
	var (
		ag  dbgen.Agent
		err error
	)
	if teamRef == "" {
		id, perr := uuid.Parse(agentRef)
		if perr != nil {
			return ag, errNoAgent
		}
		ag, err = s.q.GetAgent(ctx, id)
	} else {
		var t dbgen.Team
		if id, perr := uuid.Parse(teamRef); perr == nil {
			t, err = s.q.GetTeamByID(ctx, id)
		} else {
			t, err = s.q.GetTeamBySlug(ctx, strings.ToLower(teamRef))
		}
		if err == nil {
			ag, err = s.q.GetAgentBySlug(ctx, dbgen.GetAgentBySlugParams{TeamID: t.ID, Slug: strings.ToLower(agentRef)})
		}
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return ag, errNoAgent
	}
	return ag, err
}

// resolve finds a published agent by team and slug (or by ID when teamRef
// is "") that the actor may chat with (mayUse). Others get 404. Disabled
// agents are returned (the caller refuses them after the profile is known).
func (s *Service) resolve(ctx context.Context, a authz.Actor, teamRef, agentRef string) (resolved, error) {
	var r resolved
	var err error
	if r.agent, err = s.findAgent(ctx, teamRef, agentRef); err != nil {
		return r, err
	}
	r.grant = authz.AudienceTeam
	if g, err := s.q.GetAudienceGrant(ctx, r.agent.ID); err == nil {
		r.grant = g.PrincipalType
	}
	ok, err := s.mayUse(ctx, a, r.agent.TeamID, r.grant)
	if err != nil {
		return r, err
	}
	if !ok || !r.agent.PublishedVersionID.Valid {
		return r, errNoAgent
	}
	if r.team, err = s.q.GetTeamByID(ctx, r.agent.TeamID); err != nil {
		return r, err
	}
	if r.version, err = s.q.GetAgentVersion(ctx, r.agent.PublishedVersionID.UUID); err != nil {
		return r, err
	}
	r.config = DecodeConfig(r.version.Config)
	if a.Key != nil && (!keyAllowsKBs(a.Key, r.config.KBIDs()) || keyHides(a, r.agent.ID)) {
		return r, errNoAgent
	}
	return r, nil
}

// card is the profile of a resolved agent.
func (s *Service) card(ctx context.Context, r resolved) Card {
	c := Card{Agent: r.agent, TeamSlug: r.team.Slug, TeamName: r.team.Name, CitationMode: r.config.CitationMode, Audience: r.grant}
	if sn, err := s.q.GetShortName(ctx, r.agent.ID); err == nil {
		c.ShortName = &sn.ShortName
	}
	return c
}

// Profile returns the public profile of a published agent the actor may use.
func (s *Service) Profile(ctx context.Context, a authz.Actor, teamRef, agentRef string) (Card, error) {
	r, err := s.resolve(ctx, a, teamRef, agentRef)
	if err != nil {
		return Card{}, err
	}
	return s.card(ctx, r), nil
}
