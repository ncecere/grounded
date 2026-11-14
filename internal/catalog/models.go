package catalog

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func modelSnapshot(m dbgen.Model) map[string]any {
	return map[string]any{
		"key": m.Key, "kind": m.Kind, "connectionId": m.ConnectionID, "upstreamModel": m.UpstreamModel,
		"displayName": m.DisplayName, "maxClassification": m.MaxClassification, "enabled": m.Enabled,
		"contextWindow": m.ContextWindow, "maxOutputTokens": m.MaxOutputTokens,
		"supportsTools": m.SupportsTools, "supportsVision": m.SupportsVision,
		"dimensions": m.Dimensions, "maxInputTokens": m.MaxInputTokens, "compat": m.Compat,
		"moderationProvider": m.ModerationProvider, "moderationFamily": m.ModerationFamily,
		"moderationTimeoutSeconds": m.ModerationTimeoutSeconds,
	}
}

// ModelFilter narrows ListModels.
type ModelFilter struct {
	Kind         *string
	ConnectionID *uuid.UUID
}

func (s *Service) ListModels(ctx context.Context, a authz.Actor, f ModelFilter) ([]dbgen.Model, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	p := dbgen.ListModelsParams{Kind: f.Kind}
	if f.ConnectionID != nil {
		p.ConnectionID = uuid.NullUUID{UUID: *f.ConnectionID, Valid: true}
	}
	return s.q.ListModels(ctx, p)
}

func (s *Service) GetModel(ctx context.Context, a authz.Actor, id uuid.UUID) (dbgen.Model, error) {
	if !a.CanReadPlatform() {
		return dbgen.Model{}, errReadOnly
	}
	m, err := s.q.GetModel(ctx, id)
	return m, notFound(err, errNoModel)
}

