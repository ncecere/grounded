// Package kbs manages knowledge bases (sets of data sources sharing one
// embedding profile) and hybrid retrieval over them (DESIGN.md §6).
package kbs

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/rerank"
	"github.com/ncecere/grounded/internal/sources"
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
	q      *dbgen.Queries

	countMu sync.Mutex
	counts  map[uuid.UUID]cachedCount
}

func New(pool *pgxpool.Pool, t *teams.Service, c *catalog.Service, v vectorstore.Store) *Service {
	return &Service{Pool: pool, Teams: t, Catalog: c, Vectors: v, q: dbgen.New(pool)}
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

// Input creates or updates a KB. ProfileID nil uses the platform default;
// the profile cannot change after creation (ADR-0007). Weights nil keeps the
// current fusion weights (the default for a new KB); DefaultWeights clears
// an override so the KB follows the default again: its profile's, else the
// platform's.
type Input struct {
	Name, Description string
	ProfileID         *uuid.UUID
	TopK              int32
	Weights           *Weights
	DefaultWeights    bool
}

func validate(in Input) error {
	if n := len(strings.TrimSpace(in.Name)); n < 1 || n > 100 {
		return apperr.Invalid("invalid_name", "Name must be 1-100 characters")
	}
	if len(in.Description) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	if in.TopK < 1 || in.TopK > 50 {
		return apperr.Invalid("invalid_top_k", "Results per query must be between 1 and 50")
	}
	if in.Weights != nil && in.DefaultWeights {
		return apperr.Invalid("invalid_fusion_weights", "Set fusion weights or use the platform default, not both")
	}
	if in.Weights != nil && !in.Weights.Valid() {
		return apperr.Invalid("invalid_fusion_weights", "Fusion weights must be between 0 and 1, and at least one must be above 0")
	}
	return nil
}

// weightColumns returns the stored override for w (nil = platform default).
func weightColumns(w *Weights) (*float64, *float64) {
	if w == nil {
		return nil, nil
	}
	v, k := w.Vector, w.Keyword
	return &v, &k
}

func kbSnapshot(kb dbgen.KnowledgeBase) map[string]any {
	return map[string]any{"name": kb.Name, "embeddingProfileId": kb.EmbeddingProfileID, "topK": kb.TopK,
		"vectorWeight": kb.VectorWeight, "keywordWeight": kb.KeywordWeight}
}

func (s *Service) Create(ctx context.Context, a authz.Actor, teamRef string, in Input) (KB, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return KB{}, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.TopK == 0 {
		in.TopK = 8
	}
	if err := validate(in); err != nil {
		return KB{}, err
	}
	var (
		out     dbgen.KnowledgeBase
		created []KB
	)
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if s.Limits != nil {
			if err := s.Limits.LockUsage(ctx, q, acc.Team.ID); err != nil {
				return err
			}
			if err := s.Limits.CheckResources(ctx, q, acc.Team.ID, limits.Need{KnowledgeBases: 1}); err != nil {
				return err
			}
		}
		profileID := uuid.Nil
		if in.ProfileID != nil {
			profileID = *in.ProfileID
		} else {
			profiles, err := q.ListEmbeddingProfiles(ctx)
			if err != nil {
				return err
			}
			for _, p := range profiles {
				if p.EmbeddingProfile.IsDefault {
					profileID = p.EmbeddingProfile.ID
				}
			}
			if profileID == uuid.Nil {
				return apperr.Invalid("no_default_profile", "No default embedding profile is configured. Ask a platform admin.")
			}
		}
		if _, err := s.Catalog.ProfileForUse(ctx, q, profileID, 0); err != nil {
			return err
		}
		var err error
		vw, kw := weightColumns(in.Weights)
		out, err = q.InsertKB(ctx, dbgen.InsertKBParams{
			TeamID: acc.Team.ID, Name: in.Name, Description: in.Description, EmbeddingProfileID: profileID,
			TopK: in.TopK, VectorWeight: vw, KeywordWeight: kw,
			CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		})
		if apperr.IsUniqueViolation(err, "knowledge_bases_team_name_key") {
			return apperr.Conflict("name_taken", "This team already has a knowledge base with that name")
		} else if err != nil {
			return err
		}
		e := a.Audit("kb.create", "knowledge_base", out.ID.String())
		e.TeamID, e.After = acc.Team.ID, kbSnapshot(out)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		created, err = s.withSources(ctx, q, []dbgen.KnowledgeBase{out})
		return err
	})
	if err != nil {
		return KB{}, err
	}
	return created[0], nil
}

