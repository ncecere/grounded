package platform

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var classificationKeyRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,31}$`)

// ListClassifications is available to every signed-in user: teams need the
// levels to classify their sources.
func (s *Service) ListClassifications(ctx context.Context) ([]dbgen.ClassificationLevel, error) {
	return s.q.ListClassifications(ctx)
}

// ClassificationInput creates a level. Rank is fixed after creation.
type ClassificationInput struct {
	Key, Name, Description, MaxAudience string
	Rank                                int32
}

// ClassificationUpdate holds optional changes.
type ClassificationUpdate struct {
	Name, Description, MaxAudience *string
	// AnonymousRetentionHours keeps anonymous conversations of agents at
	// this level (1 hour to 100 years; ADR-0010).
	AnonymousRetentionHours *int32
	// ConversationRetentionDays keeps signed-in conversations (1 day to 100
	// years); ClearConversationRetention keeps them until deleted.
	ConversationRetentionDays  *int32
	ClearConversationRetention bool
	// AllowedSourceTypes may hold data at this level (upload, web).
	AllowedSourceTypes []string
	// DirectRetrieve lets team API keys call /retrieve on KBs at this level.
	DirectRetrieve *bool
}

// SourceTypes are the data source types a level can allow.
var SourceTypes = []string{"upload", "web"}

// applySettings copies the DESIGN §4 per-level settings from in onto next and validates them.
func applySettings(next *dbgen.ClassificationLevel, in ClassificationUpdate) error {
	if in.AnonymousRetentionHours != nil {
		next.AnonymousRetentionHours = *in.AnonymousRetentionHours
	}
	if next.AnonymousRetentionHours < 1 || next.AnonymousRetentionHours > 876000 {
		return apperr.Invalid("invalid_retention", "Anonymous retention must be between 1 hour and 876000 hours")
	}
	if in.ClearConversationRetention {
		next.ConversationRetentionDays = nil
	} else if in.ConversationRetentionDays != nil {
		if d := *in.ConversationRetentionDays; d < 1 || d > 36500 {
			return apperr.Invalid("invalid_retention", "Conversation retention must be between 1 and 36500 days")
		}
		next.ConversationRetentionDays = in.ConversationRetentionDays
	}
	if in.AllowedSourceTypes != nil {
		seen := map[string]bool{}
		types := []string{}
		for _, t := range in.AllowedSourceTypes {
			if !slices.Contains(SourceTypes, t) {
				return apperr.Invalid("invalid_source_type", "Allowed source types are upload and web")
			}
			if !seen[t] {
				seen[t] = true
				types = append(types, t)
			}
		}
		if len(types) == 0 {
			return apperr.Invalid("invalid_source_type", "Allow at least one source type")
		}
		next.AllowedSourceTypes = types
	}
	if in.DirectRetrieve != nil {
		next.DirectRetrieve = *in.DirectRetrieve
	}
	return nil
}

func validateLevel(name, description, maxAudience string) error {
	if n := len(strings.TrimSpace(name)); n < 1 || n > 64 {
		return apperr.Invalid("invalid_name", "Name must be 1-64 characters")
	}
	if len(description) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	if !authz.ValidAudience(maxAudience) {
		return apperr.Invalid("invalid_audience", "Maximum audience must be team, all_authenticated or public")
	}
	return nil
}

// checkOrdering verifies the full set of levels after a change.
func checkOrdering(levels []dbgen.ClassificationLevel, changed dbgen.ClassificationLevel) error {
	out := make([]authz.Level, 0, len(levels)+1)
	inserted := false
	for _, l := range levels {
		if l.Key == changed.Key {
			continue
		}
		if !inserted && changed.Rank < l.Rank {
			out = append(out, authz.Level{Key: changed.Key, Rank: changed.Rank, MaxAudience: changed.MaxAudience})
			inserted = true
		}
		out = append(out, authz.Level{Key: l.Key, Rank: l.Rank, MaxAudience: l.MaxAudience})
	}
	if !inserted {
		out = append(out, authz.Level{Key: changed.Key, Rank: changed.Rank, MaxAudience: changed.MaxAudience})
	}
	return authz.CheckLevelOrdering(out)
}

func levelSnapshot(l dbgen.ClassificationLevel) map[string]any {
	return map[string]any{"key": l.Key, "name": l.Name, "description": l.Description, "rank": l.Rank, "maxAudience": l.MaxAudience,
		"anonymousRetentionHours": l.AnonymousRetentionHours, "conversationRetentionDays": l.ConversationRetentionDays,
		"allowedSourceTypes": l.AllowedSourceTypes, "directRetrieve": l.DirectRetrieve}
}

func (s *Service) CreateClassification(ctx context.Context, a authz.Actor, in ClassificationInput) (dbgen.ClassificationLevel, error) {
	if !a.IsPlatformAdmin() {
		return dbgen.ClassificationLevel{}, errAdminOnly
	}
	if !classificationKeyRE.MatchString(in.Key) {
		return dbgen.ClassificationLevel{}, apperr.Invalid("invalid_key", "Key must be 2-32 lowercase letters, digits or underscores, starting with a letter")
	}
	if in.Rank < 0 || in.Rank > 1000 {
		return dbgen.ClassificationLevel{}, apperr.Invalid("invalid_rank", "Rank must be between 0 and 1000")
	}
	in.Name = strings.TrimSpace(in.Name)
	if err := validateLevel(in.Name, in.Description, in.MaxAudience); err != nil {
		return dbgen.ClassificationLevel{}, err
	}
	var out dbgen.ClassificationLevel
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockClassificationConfig(ctx); err != nil {
			return err
		}
		levels, err := q.ListClassifications(ctx)
		if err != nil {
			return err
		}
		for _, l := range levels {
			if l.Key == in.Key {
				return apperr.Conflict("key_taken", "A classification level with that key already exists")
			}
			if l.Rank == in.Rank {
				return apperr.Conflict("rank_taken", "Another level already has that rank")
			}
		}
		candidate := dbgen.ClassificationLevel{Key: in.Key, Rank: in.Rank, MaxAudience: in.MaxAudience}
		if err := checkOrdering(levels, candidate); err != nil {
			return err
		}
		if out, err = q.InsertClassification(ctx, dbgen.InsertClassificationParams{
			Key: in.Key, Name: in.Name, Description: in.Description, Rank: in.Rank, MaxAudience: in.MaxAudience,
		}); err != nil {
			return err
		}
		e := a.Audit("platform.classification_create", "classification", out.Key)
		e.After = levelSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

func (s *Service) UpdateClassification(ctx context.Context, a authz.Actor, key string, in ClassificationUpdate, expectedRevision int64) (dbgen.ClassificationLevel, error) {
	if !a.IsPlatformAdmin() {
		return dbgen.ClassificationLevel{}, errAdminOnly
	}
	var out dbgen.ClassificationLevel
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockClassificationConfig(ctx); err != nil {
			return err
		}
		cur, err := q.GetClassification(ctx, key)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return apperr.NotFound("classification_not_found", "Classification level not found")
		} else if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		next := cur
		if in.Name != nil {
			next.Name = strings.TrimSpace(*in.Name)
		}
		if in.Description != nil {
			next.Description = *in.Description
		}
		if in.MaxAudience != nil {
			next.MaxAudience = *in.MaxAudience
		}
		if err := validateLevel(next.Name, next.Description, next.MaxAudience); err != nil {
			return err
		}
		if err := applySettings(&next, in); err != nil {
			return err
		}
		levels, err := q.ListClassifications(ctx)
		if err != nil {
			return err
		}
		if err := checkOrdering(levels, next); err != nil {
			return err
		}
		// Narrowing max_audience is rejected while published agents at this
		// level use a wider audience (ADR-0006 rules 5 and 6).
		if err := checkAudienceImpact(ctx, q, levels, next); err != nil {
			return err
		}
		if out, err = q.UpdateClassification(ctx, dbgen.UpdateClassificationParams{
			Key: key, Name: next.Name, Description: next.Description, MaxAudience: next.MaxAudience,
			RetentionHours: next.AnonymousRetentionHours, ConversationRetentionDays: next.ConversationRetentionDays,
			AllowedSourceTypes: next.AllowedSourceTypes, DirectRetrieve: next.DirectRetrieve,
		}); err != nil {
			return err
		}
		e := a.Audit("platform.classification_update", "classification", key)
		e.Before, e.After = levelSnapshot(cur), levelSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// checkAudienceImpact refuses to narrow a level's max_audience while a live
// published agent whose effective rank falls on that level uses a wider
// audience; the error names the agents (ADR-0006 rule 6: nothing is
// silently unpublished).
func checkAudienceImpact(ctx context.Context, q *dbgen.Queries, levels []dbgen.ClassificationLevel, next dbgen.ClassificationLevel) error {
	rows, err := q.PublishedAgentAudiences(ctx)
	if err != nil {
		return err
	}
	var affected []map[string]any
	for _, r := range rows {
		if levelKeyAt(levels, r.EffectiveRank) != next.Key || authz.AudienceAllowed(r.Audience, next.MaxAudience) {
			continue
		}
		affected = append(affected, map[string]any{"agentId": r.ID, "name": r.Name, "team": r.TeamSlug, "audience": r.Audience})
	}
	if len(affected) == 0 {
		return nil
	}
	return &apperr.Error{Status: 409, Code: "classification_impact",
		Message: "Published agents at this level use a wider audience. Their teams must publish them to a narrower audience first.",
		Details: map[string]any{"agents": affected}}
}

// levelKeyAt is the key of the level that applies at rank (the highest
// level at or below it).
func levelKeyAt(levels []dbgen.ClassificationLevel, rank int32) string {
	key := ""
	for _, l := range levels { // sorted by rank
		if l.Rank <= rank {
			key = l.Key
		}
	}
	return key
}
