// Agent CRUD: listing, creating, updating and deleting agents and their
// profiles (name, slug, description, accent colour, welcome message and
// starter questions).

package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// List returns the team's agents. Members see them all (metadata).
func (s *Service) List(ctx context.Context, a authz.Actor, teamRef string) ([]View, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, "")
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTeamAgents(ctx, acc.Team.ID)
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(rows))
	for _, ag := range rows {
		if keyHides(a, ag.ID) {
			continue
		}
		v, err := s.view(ctx, ag, acc.Team, false)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// Get returns one agent with warnings.
func (s *Service) Get(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (View, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, "")
	if err != nil {
		return View{}, err
	}
	ag, err := s.loadVisible(ctx, a, acc.Team.ID, id)
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, ag, acc.Team, true)
}

// Profile holds optional profile changes.
type Profile struct {
	Name, Slug, Description, AccentColor, WelcomeMessage *string
	StarterQuestions                                     *[]string
}

// CreateInput creates an agent. Slug defaults to one derived from the name;
// Config (optional) is the initial draft.
type CreateInput struct {
	Profile
	Config json.RawMessage
}

var slugJunk = regexp.MustCompile(`[^a-z0-9]+`)

// slugFromName derives a URL slug from an agent name.
func slugFromName(name string) string {
	s := strings.Trim(slugJunk.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(s) > 60 {
		s = strings.Trim(s[:60], "-")
	}
	if teams.ValidateSlug(s) != nil {
		return "agent"
	}
	return s
}

type profileFields struct {
	name, slug, description, accent, welcome string
	starters                                 []string
}

func applyProfile(cur profileFields, p Profile) (profileFields, error) {
	if p.Name != nil {
		cur.name = strings.TrimSpace(*p.Name)
	}
	if n := len([]rune(cur.name)); n < 1 || n > 80 {
		return cur, apperr.Invalid("invalid_name", "Name must be 1-80 characters")
	}
	if p.Slug != nil {
		cur.slug = strings.ToLower(strings.TrimSpace(*p.Slug))
		if err := teams.ValidateSlug(cur.slug); err != nil {
			return cur, err
		}
	}
	if p.Description != nil {
		cur.description = strings.TrimSpace(*p.Description)
	}
	if len([]rune(cur.description)) > 500 {
		return cur, apperr.Invalid("invalid_description", "Description must be at most 500 characters")
	}
	if p.AccentColor != nil {
		c, err := NormalizeAccent(*p.AccentColor)
		if err != nil {
			return cur, err
		}
		cur.accent = c
	}
	if p.WelcomeMessage != nil {
		cur.welcome = strings.TrimSpace(*p.WelcomeMessage)
	}
	if len([]rune(cur.welcome)) > 1000 {
		return cur, apperr.Invalid("invalid_welcome_message", "The welcome message must be at most 1000 characters")
	}
	if p.StarterQuestions != nil {
		cur.starters = []string{}
		for _, q := range *p.StarterQuestions {
			q = strings.TrimSpace(q)
			if q == "" {
				continue
			}
			if len([]rune(q)) > 200 {
				return cur, apperr.Invalid("invalid_starter_questions", "Each starter question must be at most 200 characters")
			}
			cur.starters = append(cur.starters, q)
		}
		if len(cur.starters) > 6 {
			return cur, apperr.Invalid("invalid_starter_questions", "An agent can have at most 6 starter questions")
		}
	}
	if cur.starters == nil {
		cur.starters = []string{}
	}
	return cur, nil
}

func profileOf(ag dbgen.Agent) profileFields {
	return profileFields{name: ag.Name, slug: ag.Slug, description: ag.Description, accent: ag.AccentColor,
		welcome: ag.WelcomeMessage, starters: ag.StarterQuestions}
}

func agentSnapshot(ag dbgen.Agent) map[string]any {
	return map[string]any{
		"name": ag.Name, "slug": ag.Slug, "description": ag.Description, "accentColor": ag.AccentColor,
		"welcomeMessage": ag.WelcomeMessage, "starterQuestions": ag.StarterQuestions, "status": ag.Status,
	}
}

func slugTaken() error {
	return apperr.Conflict("slug_taken", "This team already has an agent with that slug")
}

// Create adds an agent with a draft (editors). The audience grant is team.
func (s *Service) Create(ctx context.Context, a authz.Actor, teamRef string, in CreateInput) (View, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return View{}, err
	}
	explicitSlug := in.Slug != nil && strings.TrimSpace(*in.Slug) != ""
	if !explicitSlug {
		in.Slug = nil
	}
	pf, err := applyProfile(profileFields{}, in.Profile)
	if err != nil {
		return View{}, err
	}
	if !explicitSlug {
		pf.slug = slugFromName(pf.name)
	}
	cfg := DefaultConfig()
	if len(bytes.TrimSpace(in.Config)) > 0 && string(bytes.TrimSpace(in.Config)) != "null" {
		if cfg, err = ParseConfig(in.Config); err != nil {
			return View{}, err
		}
	}
	var out dbgen.Agent
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if s.Limits != nil {
			if err := s.Limits.LockUsage(ctx, q, acc.Team.ID); err != nil {
				return err
			}
			if err := s.Limits.CheckResources(ctx, q, acc.Team.ID, limits.Need{Agents: 1}); err != nil {
				return err
			}
		}
		slug, err := freeSlug(ctx, q, acc.Team.ID, pf.slug, explicitSlug)
		if err != nil {
			return err
		}
		out, err = q.InsertAgent(ctx, dbgen.InsertAgentParams{
			TeamID: acc.Team.ID, Slug: slug, Name: pf.name, Description: pf.description, AccentColor: pf.accent,
			WelcomeMessage: pf.welcome, StarterQuestions: pf.starters, Draft: cfg.JSON(),
			CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		})
		if apperr.IsUniqueViolation(err, "agents_team_slug_key") {
			return slugTaken()
		} else if err != nil {
			return err
		}
		if err := q.InsertAudienceGrant(ctx, dbgen.InsertAudienceGrantParams{
			AgentID: out.ID, PrincipalType: authz.AudienceTeam, CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		}); err != nil {
			return err
		}
		e := a.Audit("agent.create", "agent", out.ID.String())
		e.TeamID, e.After = acc.Team.ID, agentSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, out, acc.Team, true)
}

