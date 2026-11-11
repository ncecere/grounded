package sources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/sourcesync"
	"github.com/ncecere/grounded/internal/sourcetypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/web"
)

// CreateInput creates a source. ProfileID nil uses the platform default.
// Web holds the web configuration (web sources only).
type CreateInput struct {
	Name, Description, Type, Classification string
	ProfileID                               *uuid.UUID
	Web                                     json.RawMessage
	// Connector holds a connector source's settings, credentials and schedule (connector types only).
	Connector   *sourcesync.Settings
	Boilerplate *boilerplate.Settings // overrides; nil = the defaults
	// OCREnabled turns OCR off for the source (nil: on, docs/ocr.md §5).
	OCREnabled *bool
}

func validateText(name, description string) error {
	if n := len(strings.TrimSpace(name)); n < 1 || n > 100 {
		return apperr.Invalid("invalid_name", "Name must be 1-100 characters")
	}
	if len(description) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	return nil
}

// rankOf returns a classification level's rank.
func rankOf(ctx context.Context, q *dbgen.Queries, key string) (int32, error) {
	l, err := q.GetClassification(ctx, key)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return 0, apperr.Invalid("unknown_classification", "Unknown classification level")
	}
	return l.Rank, err
}

// checkClassification enforces ADR-0006 rules 1 (team ceiling; shared
// sources have none) and 4 (the profile's model ceiling) for a source, and
// the level's allowed source types (DESIGN.md §4).
func (s *Service) checkClassification(ctx context.Context, q *dbgen.Queries, sc scope, key, srcType string, profileID uuid.UUID) error {
	level, err := q.GetClassification(ctx, key)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return apperr.Invalid("unknown_classification", "Unknown classification level")
	} else if err != nil {
		return err
	}
	rank := level.Rank
	if !slices.Contains(level.AllowedSourceTypes, srcType) {
		return apperr.Invalid("source_type_not_allowed", fmt.Sprintf("%s data can't be held in a source of this type (%s); a platform admin sets the allowed types per classification", level.Name, srcType))
	}
	if sc.team != nil {
		teamRank, err := rankOf(ctx, q, sc.team.MaxClassification)
		if err != nil {
			return err
		}
		if rank > teamRank {
			return apperr.Invalid("classification_not_approved", "This team is not approved for data at that classification")
		}
	}
	_, err = s.Catalog.ProfileForUse(ctx, q, profileID, rank)
	return err
}

func sourceSnapshot(src dbgen.DataSource) map[string]any {
	m := map[string]any{
		"name": src.Name, "type": src.Type, "classification": src.Classification,
		"embeddingProfileId": src.EmbeddingProfileID, "status": src.Status, "shared": !src.TeamID.Valid,
		"ocrEnabled": src.OcrEnabled,
	}
	if src.Type == TypeWeb {
		m["web"] = src.Config
	} else if isConnector(src.Type) {
		m["config"] = src.Config // a connector's settings hold no credential: those are stored apart, encrypted
	}
	return m
}

// Create adds a source. A web source's first crawl starts in the same
// transaction (trigger "create").
func (s *Service) Create(ctx context.Context, a authz.Actor, o Owner, in CreateInput) (Summary, error) {
	sc, in, config, err := s.prepareCreate(ctx, a, o, in)
	if err != nil {
		return Summary{}, err
	}
	var out Summary
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		out, err = s.insert(ctx, q, tx, a, sc, in, config, true)
		return err
	})
	if err != nil {
		return out, err
	}
	if isConnector(out.Source.Type) {
		return s.summary(ctx, out.Source) // with its connector settings and first sync
	}
	bp, err := s.boilerplateSummaries(ctx, []dbgen.DataSource{out.Source}, []uuid.UUID{out.Source.ID})
	out.Boilerplate = bp[out.Source.ID]
	return out, err
}

// CreateImportedTx makes a source from a configuration file inside the caller's transaction, with every check Create
// makes, except that it never starts a crawl and the source starts paused (docs/specs/config-as-code-import §4).
func (s *Service) CreateImportedTx(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, o Owner, in CreateInput) (dbgen.DataSource, error) {
	sc, in, config, err := s.prepareCreate(ctx, a, o, in)
	if err != nil {
		return dbgen.DataSource{}, err
	}
	out, err := s.insert(ctx, q, tx, a, sc, in, config, false)
	if err != nil {
		return dbgen.DataSource{}, err
	}
	return q.PauseImportedSource(ctx, out.Source.ID)
}

// CheckWebConfig validates a web source's crawl rules for a team as Create would (the crawl allowlist included),
// without saving anything.
func (s *Service) CheckWebConfig(ctx context.Context, teamID uuid.UUID, raw json.RawMessage) error {
	_, err := s.Web.ValidateConfig(ctx, uuid.NullUUID{UUID: teamID, Valid: true}, raw)
	return err
}