func (s *Service) Update(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, in Input, expectedRevision int64) (KB, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return KB{}, err
	}
	var out []KB
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.load(ctx, q, a, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if in.ProfileID != nil && *in.ProfileID != cur.EmbeddingProfileID {
			return apperr.Invalid("profile_immutable", "A knowledge base's embedding profile cannot be changed")
		}
		in.Name = strings.TrimSpace(in.Name)
		if err := validate(in); err != nil {
			return err
		}
		vw, kw := cur.VectorWeight, cur.KeywordWeight
		switch {
		case in.DefaultWeights:
			vw, kw = nil, nil
		case in.Weights != nil:
			vw, kw = weightColumns(in.Weights)
		}
		updated, err := q.UpdateKB(ctx, dbgen.UpdateKBParams{ID: id, Name: in.Name, Description: in.Description, TopK: in.TopK,
			VectorWeight: vw, KeywordWeight: kw})
		if apperr.IsUniqueViolation(err, "knowledge_bases_team_name_key") {
			return apperr.Conflict("name_taken", "This team already has a knowledge base with that name")
		} else if err != nil {
			return err
		}
		e := a.Audit("kb.update", "knowledge_base", id.String())
		e.TeamID, e.Before, e.After = acc.Team.ID, kbSnapshot(cur), kbSnapshot(updated)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		out, err = s.withSources(ctx, q, []dbgen.KnowledgeBase{updated})
		return err
	})
	if err != nil {
		return KB{}, err
	}
	return out[0], nil
}

func (s *Service) Delete(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		// Its profile migrations go with it; they lock before the KB.
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		cur, err := s.load(ctx, q, a, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		// Refused while a published agent version searches it.
		users, err := q.AgentsPublishingKB(ctx, id)
		if err != nil {
			return err
		}
		if len(users) > 0 {
			names := make([]string, len(users))
			agents := make([]map[string]any, len(users))
			for i, u := range users {
				names[i] = u.Name
				agents[i] = map[string]any{"id": u.ID, "name": u.Name, "slug": u.Slug}
			}
			return &apperr.Error{Status: 409, Code: "kb_in_use",
				Message: "Published agents use this knowledge base: " + strings.Join(names, ", ") +
					". Remove it from them and publish again first.",
				Details: map[string]any{"agents": agents}}
		}
		// Drafts drop the reference silently (the agent shows a warning);
		// versions that are no longer served release it.
		drafts, err := q.AgentsWithDraftKB(ctx, dbgen.AgentsWithDraftKBParams{TeamID: acc.Team.ID, KBID: id.String()})
		if err != nil {
			return err
		}
		for _, ag := range drafts {
			if _, err := q.SetAgentDraft(ctx, dbgen.SetAgentDraftParams{ID: ag.ID, Draft: withoutKB(ag.Draft, id)}); err != nil {
				return err
			}
		}
		if err := q.DeleteUnservedVersionKB(ctx, id); err != nil {
			return err
		}
		if err := q.DeleteKB(ctx, id); err != nil {
			return err
		}
		e := a.Audit("kb.delete", "knowledge_base", id.String())
		e.TeamID, e.Before = acc.Team.ID, kbSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}

// AttachSource adds a team source or a platform-shared source to a KB. The
// source must use the KB's embedding profile so the KB never mixes vector
// spaces (ADR-0007), and a shared source's classification must be within
// the team's approved maximum (ADR-0006 rule 2).
func (s *Service) AttachSource(ctx context.Context, a authz.Actor, teamRef string, kbID, sourceID uuid.UUID) (KB, error) {
	return s.changeSources(ctx, a, teamRef, kbID, sourceID, true)
}

func (s *Service) DetachSource(ctx context.Context, a authz.Actor, teamRef string, kbID, sourceID uuid.UUID) (KB, error) {
	return s.changeSources(ctx, a, teamRef, kbID, sourceID, false)
}

func (s *Service) changeSources(ctx context.Context, a authz.Actor, teamRef string, kbID, sourceID uuid.UUID, attach bool) (KB, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return KB{}, err
	}
	var out []KB
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		// Profile migrations lock before the KB (see joinMigration).
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		kb, err := s.load(ctx, q, a, acc.Team.ID, kbID, true)
		if err != nil {
			return err
		}
		src, err := q.GetSource(ctx, sourceID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && src.TeamID.Valid && src.TeamID.UUID != acc.Team.ID) {
			return apperr.NotFound("source_not_found", "Data source not found")
		} else if err != nil {
			return err
		}
		shared := !src.TeamID.Valid
		action := "kb.source_detach"
		if attach {
			action = "kb.source_attach"
			if err := s.attach(ctx, q, a, acc, kb, src); err != nil {
				return err
			}
		} else if _, err := q.DetachSource(ctx, dbgen.DetachSourceParams{KBID: kbID, SourceID: sourceID}); err != nil {
			return err
		}
		e := a.Audit(action, "knowledge_base", kbID.String())
		e.TeamID, e.Metadata = acc.Team.ID, mergeMeta(e.Metadata, map[string]any{"sourceId": sourceID.String(), "sourceName": src.Name, "shared": shared})
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		out, err = s.withSources(ctx, q, []dbgen.KnowledgeBase{kb})
		return err
	})
	if err != nil {
		return KB{}, err
	}
	return out[0], nil
}

