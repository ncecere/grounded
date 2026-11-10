// Package kbs manages knowledge bases (sets of data sources sharing one
// embedding profile) and hybrid retrieval over them (DESIGN.md §6).
package kbs

import (
	"context"
	"errors"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/rerank"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/vectorstore"
)

type Service struct {
	Pool    *pgxpool.Pool
	Teams   *teams.Service
	Catalog *catalog.Service
	Vectors vectorstore.Store
	// Limits enforces team limits (nil: none).
	Limits *limits.Service
	// Weights are the platform's default fusion weights (RETRIEVAL_*_WEIGHT);
	// KBs may override them. Invalid or zero = DefaultWeights.
	Weights Weights
	// SystemOne judges passages in the playground (nil: judge is refused).
	SystemOne *systemone.Service
	// Rerank is the platform's reranking (nil: searches aren't reranked).
	Rerank *rerank.Service
	// ParentExpansionOff turns parent/child retrieval off for every profile (RETRIEVAL_PARENT_EXPANSION=false): searches neither collapse
	// siblings nor expand parents, and the parent columns are ignored. The zero value leaves it on for profiles that have parents.
	ParentExpansionOff bool
	// Access computes a person's document permissions (docs/specs/document-acls/DESIGN.md). Nil: every caller reads
	// unrestricted documents only.
	Access *access.Resolver
	q      *dbgen.Queries

	countMu sync.Mutex
	counts  map[countKey]cachedCount
}

func New(pool *pgxpool.Pool, t *teams.Service, c *catalog.Service, v vectorstore.Store) *Service {
	return &Service{Pool: pool, Teams: t, Catalog: c, Vectors: v, q: dbgen.New(pool)}
}

// CallerFor is whose document permissions a request by the actor reads with: a person signed in, or on their own
// connected app; Anyone for an API key, or when permissions are not wired (Access nil).
func (s *Service) CallerFor(ctx context.Context, a authz.Actor) (access.Caller, error) {
	if s.Access == nil {
		return access.Anyone(), nil
	}
	return s.Access.For(ctx, a)
}

var errNoKB = apperr.NotFound("kb_not_found", "Knowledge base not found")

// SourceRef is an attached source with its classification.
type SourceRef struct {
	ID             uuid.UUID
	Name           string
	Classification string
	Rank           int32
	Shared         bool // a platform-shared source
}

// KB is a knowledge base with its sources and effective classification
// (the most sensitive attached source; ADR-0006 rule 3).
type KB struct {
	dbgen.KnowledgeBase
	Sources                 []SourceRef
	EffectiveClassification string // "" when no sources
	// ProfileWeights are the embedding profile's default fusion weights
	// (nil: the profile has none).
	ProfileWeights *Weights
}

func (s *Service) access(ctx context.Context, a authz.Actor, teamRef string, write bool) (teams.Access, error) {
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return acc, err
	}
	if acc.Role == "" {
		return acc, apperr.NotFound("team_not_found", "Team not found")
	}
	if write {
		if !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
			return acc, apperr.Forbidden("Only team editors, admins and owners can change knowledge bases")
		}
		if acc.Team.Status != teams.StatusActive {
			return acc, apperr.Conflict("team_archived", "This team is archived and read-only")
		}
	}
	return acc, nil
}

func (s *Service) withSources(ctx context.Context, q *dbgen.Queries, kbs []dbgen.KnowledgeBase) ([]KB, error) {
	ids := make([]uuid.UUID, len(kbs))
	for i, kb := range kbs {
		ids[i] = kb.ID
	}
	rows, err := q.KBSourceRows(ctx, ids)
	if err != nil {
		return nil, err
	}
	weightRows, err := q.KBProfileWeights(ctx, ids)
	if err != nil {
		return nil, err
	}
	profileWeights := make(map[uuid.UUID]*Weights, len(weightRows))
	for _, r := range weightRows {
		profileWeights[r.ID] = storedWeights(r.DefaultVectorWeight, r.DefaultKeywordWeight)
	}
	bySrc := map[uuid.UUID][]SourceRef{}
	for _, r := range rows {
		bySrc[r.KBID] = append(bySrc[r.KBID], SourceRef{ID: r.ID, Name: r.Name, Classification: r.Classification, Rank: r.Rank, Shared: r.Shared})
	}
	out := make([]KB, len(kbs))
	for i, kb := range kbs {
		k := KB{KnowledgeBase: kb, Sources: bySrc[kb.ID], ProfileWeights: profileWeights[kb.ID]}
		best := int32(-1)
		for _, src := range k.Sources {
			if src.Rank > best {
				best, k.EffectiveClassification = src.Rank, src.Classification
			}
		}
		out[i] = k
	}
	return out, nil
}

func (s *Service) List(ctx context.Context, a authz.Actor, teamRef string) ([]KB, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	kbs, err := s.q.ListTeamKBs(ctx, acc.Team.ID)
	if err != nil {
		return nil, err
	}
	if a.Key != nil {
		allowed := kbs[:0]
		for _, kb := range kbs {
			if a.Key.AllowsKB(kb.ID) {
				allowed = append(allowed, kb)
			}
		}
		kbs = allowed
	}
	return s.withSources(ctx, s.q, kbs)
}

// load returns a KB the actor may use. API keys are limited to their KBs.
func (s *Service) load(ctx context.Context, q *dbgen.Queries, a authz.Actor, teamID, id uuid.UUID, lock bool) (dbgen.KnowledgeBase, error) {
	var (
		kb  dbgen.KnowledgeBase
		err error
	)
	if lock {
		kb, err = q.LockKB(ctx, id)
	} else {
		kb, err = q.GetKB(ctx, id)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && kb.TeamID != teamID) ||
		(err == nil && a.Key != nil && !a.Key.AllowsKB(kb.ID)) {
		return kb, errNoKB
	}
	return kb, err
}

func (s *Service) Get(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (KB, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return KB{}, err
	}
	kb, err := s.load(ctx, s.q, a, acc.Team.ID, id, false)
	if err != nil {
		return KB{}, err
	}
	out, err := s.withSources(ctx, s.q, []dbgen.KnowledgeBase{kb})
	if err != nil {
		return KB{}, err
	}
	return out[0], nil
}
