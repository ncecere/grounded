// Package agents implements team agents (docs/phase3-agents.md, ADR-0009):
// drafts and immutable published versions, the query-time policy check
// (ADR-0006 rule 8), the chat pipeline over internal/agentloop, draft test
// chats, conversations (ADR-0010), feedback, analytics and the access log.
package agents

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/teams"
)

// Agent statuses.
const (
	StatusActive             = "active"
	StatusDisabledByTeam     = "disabled_by_team"
	StatusDisabledByPlatform = "disabled_by_platform"
)

// Service manages agents and runs chats.
type Service struct {
	Pool    *pgxpool.Pool
	Teams   *teams.Service
	KBs     *kbs.Service
	Catalog *catalog.Service
	// Limits enforces team limits (nil: none).
	Limits *limits.Service
	// Notify tells team admins when the platform disables an agent, and
	// owners when an agent is published beyond the team (nil: nobody).
	Notify *notify.Service
	// Moderation checks questions and answers (nil: nothing is moderated).
	Moderation *moderation.Service
	// SystemOne judges retrieved passages when a SystemOne model is
	// configured and judging is on (nil: never, ADR-0020).
	SystemOne *systemone.Service
	// BreakGlass lets a platform admin read a team's conversations under a
	// break-glass session (nil: never; ADR-0024).
	BreakGlass *breakglass.Service
	// PublicEnabled reports the platform's public switch (nil: off).
	PublicEnabled func(context.Context) (bool, error)
	// Pepper derives the per-team keys of pseudonymous user IDs (nil: no
	// pseudonyms are recorded).
	Pepper []byte
	// OrgName (ORG_NAME) names the organisation in the agent preamble
	// ("": omitted).
	OrgName string
	Log     *slog.Logger
	// NewProvider builds the model provider for a connection (default: the
	// OpenAI-compatible adapter).
	NewProvider func(*gateway.Client) llm.Provider
	// OnPublished runs in the publish transaction (internal/evals queues
	// the agent's automatic evaluation runs; nil: nothing).
	OnPublished func(ctx context.Context, tx pgx.Tx, agentID uuid.UUID) error
	q           *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, k *kbs.Service, c *catalog.Service, l *limits.Service, pepper []byte, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{Pool: pool, Teams: t, KBs: k, Catalog: c, Limits: l, Pepper: pepper, Log: log,
		NewProvider: func(c *gateway.Client) llm.Provider { return llm.NewOpenAI(c) }, q: dbgen.New(pool)}
}

var (
	errNoAgent   = apperr.NotFound("agent_not_found", "Agent not found")
	errNoVersion = apperr.NotFound("version_not_found", "Version not found")
)

// ---- access -------------------------------------------------------------------

// teamAccess resolves a team for the actor. minRole "" allows any member
// (and API keys of the team); editors and admins are required for writes,
// which API keys never perform here.
func (s *Service) teamAccess(ctx context.Context, a authz.Actor, teamRef, minRole string) (teams.Access, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return acc, err
	}
	if acc.Role == "" {
		return acc, apperr.NotFound("team_not_found", "Team not found")
	}
	if minRole != "" {
		if a.Key != nil {
			return acc, apperr.Forbidden("API keys cannot change agents")
		}
		if !authz.RoleAtLeast(acc.Role, minRole) {
			if minRole == authz.RoleAdmin {
				return acc, apperr.Forbidden("Only team admins and owners can do this")
			}
			return acc, apperr.Forbidden("Only team editors, admins and owners can change agents")
		}
		if acc.Team.Status != teams.StatusActive {
			return acc, apperr.Conflict("team_archived", "This team is archived and read-only")
		}
	}
	return acc, nil
}

// keyHides reports an agent an API key restricted to other agents may not
// see or use (DESIGN.md §3.3).
func keyHides(a authz.Actor, id uuid.UUID) bool { return a.Key != nil && !a.Key.AllowsAgent(id) }

// loadVisible is loadAgent for reads: agents outside an API key's
// restriction are not found.
func (s *Service) loadVisible(ctx context.Context, a authz.Actor, teamID, id uuid.UUID) (dbgen.Agent, error) {
	if keyHides(a, id) {
		return dbgen.Agent{}, errNoAgent
	}
	return s.loadAgent(ctx, s.q, teamID, id, false)
}

func (s *Service) loadAgent(ctx context.Context, q *dbgen.Queries, teamID, id uuid.UUID, lock bool) (dbgen.Agent, error) {
	var (
		ag  dbgen.Agent
		err error
	)
	if lock {
		ag, err = q.LockAgent(ctx, id)
	} else {
		ag, err = q.GetAgent(ctx, id)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && ag.TeamID != teamID) {
		return ag, errNoAgent
	}
	return ag, err
}

// ---- views --------------------------------------------------------------------

// KBSummary names a KB in a view.
type KBSummary struct {
	ID   uuid.UUID
	Name string
	TopK int // in effect: the agent's, or the KB's current top-k when inherited
	// Inherited: the configuration doesn't set the top-k (C14).
	Inherited bool
}

