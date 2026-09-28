// The preflight: what moving a KB to a profile involves (sources,
// documents, passages, embedding calls, tokens and time at the target
// connection's request limit) and what blocks it.

package profilemig

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Issue is a blocker or a warning.
type Issue struct{ Code, Message string }

// PreflightSource is one source's figures.
type PreflightSource struct {
	ID                  uuid.UUID
	Name                string
	Shared              bool
	OtherKBs            int64
	Documents, Passages int64
	Tokens              int64
	InProgress, Failed  int64
	AlreadyEmbedded     bool
}

// Preflight is the start page of a migration.
type Preflight struct {
	KB               dbgen.KnowledgeBase
	TeamSlug         string
	TeamName         string
	From             catalog.Profile
	Target           catalog.Profile
	TargetCeiling    string
	Sources          []PreflightSource
	Estimate         Estimate
	Blockers         []Issue
	Warnings         []Issue
	Maintenance      bool
	DefaultGraceDays int
}

// maintenanceHint: above this many passages the preflight suggests
// maintenance mode, which pauses new ingestion (optional).
const maintenanceHint = 10_000

// Preflight describes moving a KB to a profile. It changes nothing.
func (s *Service) Preflight(ctx context.Context, a authz.Actor, kbID, targetID uuid.UUID) (Preflight, error) {
	if !a.CanReadPlatform() {
		return Preflight{}, errReadOnly
	}
	pf := Preflight{DefaultGraceDays: s.Opts.GraceDays}
	kb, err := s.q.GetKB(ctx, kbID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return pf, apperr.NotFound("kb_not_found", "Knowledge base not found")
	} else if err != nil {
		return pf, err
	}
	pf.KB = kb
	team, err := s.q.GetTeamByID(ctx, kb.TeamID)
	if err != nil {
		return pf, err
	}
	pf.TeamSlug, pf.TeamName = team.Slug, team.Name
	if pf.From, err = s.profile(ctx, kb.EmbeddingProfileID); err != nil {
		return pf, err
	}
	if pf.Target, err = s.profile(ctx, targetID); errors.Is(err, errNoProfile) {
		return pf, apperr.NotFound("profile_not_found", "Embedding profile not found")
	} else if err != nil {
		return pf, err
	}
	pf.TargetCeiling = pf.Target.Model.MaxClassification
	if err := s.figures(ctx, &pf); err != nil {
		return pf, err
	}
	if err := s.blockers(ctx, &pf); err != nil {
		return pf, err
	}
	st, err := platform.Maintenance(ctx, s.Pool)
	if err != nil {
		return pf, err
	}
	pf.Maintenance = st.Enabled
	s.warnings(&pf)
	return pf, nil
}

var errNoProfile = errors.New("no such profile")

func (s *Service) profile(ctx context.Context, id uuid.UUID) (catalog.Profile, error) {
	row, err := s.q.GetEmbeddingProfile(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return catalog.Profile{}, errNoProfile
	}
	return catalog.Profile{EmbeddingProfile: row.EmbeddingProfile, Model: row.Model}, err
}

func chunkingOf(p catalog.Profile) ingest.Chunking {
	maxInput := 0
	if p.Model.MaxInputTokens != nil {
		maxInput = int(*p.Model.MaxInputTokens)
	}
	return ingest.ChunkingOf(p.EmbeddingProfile, maxInput)
}

// figures fills in the sources and the estimate.
func (s *Service) figures(ctx context.Context, pf *Preflight) error {
	c := chunkingOf(pf.Target)
	rows, err := s.q.KBSourceFigures(ctx, dbgen.KBSourceFiguresParams{KBID: pf.KB.ID, ProfileID: pf.Target.ID, Step: int32(max(c.MaxTokens-c.Overlap, 1))})
	if err != nil {
		return err
	}
	est := &pf.Estimate
	est.Rechunk = chunkingOf(pf.From) != c
	var cut int64
	for _, r := range rows {
		src := PreflightSource{ID: r.ID, Name: r.Name, Shared: r.Shared, OtherKBs: r.OtherKbs, Documents: r.ReadyDocuments,
			Passages: r.Passages, Tokens: r.Tokens, InProgress: r.InProgress, Failed: r.FailedDocuments,
			AlreadyEmbedded: r.EmbeddingProfileID == pf.Target.ID || r.SetStatus == "ready"}
		pf.Sources = append(pf.Sources, src)
		if !src.AlreadyEmbedded {
			est.Documents += src.Documents
			est.Passages += src.Passages
			est.Tokens += src.Tokens
			cut += r.CutPassages
		}
	}
	if est.Rechunk {
		est.Passages = cut
	}
	// A request carries the passages of the documents in flight: at most
	// setParallel documents per source at a time.
	est.EmbeddingCalls = max(ceilDiv(est.Passages, int64(s.Opts.BatchSize)), ceilDiv(est.Documents, setParallel))
	if s.Opts.BatchTokens > 0 {
		est.EmbeddingCalls = max(est.EmbeddingCalls, ceilDiv(est.Tokens, int64(s.Opts.BatchTokens)))
	}
	conn, err := s.q.GetConnection(ctx, pf.Target.Model.ConnectionID)
	if err != nil {
		return err
	}
	if rpm := conn.RequestsPerMinute; rpm != nil && *rpm > 0 {
		est.RequestsPerMinute = rpm
		minutes := float64(est.EmbeddingCalls) / float64(*rpm)
		est.Minutes = &minutes
	}
	return nil
}