func (s *Service) CreateModel(ctx context.Context, a authz.Actor, in ModelInput) (dbgen.Model, error) {
	if !a.IsPlatformAdmin() {
		return dbgen.Model{}, errAdminOnly
	}
	if !keyRE.MatchString(in.Key) {
		return dbgen.Model{}, apperr.Invalid("invalid_key", "Key must be 1-63 lowercase letters, digits, dots, dashes or underscores")
	}
	if !validKinds[in.Kind] {
		return dbgen.Model{}, apperr.Invalid("invalid_kind", "Kind must be chat, embedding, rerank, moderation, systemone or vision")
	}
	var out dbgen.Model
	err := s.inTx(ctx, func(q *dbgen.Queries, _ pgx.Tx) error {
		if _, err := q.GetConnection(ctx, in.ConnectionID); err != nil {
			return notFound(err, apperr.Invalid("unknown_connection", "Unknown model connection"))
		}
		if err := normalizeSpec(ctx, q, in.Kind, &in.ModelSpec); err != nil {
			return err
		}
		compat, _ := json.Marshal(in.Compat)
		var err error
		out, err = q.InsertModel(ctx, dbgen.InsertModelParams{
			ConnectionID: in.ConnectionID, Key: in.Key, UpstreamModel: in.UpstreamModel, DisplayName: in.DisplayName,
			Description: in.Description, Kind: in.Kind, MaxClassification: in.MaxClassification, Enabled: in.Enabled,
			ContextWindow: in.ContextWindow, MaxOutputTokens: in.MaxOutputTokens,
			SupportsTools: in.SupportsTools, SupportsVision: in.SupportsVision,
			Dimensions: in.Dimensions, MaxInputTokens: in.MaxInputTokens, Compat: compat,
			ModerationProvider: optional(in.ModerationProvider), ModerationFamily: optional(in.ModerationFamily),
			ModerationTimeoutSeconds: in.ModerationTimeoutSeconds,
			CreatedBy:                uuid.NullUUID{UUID: a.UserID, Valid: true},
		})
		switch {
		case apperr.IsUniqueViolation(err, "models_key_key"):
			return apperr.Conflict("key_taken", "A model with that key already exists")
		case apperr.IsUniqueViolation(err, "models_connection_upstream_kind_key"):
			return apperr.Conflict("model_exists", "That upstream model is already added for this connection and kind")
		case err != nil:
			return err
		}
		e := a.Audit("platform.model_create", "model", out.ID.String())
		e.After = modelSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// specUpdate applies the changes in to the model's current spec.
func specUpdate(cur dbgen.Model, in ModelUpdate) ModelSpec {
	spec := ModelSpec{
		UpstreamModel: cur.UpstreamModel, DisplayName: cur.DisplayName, Description: cur.Description,
		MaxClassification: cur.MaxClassification, Enabled: cur.Enabled,
		ContextWindow: cur.ContextWindow, MaxOutputTokens: cur.MaxOutputTokens,
		SupportsTools: cur.SupportsTools, SupportsVision: cur.SupportsVision,
		Dimensions: cur.Dimensions, MaxInputTokens: cur.MaxInputTokens, Compat: DecodeCompat(cur.Compat),
		ModerationProvider: deref(cur.ModerationProvider), ModerationFamily: deref(cur.ModerationFamily),
		ModerationTimeoutSeconds: cur.ModerationTimeoutSeconds,
	}
	setValue(&spec.UpstreamModel, in.UpstreamModel)
	setValue(&spec.DisplayName, in.DisplayName)
	setValue(&spec.Description, in.Description)
	setValue(&spec.MaxClassification, in.MaxClassification)
	setValue(&spec.Enabled, in.Enabled)
	setPointer(&spec.ContextWindow, in.ContextWindow)
	setPointer(&spec.MaxOutputTokens, in.MaxOutputTokens)
	setValue(&spec.SupportsTools, in.SupportsTools)
	setValue(&spec.SupportsVision, in.SupportsVision)
	setPointer(&spec.Dimensions, in.Dimensions)
	setPointer(&spec.MaxInputTokens, in.MaxInputTokens)
	setValue(&spec.Compat, in.Compat)
	setValue(&spec.ModerationProvider, in.ModerationProvider)
	setValue(&spec.ModerationFamily, in.ModerationFamily)
	if in.ModerationTimeoutSeconds != nil {
		spec.ModerationTimeoutSeconds = in.ModerationTimeoutSeconds
		if *in.ModerationTimeoutSeconds == 0 {
			spec.ModerationTimeoutSeconds = nil
		}
	}
	return spec
}

// setValue sets *dst to *v when v is given.
func setValue[T any](dst *T, v *T) {
	if v != nil {
		*dst = *v
	}
}

// setPointer replaces the optional *dst with v when v is given.
func setPointer[T any](dst **T, v *T) {
	if v != nil {
		*dst = v
	}
}

func (s *Service) UpdateModel(ctx context.Context, a authz.Actor, id uuid.UUID, in ModelUpdate, expectedRevision int64) (dbgen.Model, error) {
	if !a.IsPlatformAdmin() {
		return dbgen.Model{}, errAdminOnly
	}
	var out dbgen.Model
	err := s.inTx(ctx, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockModel(ctx, id)
		if err != nil {
			return notFound(err, errNoModel)
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		spec := specUpdate(cur, in)
		if err := normalizeSpec(ctx, q, cur.Kind, &spec); err != nil {
			return err
		}
		// Vectors already produced by an embedding model would silently stop
		// matching if the upstream model or its dimensions changed.
		if cur.Kind == KindEmbedding && (spec.UpstreamModel != cur.UpstreamModel || *spec.Dimensions != *cur.Dimensions) {
			n, err := q.CountModelProfiles(ctx, id)
			if err != nil {
				return err
			}
			if n > 0 {
				return apperr.Conflict("model_in_use",
					"This embedding model is used by an embedding profile, so its upstream model and dimensions cannot change. Add a new model and profile instead.")
			}
		}
		// Phase 1/3: lowering max_classification or disabling a model must be
		// checked against the sources, profiles and agents that use it.
		compat, _ := json.Marshal(spec.Compat)
		if out, err = q.UpdateModel(ctx, dbgen.UpdateModelParams{
			ID: id, UpstreamModel: spec.UpstreamModel, DisplayName: spec.DisplayName, Description: spec.Description,
			MaxClassification: spec.MaxClassification, Enabled: spec.Enabled,
			ContextWindow: spec.ContextWindow, MaxOutputTokens: spec.MaxOutputTokens,
			SupportsTools: spec.SupportsTools, SupportsVision: spec.SupportsVision,
			Dimensions: spec.Dimensions, MaxInputTokens: spec.MaxInputTokens, Compat: compat,
			ModerationProvider: optional(spec.ModerationProvider), ModerationFamily: optional(spec.ModerationFamily),
			ModerationTimeoutSeconds: spec.ModerationTimeoutSeconds,
		}); err != nil {
			return err
		}
		e := a.Audit("platform.model_update", "model", id.String())
		e.Before, e.After = modelSnapshot(cur), modelSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

func (s *Service) DeleteModel(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return s.inTx(ctx, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockModel(ctx, id)
		if err != nil {
			return notFound(err, errNoModel)
		}
		if err := q.DeleteModel(ctx, id); apperr.IsForeignKeyViolation(err, "") {
			return apperr.Conflict("model_in_use", "This model is in use. Disable it instead.")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.model_delete", "model", id.String())
		e.Before = modelSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}
