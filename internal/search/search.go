// Package search finds objects by name for the command palette (⌘K,
// docs/v0.2.0.md §3.5, DESIGN.md §9): GET /v1/search.
//
// What a caller finds follows the same rules as the rest of the API:
//
//   - Everyone signed in: the agents of their teams (members see their
//     team's agents) and the agents they may chat with (the directory's
//     rules: all_authenticated, or public while the public switch is on;
//     published, active agents of active teams), the knowledge bases and
//     data sources of all their teams, and their own conversations by title;
//     the evaluation sets of the teams where they are an editor or above,
//     while evaluations are on (docs/evaluations.md §5).
//   - Platform admins and auditors, in addition: teams, users, models,
//     connections, embedding profiles and shared sources, which they may
//     read on the admin pages. Never another team's knowledge bases,
//     sources or conversations (that is content, reachable only under
//     break-glass, which search does not use).
//   - API keys: no (the route is session-only; a key belongs to one team
//     and has its lists).
package search

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Result types, in the order they are listed within a rank.
const (
	TypeTeam             = "team"
	TypeUser             = "user"
	TypeModel            = "model"
	TypeConnection       = "connection"
	TypeEmbeddingProfile = "embedding_profile"
	TypeSharedSource     = "shared_source"
	TypeAgent            = "agent"
	TypeKnowledgeBase    = "knowledge_base"
	TypeDataSource       = "data_source"
	TypeConversation     = "conversation"
	TypeEvaluationSet    = "evaluation_set"
)

// Limits of a search.
const (
	MinQueryLen  = 2
	MaxQueryLen  = 200
	DefaultLimit = 20
	MaxLimit     = 50
)

// Result is one match.
type Result struct {
	Type      string
	ID        uuid.UUID
	Label     string
	Secondary string
	// Kind is a model's kind or a data source's type.
	Kind string
	// Status is set when the object isn't in its normal state (archived,
	// suspended, disabled, retired, paused, agent_deleted).
	Status    string
	TeamSlug  string
	AgentSlug string
	// CanOpen and CanChat are set for agents.
	CanOpen, CanChat bool

	rank int
}

// Service runs searches.
type Service struct {
	q *dbgen.Queries
	// PublicEnabled reports the platform's public switch (nil: off), for
	// public agents of other teams.
	PublicEnabled func(context.Context) (bool, error)
	// EvaluationsEnabled reports the evaluations switch (nil: off).
	EvaluationsEnabled func(context.Context) (bool, error)
}

// New returns a Service.
func New(q *dbgen.Queries, publicEnabled func(context.Context) (bool, error)) *Service {
	return &Service{q: q, PublicEnabled: publicEnabled}
}

// patterns are a query's match patterns (internal/store/queries/search.sql).
type patterns struct {
	contains, prefix, word string
	lim                    int32
	user                   uuid.UUID
}

// finder searches one or more types.
type finder func(ctx context.Context, p patterns) ([]Result, error)