func ceilDiv(a, b int64) int64 {
	if b <= 0 || a <= 0 {
		return 0
	}
	return (a + b - 1) / b
}

// storageLimit is pgvector's HNSW dimension limit per storage type.
var storageLimit = map[string]int32{"halfvec": 4000, "vector": 2000}

// blockers lists what prevents the migration.
func (s *Service) blockers(ctx context.Context, pf *Preflight) error {
	t := pf.Target
	add := func(code, msg string) { pf.Blockers = append(pf.Blockers, Issue{code, msg}) }
	if t.ID == pf.KB.EmbeddingProfileID {
		add("same_profile", "The knowledge base already uses this profile.")
	}
	if t.Status != catalog.ProfileActive {
		add("profile_retired", "The target profile is retired. Make it active first.")
	}
	conn, err := s.q.GetConnection(ctx, t.Model.ConnectionID)
	if err != nil {
		return err
	}
	if !t.Model.Enabled || !conn.Enabled {
		add("profile_unusable", "The target profile's model or its connection is disabled.")
	}
	if limit, ok := storageLimit[t.StorageType]; !ok || t.Dimensions > limit || (t.Model.Dimensions != nil && t.Dimensions > *t.Model.Dimensions) {
		add("dimensions", fmt.Sprintf("The target profile stores %d dimensions, more than its model or %s indexes allow.", t.Dimensions, t.StorageType))
	}
	rank, err := s.q.KBMaxRank(ctx, pf.KB.ID)
	if err != nil {
		return err
	}
	ceiling, err := s.q.GetClassification(ctx, t.Model.MaxClassification)
	if err != nil {
		return err
	}
	if rank > ceiling.Rank {
		add("model_classification", fmt.Sprintf("The knowledge base holds data above %s, the highest classification the target profile's model may process.", ceiling.Name))
	}
	active, err := s.q.ListProfileMigrationViews(ctx, dbgen.ListProfileMigrationViewsParams{
		KBID: uuid.NullUUID{UUID: pf.KB.ID, Valid: true}, ActiveOnly: true, MaxRows: 1})
	if err != nil {
		return err
	}
	if len(active) > 0 {
		msg := "Another migration of this knowledge base is running."
		if active[0].ProfileMigration.Status == StatusSwitched {
			msg = "The last migration of this knowledge base is in its grace period. Finish it (delete the old vectors) or switch back first."
		}
		add("migration_active", msg)
	}
	return nil
}

// warnings lists what the admin should know.
func (s *Service) warnings(pf *Preflight) {
	add := func(code, msg string) { pf.Warnings = append(pf.Warnings, Issue{code, msg}) }
	var shared, inProgress, failed int64
	for _, src := range pf.Sources {
		if src.OtherKBs > 0 {
			shared++
		}
		inProgress += src.InProgress
		failed += src.Failed
	}
	if len(pf.Sources) == 0 {
		add("no_sources", "The knowledge base has no sources: it switches at once.")
	}
	if pf.Estimate.Rechunk {
		c := chunkingOf(pf.Target)
		add("rechunk", fmt.Sprintf("The target cuts passages differently (up to %d tokens, %d overlapping), so they're cut again from the stored parsed text. Nothing is fetched again.", c.MaxTokens, c.Overlap))
	}
	switch {
	case shared == 1:
		add("shared_sources", "1 source is also used by other knowledge bases. It keeps vectors for both profiles until all of them have moved, which uses more storage.")
	case shared > 1:
		add("shared_sources", fmt.Sprintf("%d sources are also used by other knowledge bases. They keep vectors for both profiles until all of them have moved, which uses more storage.", shared))
	}
	if inProgress > 0 {
		add("documents_in_progress", fmt.Sprintf("%d documents are still being processed. They're embedded for both profiles when they finish.", inProgress))
	}
	if failed > 0 {
		add("failed_documents", fmt.Sprintf("%d failed documents aren't indexed, so there is nothing of theirs to move. Retry them on their source.", failed))
	}
	if pf.Estimate.RequestsPerMinute == nil {
		add("no_rate_limit", "The target connection has no request limit, so the time can't be estimated and the migration sends requests as fast as the gateway answers. Set requests per minute on the connection to pace it.")
	}
	if pf.Estimate.Passages > maintenanceHint && !pf.Maintenance {
		add("maintenance_suggested", "This is a large migration. Maintenance mode (optional) pauses new ingestion meanwhile; the migration and chat keep running.")
	}
}