// freeSlug returns base, or base with a numeric suffix when the team
// already has an agent with that slug. An explicit slug that is taken is a
// conflict.
func freeSlug(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, base string, explicit bool) (string, error) {
	slug := base
	for i := 2; ; i++ {
		_, err := q.GetAgentBySlug(ctx, dbgen.GetAgentBySlugParams{TeamID: teamID, Slug: slug})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return slug, nil
		} else if err != nil {
			return "", err
		}
		if explicit || i > 50 {
			return "", slugTaken()
		}
		suffix := "-" + strconv.Itoa(i)
		slug = strings.Trim(base[:min(len(base), 63-len(suffix))], "-") + suffix
	}
}

// UpdateInput changes profile fields and/or replaces the draft config.
type UpdateInput struct {
	Profile
	Config json.RawMessage // nil keeps the draft
}

// Update changes an agent (editors). The draft is validated leniently.
func (s *Service) Update(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, in UpdateInput, expectedRevision int64) (View, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return View{}, err
	}
	var out dbgen.Agent
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.loadAgent(ctx, q, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		pf, err := applyProfile(profileOf(cur), in.Profile)
		if err != nil {
			return err
		}
		if err := checkLiveProfile(ctx, q, acc.Role, cur, pf); err != nil {
			return err
		}
		draft, changed := cur.Draft, false
		if in.Config != nil {
			cfg, err := ParseConfig(in.Config)
			if err != nil {
				return err
			}
			draft = cfg.JSON()
			changed = !bytes.Equal(DecodeConfig(cur.Draft).JSON(), draft)
		}
		out, err = q.UpdateAgentProfile(ctx, dbgen.UpdateAgentProfileParams{
			ID: id, Slug: pf.slug, Name: pf.name, Description: pf.description, AccentColor: pf.accent,
			WelcomeMessage: pf.welcome, StarterQuestions: pf.starters, Draft: draft, DraftChanged: changed,
		})
		if apperr.IsUniqueViolation(err, "agents_team_slug_key") {
			return slugTaken()
		} else if err != nil {
			return err
		}
		before, after := agentSnapshot(cur), agentSnapshot(out)
		if !jsonEqual(before, after) {
			e := a.Audit("agent.update", "agent", id.String())
			e.TeamID, e.Before, e.After = acc.Team.ID, before, after
			return audit.Record(ctx, q, e)
		}
		return nil
	})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, out, acc.Team, true)
}

// errLiveProfile: the profile isn't versioned, so on an agent published
// beyond the team it is what those people see at once.
func errLiveProfile() error {
	return apperr.New(403, "live_profile_forbidden",
		"Only team admins and owners can change the name, address, description or look of an agent published beyond the team. Editors can change its draft.")
}

// checkLiveProfile refuses an editor's change to the profile (name, slug,
// description, accent, welcome, starters) of an agent whose live audience is
// beyond the team: those reach people at once, and only admins and owners
// may publish beyond the team (BU-09). The draft stays the editors'.
func checkLiveProfile(ctx context.Context, q *dbgen.Queries, role string, cur dbgen.Agent, next profileFields) error {
	if authz.RoleAtLeast(role, authz.RoleAdmin) || sameProfile(profileOf(cur), next) {
		return nil
	}
	g, err := q.GetAudienceGrant(ctx, cur.ID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	if g.PrincipalType != authz.AudienceTeam {
		return errLiveProfile()
	}
	return nil
}

func sameProfile(a, b profileFields) bool {
	return a.name == b.name && a.slug == b.slug && a.description == b.description && a.accent == b.accent &&
		a.welcome == b.welcome && slices.Equal(a.starters, b.starters)
}

func jsonEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}

// Delete soft-deletes an agent (team admins). Its conversations stay
// readable by their owners but can't continue.
func (s *Service) Delete(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleAdmin)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.loadAgent(ctx, q, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		if err := q.SoftDeleteAgent(ctx, id); err != nil {
			return err
		}
		// Its evaluation sets go with it (docs/evaluations.md §7).
		if err := q.DeleteAgentEvalSets(ctx, uuid.NullUUID{UUID: id, Valid: true}); err != nil {
			return err
		}
		e := a.Audit("agent.delete", "agent", id.String())
		e.TeamID, e.Before = acc.Team.ID, agentSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}