// Search returns the objects the actor may see whose name matches text,
// best first, at most limit (0: DefaultLimit).
func (s *Service) Search(ctx context.Context, a authz.Actor, text string, limit int) ([]Result, error) {
	if a.Key != nil || a.UserID == uuid.Nil {
		return nil, apperr.Forbidden("Search is available to signed-in users only")
	}
	text = strings.TrimSpace(text)
	if n := utf8.RuneCountInString(text); n < MinQueryLen || n > MaxQueryLen {
		return nil, apperr.Invalid("invalid_query", "Type at least 2 characters (at most 200) to search")
	}
	if limit == 0 {
		limit = DefaultLimit
	}
	if limit < 1 || limit > MaxLimit {
		return nil, apperr.Invalid("invalid_limit", "limit must be between 1 and 50")
	}
	esc := store.EscapeLike(text)
	p := patterns{contains: "%" + esc + "%", prefix: esc + "%", word: `\m` + regexp.QuoteMeta(text), lim: int32(limit), user: a.UserID}
	finders := []finder{s.agents, s.knowledgeBases, s.dataSources, s.evaluationSets, s.conversations}
	if a.CanReadPlatform() {
		finders = append([]finder{s.teams, s.users, s.catalog, s.sharedSources}, finders...)
	}
	var out []Result
	for _, f := range finders {
		rs, err := f(ctx, p)
		if err != nil {
			return nil, err
		}
		out = append(out, rs...)
	}
	// Each finder returns its types in type order, best first; a stable
	// sort by rank keeps that order within a rank.
	sort.SliceStable(out, func(i, j int) bool { return out[i].rank < out[j].rank })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// unless returns status when it differs from normal.
func unless(status, normal string) string {
	if status == normal {
		return ""
	}
	return status
}

func enabled(on bool) string {
	if on {
		return ""
	}
	return "disabled"
}

// ---- platform staff ------------------------------------------------------------

func (s *Service) teams(ctx context.Context, p patterns) ([]Result, error) {
	rows, err := s.q.SearchTeams(ctx, dbgen.SearchTeamsParams{Contains: p.contains, Prefix: p.prefix, Word: p.word, Lim: p.lim})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		out = append(out, Result{Type: TypeTeam, ID: r.ID, Label: r.Name, Secondary: r.Slug, TeamSlug: r.Slug,
			Status: unless(r.Status, "active"), rank: int(r.Rank)})
	}
	return out, err
}

func (s *Service) users(ctx context.Context, p patterns) ([]Result, error) {
	rows, err := s.q.SearchUsers(ctx, dbgen.SearchUsersParams{Contains: p.contains, Prefix: p.prefix, Word: p.word, Lim: p.lim})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		label := r.DisplayName
		if label == "" {
			label = r.Email
		}
		out = append(out, Result{Type: TypeUser, ID: r.ID, Label: label, Secondary: r.Email,
			Status: unless(r.Status, "active"), rank: int(r.Rank)})
	}
	return out, err
}

// catalog finds models, connections and embedding profiles.
func (s *Service) catalog(ctx context.Context, p patterns) ([]Result, error) {
	models, err := s.q.SearchModels(ctx, dbgen.SearchModelsParams{Contains: p.contains, Prefix: p.prefix, Word: p.word, Lim: p.lim})
	if err != nil {
		return nil, err
	}
	conns, err := s.q.SearchConnections(ctx, dbgen.SearchConnectionsParams{Contains: p.contains, Prefix: p.prefix, Word: p.word, Lim: p.lim})
	if err != nil {
		return nil, err
	}
	profiles, err := s.q.SearchEmbeddingProfiles(ctx, dbgen.SearchEmbeddingProfilesParams{Contains: p.contains, Prefix: p.prefix, Word: p.word, Lim: p.lim})
	out := make([]Result, 0, len(models)+len(conns)+len(profiles))
	for _, r := range models {
		out = append(out, Result{Type: TypeModel, ID: r.ID, Label: r.DisplayName, Secondary: r.Key, Kind: r.Kind,
			Status: enabled(r.Enabled), rank: int(r.Rank)})
	}
	for _, r := range conns {
		out = append(out, Result{Type: TypeConnection, ID: r.ID, Label: r.Name, Secondary: r.BaseURL,
			Status: enabled(r.Enabled), rank: int(r.Rank)})
	}
	for _, r := range profiles {
		out = append(out, Result{Type: TypeEmbeddingProfile, ID: r.ID, Label: r.Name, Secondary: r.Key,
			Status: unless(r.Status, "active"), rank: int(r.Rank)})
	}
	return out, err
}

func (s *Service) sharedSources(ctx context.Context, p patterns) ([]Result, error) {
	rows, err := s.q.SearchSharedSources(ctx, dbgen.SearchSharedSourcesParams{Contains: p.contains, Prefix: p.prefix, Word: p.word, Lim: p.lim})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		out = append(out, Result{Type: TypeSharedSource, ID: r.ID, Label: r.Name, Kind: r.Type,
			Status: unless(r.Status, "active"), rank: int(r.Rank)})
	}
	return out, err
}