// Version is a published version.
type Version struct {
	dbgen.AgentVersion
	PublishedByName string
	Config          Config
	ChatModelName   string
	Classification  string
	KBs             []KBSummary
}

// View is an agent as its team sees it.
type View struct {
	Agent     dbgen.Agent
	TeamSlug  string
	Draft     Config
	Audience  string
	Published *Version
	// HasUnpublishedChanges: the draft differs from the published config.
	HasUnpublishedChanges bool
	// Warnings are publish problems of the draft and policy problems of
	// the published version (GET only).
	Warnings []Problem
}

// kbRows returns the KBs that still exist, by ID.
func (s *Service) kbRows(ctx context.Context, ids []uuid.UUID) map[uuid.UUID]dbgen.KnowledgeBase {
	out := map[uuid.UUID]dbgen.KnowledgeBase{}
	for _, id := range ids {
		if kb, err := s.q.GetKB(ctx, id); err == nil {
			out[kb.ID] = kb
		}
	}
	return out
}

func (s *Service) versionView(ctx context.Context, v dbgen.AgentVersion, byName string) Version {
	out := Version{AgentVersion: v, PublishedByName: byName, Config: DecodeConfig(v.Config)}
	if m, err := s.q.GetModel(ctx, v.ChatModelID); err == nil {
		out.ChatModelName = m.DisplayName
	}
	if l, err := s.q.ClassificationByRank(ctx, v.EffectiveRank); err == nil {
		out.Classification = l.Key
	}
	rows := s.kbRows(ctx, out.Config.KBIDs())
	for _, ref := range out.Config.KBs {
		kb := rows[ref.KBID]
		out.KBs = append(out.KBs, KBSummary{ID: ref.KBID, Name: kb.Name, TopK: ref.EffectiveTopK(int(kb.TopK)), Inherited: ref.TopK == nil})
	}
	return out
}

func (s *Service) view(ctx context.Context, ag dbgen.Agent, team dbgen.Team, warnings bool) (View, error) {
	v := View{Agent: ag, TeamSlug: team.Slug, Draft: DecodeConfig(ag.Draft), Audience: authz.AudienceTeam}
	if g, err := s.q.GetAudienceGrant(ctx, ag.ID); err == nil {
		v.Audience = g.PrincipalType
	}
	if ag.PublishedVersionID.Valid {
		pv, err := s.q.GetAgentVersion(ctx, ag.PublishedVersionID.UUID)
		if err != nil {
			return v, err
		}
		name := ""
		if pv.PublishedBy.Valid {
			if u, err := s.q.GetUser(ctx, pv.PublishedBy.UUID); err == nil {
				name = u.DisplayName
			}
		}
		ver := s.versionView(ctx, pv, name)
		v.Published = &ver
		v.HasUnpublishedChanges = !bytes.Equal(v.Draft.JSON(), ver.Config.JSON())
	} else {
		v.HasUnpublishedChanges = true
	}
	if warnings {
		probs, _, err := s.strictProblems(ctx, s.q, team, v.Draft, v.Draft.Audience)
		if err != nil {
			return v, err
		}
		for _, p := range probs {
			p.Field = "draft." + p.Field
			v.Warnings = append(v.Warnings, p)
		}
		if v.Published != nil {
			p, err := s.evaluate(ctx, s.q, team, &v.Published.ChatModelID, v.Published.Config.KBIDs(), v.Audience)
			if err != nil {
				return v, err
			}
			for _, viol := range p.Violations {
				v.Warnings = append(v.Warnings, Problem{Field: "published", Problem: viol.Message + " (chat is refused until this is fixed)"})
			}
		}
	}
	if v.Warnings == nil {
		v.Warnings = []Problem{}
	}
	return v, nil
}

// mergeMeta adds b's keys to audit metadata a.
func mergeMeta(a, b map[string]any) map[string]any {
	if a == nil {
		return b
	}
	for k, v := range b {
		a[k] = v
	}
	return a
}

// ---- pseudonyms ------------------------------------------------------------------

// pseudonym is HMAC-SHA256(user ID) with a per-team key derived from the
// API key pepper, so analytics can count unique users without identifying
// them (ADR-0010). Service keys have none.
func (s *Service) pseudonym(teamID uuid.UUID, a authz.Actor) *string {
	if len(s.Pepper) == 0 || a.UserID == uuid.Nil || (a.Key != nil && !a.Key.Personal()) {
		return nil
	}
	kd := hmac.New(sha256.New, s.Pepper)
	// "ragd-pseudonym:" is a historical derivation label from before the rename
	// to Grounded. It must not change: it would re-key every stored pseudonym.
	kd.Write([]byte("ragd-pseudonym:" + teamID.String()))
	m := hmac.New(sha256.New, kd.Sum(nil))
	m.Write([]byte(a.UserID.String()))
	out := hex.EncodeToString(m.Sum(nil)[:16])
	return &out
}
