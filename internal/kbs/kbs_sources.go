package kbs

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/requestcache"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

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
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		return s.changeSourcesIn(ctx, q, tx, a, acc, kbID, sourceID, attach, &out)
	})
	if err != nil {
		return KB{}, err
	}
	return out[0], nil
}

// changeSourcesIn attaches or detaches a source inside a transaction.
func (s *Service) changeSourcesIn(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, acc teams.Access, kbID, sourceID uuid.UUID, attach bool, out *[]KB) error {
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
	e.TeamID, e.Metadata = acc.Team.ID, audit.MergeMeta(e.Metadata, map[string]any{"sourceId": sourceID.String(), "sourceName": src.Name, "shared": shared})
	if err := audit.Record(ctx, q, e); err != nil {
		return err
	}
	*out, err = s.withSources(ctx, q, []dbgen.KnowledgeBase{kb})
	return err
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

// joinMigration gives a source attached during the KB's profile migration (running, or held and ready) an
// embedding set for the target profile; the migration's sweep embeds it
// (docs/phase5-deploy.md §5 P2).
// The caller holds the profile migration lock.
func joinMigration(ctx context.Context, q *dbgen.Queries, kbID uuid.UUID, src dbgen.DataSource) error {
	m, err := q.BuildingMigrationForKB(ctx, kbID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && m.ToProfileID == src.EmbeddingProfileID) {
		return nil
	} else if err != nil {
		return err
	}
	_, err = q.InsertEmbeddingSet(ctx, dbgen.InsertEmbeddingSetParams{SourceID: src.ID, ProfileID: m.ToProfileID, Status: "building"})
	return err
}

// restrictedKey is the answer for a set of sources in a request's cache.
type restrictedKey struct{ sources string }

// SourcesHaveRestricted reports whether any of the sources has (or had) a restricted document.
// An answer asks for all its knowledge bases' sources and then each search asks for its own: a request that keeps a
// cache (requestcache) asks once per set of sources. Permissions themselves are checked on every read of passage text.
func (s *Service) SourcesHaveRestricted(ctx context.Context, ids []uuid.UUID) (bool, error) {
	return requestcache.Get(ctx, restrictedKey{sourceSet(ids)}, func() (bool, error) { return s.q.SourcesHaveRestricted(ctx, ids) })
}

// sourceSet names a set of sources whatever their order, as a cache key.
func sourceSet(ids []uuid.UUID) string {
	key := make([]string, len(ids))
	for i, id := range ids {
		key[i] = id.String()
	}
	slices.Sort(key)
	return strings.Join(key, ",")
}