// ---- everyone ---------------------------------------------------------------------

func (s *Service) agents(ctx context.Context, p patterns) ([]Result, error) {
	public := false
	if s.PublicEnabled != nil {
		on, err := s.PublicEnabled(ctx)
		if err != nil {
			return nil, err
		}
		public = on
	}
	rows, err := s.q.SearchAgents(ctx, dbgen.SearchAgentsParams{Contains: p.contains, Prefix: p.prefix, Word: p.word, Lim: p.lim,
		UserID: p.user, PublicEnabled: public})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		out = append(out, Result{Type: TypeAgent, ID: r.ID, Label: r.Name, Secondary: r.TeamName, TeamSlug: r.TeamSlug,
			AgentSlug: r.Slug, CanOpen: r.Member, CanChat: r.Chat, rank: int(r.Rank)})
	}
	return out, err
}

func (s *Service) knowledgeBases(ctx context.Context, p patterns) ([]Result, error) {
	rows, err := s.q.SearchKnowledgeBases(ctx, dbgen.SearchKnowledgeBasesParams{Contains: p.contains, Prefix: p.prefix, Word: p.word,
		Lim: p.lim, UserID: p.user})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		out = append(out, Result{Type: TypeKnowledgeBase, ID: r.ID, Label: r.Name, Secondary: r.TeamName, TeamSlug: r.TeamSlug, rank: int(r.Rank)})
	}
	return out, err
}

func (s *Service) dataSources(ctx context.Context, p patterns) ([]Result, error) {
	rows, err := s.q.SearchDataSources(ctx, dbgen.SearchDataSourcesParams{Contains: p.contains, Prefix: p.prefix, Word: p.word,
		Lim: p.lim, UserID: p.user})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		out = append(out, Result{Type: TypeDataSource, ID: r.ID, Label: r.Name, Secondary: r.TeamName, TeamSlug: r.TeamSlug,
			Kind: r.Type, Status: unless(r.Status, "active"), rank: int(r.Rank)})
	}
	return out, err
}

func (s *Service) conversations(ctx context.Context, p patterns) ([]Result, error) {
	rows, err := s.q.SearchConversations(ctx, dbgen.SearchConversationsParams{Contains: p.contains, Prefix: p.prefix, Word: p.word,
		Lim: p.lim, UserID: p.user})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		st := ""
		if r.AgentDeleted {
			st = "agent_deleted"
		}
		out = append(out, Result{Type: TypeConversation, ID: r.ID, Label: r.Title, Secondary: r.AgentName, TeamSlug: r.TeamSlug,
			AgentSlug: r.AgentSlug, Status: st, rank: int(r.Rank)})
	}
	return out, err
}

// evaluationSets finds the evaluation sets of the teams where the user is an
// editor or above, while evaluations are on. Secondary names the team;
// Kind is what the set tests (knowledge_base or agent).
func (s *Service) evaluationSets(ctx context.Context, p patterns) ([]Result, error) {
	if s.EvaluationsEnabled == nil {
		return nil, nil
	}
	if on, err := s.EvaluationsEnabled(ctx); err != nil || !on {
		return nil, err
	}
	rows, err := s.q.SearchEvalSets(ctx, dbgen.SearchEvalSetsParams{Contains: p.contains, Prefix: p.prefix, Word: p.word,
		Lim: p.lim, UserID: p.user})
	out := make([]Result, 0, len(rows))
	for _, r := range rows {
		kind := "knowledge_base"
		if r.AgentID.Valid {
			kind = "agent"
		}
		out = append(out, Result{Type: TypeEvaluationSet, ID: r.ID, Label: r.Name, Secondary: r.TeamName, TeamSlug: r.TeamSlug,
			Kind: kind, rank: int(r.Rank)})
	}
	return out, err
}