func (s *Service) prepareCreate(ctx context.Context, a authz.Actor, o Owner, in CreateInput) (scope, CreateInput, json.RawMessage, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return sc, in, nil, err
	}
	if err := validateNewText(in.Name, in.Description); err != nil {
		return sc, in, nil, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Type == "" {
		in.Type = TypeUpload
	}
	if err := validateBoilerplate(in.Boilerplate); err != nil {
		return sc, in, nil, err
	}
	config, err := s.typeConfig(ctx, sc, in)
	return sc, in, config, err
}

// insert is Create's transaction: limits, profile, classification, the row, OCR, the first crawl (when startCrawl),
// boilerplate overrides and the audit entry.
func (s *Service) insert(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, sc scope, in CreateInput, config json.RawMessage, startCrawl bool) (Summary, error) {
	var out Summary
	if sc.team != nil && s.Limits != nil {
		if err := s.Limits.LockUsage(ctx, q, sc.team.ID); err != nil {
			return out, err
		}
		if err := s.Limits.CheckResources(ctx, q, sc.team.ID, limits.Need{DataSources: 1}); err != nil {
			return out, err
		}
	}
	if on, err := platform.SourceTypeEnabled(ctx, q, in.Type); err != nil {
		return out, err
	} else if !on {
		return out, errTypeOff
	}
	profileID, err := s.resolveProfile(ctx, q, in.ProfileID)
	if err != nil {
		return out, err
	}
	if err := s.checkClassification(ctx, q, sc, in.Classification, in.Type, profileID); err != nil {
		return out, err
	}
	src, err := q.InsertSource(ctx, dbgen.InsertSourceParams{
		TeamID: sc.teamID(), Name: in.Name, Description: in.Description,
		Type: in.Type, Config: config, Classification: in.Classification,
		EmbeddingProfileID: profileID, CreatedBy: a.NullUser(),
	})
	if sc.nameTaken(err) {
		return out, sc.nameTakenErr()
	} else if err != nil {
		return out, err
	}
	if in.OCREnabled != nil && !*in.OCREnabled {
		if err := q.SetSourceOCR(ctx, dbgen.SetSourceOCRParams{ID: src.ID, OcrEnabled: false}); err != nil {
			return out, err
		}
		src.OcrEnabled = false
	}
	out.Source = src
	if src.Type == TypeWeb && startCrawl {
		cr, err := s.Web.StartRun(ctx, tx, src, web.TriggerCreate, a.UserID)
		if err != nil {
			return out, err
		}
		out.ActiveCrawl = &cr
	}
	if isConnector(src.Type) {
		if out.ActiveSync, err = s.attachConnector(ctx, q, tx, a, src, in, startCrawl); err != nil {
			return out, err
		}
	}
	return out, s.recordCreate(ctx, q, tx, a, sc, src, in.Boilerplate)
}

// errTypeOff refuses a new source of a type a platform admin has turned off.
var errTypeOff = apperr.Conflict("source_type_off", "This source type is turned off. A platform admin turns source types on and off.")

// typeConfig validates the type-specific configuration of a new source.
func (s *Service) typeConfig(ctx context.Context, sc scope, in CreateInput) (json.RawMessage, error) {
	if in.Connector != nil && !isConnector(in.Type) {
		return nil, errNotConnector
	}
	if in.Type != TypeWeb && len(in.Web) > 0 && string(in.Web) != "null" {
		return nil, apperr.Invalid("invalid_web_config", "Only web sources take a web configuration")
	}
	if _, ok := connector.Get(in.Type); ok {
		return s.connectorConfig(sc, in)
	}
	switch in.Type {
	case TypeUpload:
		return json.RawMessage(`{}`), nil
	case TypeWeb:
		cfg, err := s.Web.ValidateConfig(ctx, sc.teamID(), in.Web)
		if err != nil {
			return nil, err
		}
		return cfg.JSON(), nil
	}
	return nil, apperr.Invalid("unsupported_type", "type must be one of: "+strings.Join(sourcetypes.Keys(), ", "))
}

// recordCreate stores a new source's boilerplate overrides and audits it.
func (s *Service) recordCreate(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, sc scope, src dbgen.DataSource, bp *boilerplate.Settings) error {
	e := a.Audit("source.create", "data_source", src.ID.String())
	after := sourceSnapshot(src)
	e.TeamID, e.After = sc.auditTeam(), after
	if bp != nil && !bp.IsZero() {
		after["boilerplate"] = *bp
		if err := s.setBoilerplate(ctx, q, tx, a, sc, src, bp); err != nil {
			return err
		}
	}
	return audit.Record(ctx, q, e)
}

func (s *Service) resolveProfile(ctx context.Context, q *dbgen.Queries, id *uuid.UUID) (uuid.UUID, error) {
	if id != nil {
		return *id, nil
	}
	profiles, err := q.ListEmbeddingProfiles(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	for _, p := range profiles {
		if p.EmbeddingProfile.IsDefault {
			return p.EmbeddingProfile.ID, nil
		}
	}
	return uuid.Nil, apperr.Invalid("no_default_profile", "No default embedding profile is configured. Ask a platform admin.")
}