// attach checks and attaches a source: the KB's embedding profile, the
// team's approval for a shared source's classification (ADR-0006 rule 2)
// and the published agents' ceilings (rule 6); a source attached during a
// profile migration joins it.
func (s *Service) attach(ctx context.Context, q *dbgen.Queries, a authz.Actor, acc teams.Access, kb dbgen.KnowledgeBase, src dbgen.DataSource) error {
	if err := checkSourceProfile(ctx, q, src, kb); err != nil {
		return err
	}
	if !src.TeamID.Valid {
		srcLevel, err := q.GetClassification(ctx, src.Classification)
		if err != nil {
			return err
		}
		teamLevel, err := q.GetClassification(ctx, acc.Team.MaxClassification)
		if err != nil {
			return err
		}
		if srcLevel.Rank > teamLevel.Rank {
			return apperr.Invalid("classification_not_approved",
				"This team is not approved for data at the shared source's classification")
		}
	}
	// ADR-0006 rule 6: attaching a source at a higher classification
	// raises the KB's effective rank; it must not break rules 4-5 for
	// published agents that use this KB. (Checking at the source's
	// level is enough: agents already serve the KB's current rank.)
	agents, err := sources.AgentImpactOf(ctx, q, src.Classification, uuid.Nil, kb.ID)
	if err != nil {
		return err
	}
	if len(agents) > 0 {
		return &sources.ImpactError{Classification: src.Classification, Agents: agents}
	}
	if _, err := q.AttachSource(ctx, dbgen.AttachSourceParams{KBID: kb.ID, SourceID: src.ID, AddedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}}); err != nil {
		return err
	}
	return joinMigration(ctx, q, kb.ID, src)
}

// withoutKB removes a KB from an agent draft's "kbs" list.
func withoutKB(draft json.RawMessage, kbID uuid.UUID) json.RawMessage {
	var m map[string]json.RawMessage
	if json.Unmarshal(draft, &m) != nil {
		return draft
	}
	var list []map[string]any
	if json.Unmarshal(m["kbs"], &list) != nil {
		return draft
	}
	kept := make([]map[string]any, 0, len(list))
	for _, e := range list {
		if id, _ := e["kbId"].(string); id != kbID.String() {
			kept = append(kept, e)
		}
	}
	m["kbs"], _ = json.Marshal(kept)
	out, err := json.Marshal(m)
	if err != nil {
		return draft
	}
	return out
}

func mergeMeta(a, b map[string]any) map[string]any {
	if a == nil {
		return b
	}
	for k, v := range b {
		a[k] = v
	}
	return a
}

// checkSourceProfile requires a source to have the KB's embedding profile
// so the KB never mixes vector spaces (ADR-0007): its own profile, or vectors
// for it from a profile migration (a shared source).
func checkSourceProfile(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, kb dbgen.KnowledgeBase) error {
	ok, err := q.SourceHasProfile(ctx, dbgen.SourceHasProfileParams{SourceID: src.ID, ProfileID: kb.EmbeddingProfileID})
	if err != nil {
		return err
	}
	if !ok {
		return apperr.Invalid("profile_mismatch",
			"This source uses a different embedding profile than the knowledge base. All sources in a knowledge base must share one profile.")
	}
	return nil
}

// joinMigration gives a source attached during the KB's profile migration
// an embedding set for the target profile; the migration's sweep embeds it
// (docs/phase5-deploy.md §5 P2).
// The caller holds the profile migration lock.
func joinMigration(ctx context.Context, q *dbgen.Queries, kbID uuid.UUID, src dbgen.DataSource) error {
	m, err := q.RunningMigrationForKB(ctx, kbID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && m.ToProfileID == src.EmbeddingProfileID) {
		return nil
	} else if err != nil {
		return err
	}
	_, err = q.InsertEmbeddingSet(ctx, dbgen.InsertEmbeddingSetParams{SourceID: src.ID, ProfileID: m.ToProfileID, Status: "building"})
	return err
}
