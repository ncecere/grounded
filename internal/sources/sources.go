// Package sources manages data sources and their documents (ADR-0008): the
// "upload" and "web" types, file uploads, document listings, deletion,
// retries and web syncs. Processing happens in internal/ingest; crawling in
// internal/web.
//
// A source is owned by a team or, for platform-shared sources, by the
// platform (team_id NULL). The same code serves both through Owner: team
// sources are managed by team editors, shared sources by platform admins
// (auditors may read them).
package sources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/web"
)

// Source types.
const (
	TypeUpload = "upload"
	TypeWeb    = "web"
)

type Service struct {
	Pool           *pgxpool.Pool
	Teams          *teams.Service
	Catalog        *catalog.Service
	Blob           blob.Store
	Jobs           *river.Client[pgx.Tx]
	Web            *web.Service
	MaxUploadBytes int64
	// OCR says whether a source's image uploads can be read (nil: never;
	// docs/ocr.md §5a).
	OCR *ocr.Service
	// Limits enforces team limits (nil: none). Shared sources count against
	// no team.
	Limits *limits.Service
	// Notify tells team owners when a source's classification is lowered
	// (nil: nobody).
	Notify *notify.Service
	// BreakGlass lets a platform admin read a team's sources and documents
	// under a break-glass session (nil: never; ADR-0024).
	BreakGlass *breakglass.Service
	// Boilerplate are the platform defaults of repeated-block suppression
	// (ADR-0021).
	Boilerplate boilerplate.Defaults
	// Maintenance refuses uploads and retries while maintenance mode is on
	// (nil: never). Crawls check it in web.StartRun; settings changes that
	// schedule work are allowed, and the work waits (docs/phase5-deploy.md
	// §5 P5).
	Maintenance *platform.MaintenanceGate
	Log         *slog.Logger
	q           *dbgen.Queries
}

func New(pool *pgxpool.Pool, t *teams.Service, c *catalog.Service, b blob.Store, jobs *river.Client[pgx.Tx], w *web.Service, maxUpload int64, log *slog.Logger) *Service {
	return &Service{Pool: pool, Teams: t, Catalog: c, Blob: b, Jobs: jobs, Web: w, MaxUploadBytes: maxUpload, Log: log, q: dbgen.New(pool)}
}

var (
	errNoSource   = apperr.NotFound("source_not_found", "Data source not found")
	errNoDocument = apperr.NotFound("document_not_found", "Document not found")
)

// Owner identifies who owns a set of sources: a team (slug or ID) or the
// platform.
type Owner struct {
	teamRef  string
	platform bool
}

// Team is the owner for a team's sources.
func Team(ref string) Owner { return Owner{teamRef: ref} }

// Platform is the owner of platform-shared sources.
var Platform = Owner{platform: true}

// scope is an owner resolved for an actor.
type scope struct {
	team *dbgen.Team // nil for the platform
	role string      // team role; "" for the platform
}

func (sc scope) teamID() uuid.NullUUID {
	if sc.team == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: sc.team.ID, Valid: true}
}

// auditTeam is the audit entry's team (uuid.Nil for shared sources).
func (sc scope) auditTeam() uuid.UUID {
	if sc.team == nil {
		return uuid.Nil
	}
	return sc.team.ID
}

func (sc scope) nameTaken(err error) bool {
	return apperr.IsUniqueViolation(err, "data_sources_team_name_key") || apperr.IsUniqueViolation(err, "data_sources_platform_name_key")
}

func (sc scope) nameTakenErr() error {
	if sc.team == nil {
		return apperr.Conflict("name_taken", "A shared source with that name already exists")
	}
	return apperr.Conflict("name_taken", "This team already has a data source with that name")
}

// access resolves the owner. Team content is never visible to non-members,
// including platform admins (ADR-0011), except through readAccess. Shared
// sources are read by platform admins and auditors and changed by platform
// admins only.
func (s *Service) access(ctx context.Context, a authz.Actor, o Owner, write bool) (scope, error) {
	return s.accessFor(ctx, a, o, write, nil)
}

// readAccess is access for a read that a platform admin who isn't a member
// may make under a break-glass session with the documents scope (ADR-0024).
// The read is recorded in the audit log when it is authorized, before the
// content is fetched. A read of the team itself (the source list) passes
// an empty TargetID.
func (s *Service) readAccess(ctx context.Context, a authz.Actor, o Owner, r breakglass.Read) (scope, error) {
	return s.accessFor(ctx, a, o, false, &r)
}

func (s *Service) accessFor(ctx context.Context, a authz.Actor, o Owner, write bool, read *breakglass.Read) (scope, error) {
	if o.platform {
		if a.Key != nil || !a.CanReadPlatform() {
			return scope{}, apperr.Forbidden("Shared sources are managed by platform admins")
		}
		if write && !a.IsPlatformAdmin() {
			return scope{}, apperr.Forbidden("Only platform admins can change shared sources")
		}
		return scope{}, nil
	}
	acc, err := s.Teams.Get(ctx, a, o.teamRef)
	if err != nil {
		return scope{}, err
	}
	if acc.Role == "" {
		return s.breakGlassScope(ctx, a, acc, read)
	}
	if write {
		if !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
			return scope{}, apperr.Forbidden("Only team editors, admins and owners can change data sources")
		}
		if acc.Team.Status != teams.StatusActive {
			return scope{}, apperr.Conflict("team_archived", "This team is archived and read-only")
		}
	}
	return scope{team: &acc.Team, role: acc.Role}, nil
}

// breakGlassScope answers a non-member: a read under the actor's break-glass
// session, or 404 as for anyone outside the team.
func (s *Service) breakGlassScope(ctx context.Context, a authz.Actor, acc teams.Access, read *breakglass.Read) (scope, error) {
	errTeam := apperr.NotFound("team_not_found", "Team not found")
	if read == nil {
		return scope{}, errTeam
	}
	r := *read
	if r.TargetID == "" {
		r.TargetType, r.TargetID = "team", acc.Team.ID.String()
	}
	g, err := s.BreakGlass.Authorize(ctx, a, acc.Team.ID, r)
	if err != nil {
		return scope{}, err
	}
	if g == nil {
		return scope{}, errTeam
	}
	return scope{team: &acc.Team}, nil
}

func (s *Service) source(ctx context.Context, q *dbgen.Queries, sc scope, id uuid.UUID, lock bool) (dbgen.DataSource, error) {
	var (
		src dbgen.DataSource
		err error
	)
	if lock {
		src, err = q.LockSource(ctx, id)
	} else {
		src, err = q.GetSource(ctx, id)
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && src.TeamID != sc.teamID()) {
		return src, errNoSource
	}
	return src, err
}

// sourceRead is a break-glass read of one source's data.
func sourceRead(kind string, id uuid.UUID) breakglass.Read {
	return breakglass.Read{Kind: kind, TargetType: "data_source", TargetID: id.String()}
}

// Stats summarises a source's documents.
type Stats struct {
	ByStatus map[string]int64
	Bytes    int64
	Chunks   int64
}

// Summary is a source with its document statistics and active crawl.
type Summary struct {
	Source      dbgen.DataSource
	Stats       Stats
	ActiveCrawl *dbgen.WebCrawl
	Boilerplate BoilerplateSummary
}

func (s *Service) summaries(ctx context.Context, srcs []dbgen.DataSource, withCrawls bool) ([]Summary, error) {
	ids := make([]uuid.UUID, len(srcs))
	for i, src := range srcs {
		ids[i] = src.ID
	}
	rows, err := s.q.SourceDocumentStats(ctx, ids)
	if err != nil {
		return nil, err
	}
	stats := map[uuid.UUID]Stats{}
	for _, r := range rows {
		st := stats[r.SourceID]
		if st.ByStatus == nil {
			st.ByStatus = map[string]int64{}
		}
		st.ByStatus[r.Status] = r.Documents
		st.Bytes += r.Bytes
		st.Chunks += r.Chunks
		stats[r.SourceID] = st
	}
	active := map[uuid.UUID]dbgen.WebCrawl{}
	if withCrawls {
		if active, err = s.Web.ActiveRuns(ctx, ids); err != nil {
			return nil, err
		}
	}
	bp, err := s.boilerplateSummaries(ctx, srcs, ids)
	if err != nil {
		return nil, err
	}
	out := make([]Summary, len(srcs))
	for i, src := range srcs {
		out[i] = Summary{Source: src, Stats: stats[src.ID], Boilerplate: bp[src.ID]}
		if c, ok := active[src.ID]; ok {
			out[i].ActiveCrawl = &c
		}
	}
	return out, nil
}

func (s *Service) summary(ctx context.Context, src dbgen.DataSource) (Summary, error) {
	out, err := s.summaries(ctx, []dbgen.DataSource{src}, true)
	if err != nil {
		return Summary{}, err
	}
	return out[0], nil
}

func (s *Service) List(ctx context.Context, a authz.Actor, o Owner) ([]Summary, error) {
	sc, err := s.readAccess(ctx, a, o, breakglass.Read{Kind: breakglass.ReadSourceList})
	if err != nil {
		return nil, err
	}
	var srcs []dbgen.DataSource
	if sc.team == nil {
		srcs, err = s.q.ListPlatformSources(ctx)
	} else {
		srcs, err = s.q.ListTeamSources(ctx, sc.teamID())
	}
	if err != nil {
		return nil, err
	}
	return s.summaries(ctx, srcs, true)
}

// ListShared is the catalog of platform-shared sources that signed-in users
// see when attaching sources to knowledge bases: metadata and document
// counts only, never documents.
func (s *Service) ListShared(ctx context.Context, a authz.Actor) ([]Summary, error) {
	if a.Key != nil || a.UserID == uuid.Nil {
		return nil, apperr.Forbidden("Sign in to see shared sources")
	}
	srcs, err := s.q.ListPlatformSources(ctx)
	if err != nil {
		return nil, err
	}
	return s.summaries(ctx, srcs, false)
}

func (s *Service) Get(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID) (Summary, error) {
	sc, err := s.readAccess(ctx, a, o, sourceRead(breakglass.ReadSource, id))
	if err != nil {
		return Summary{}, err
	}
	src, err := s.source(ctx, s.q, sc, id, false)
	if err != nil {
		return Summary{}, err
	}
	return s.summary(ctx, src)
}

// CreateInput creates a source. ProfileID nil uses the platform default.
// Web holds the web configuration (web sources only).
type CreateInput struct {
	Name, Description, Type, Classification string
	ProfileID                               *uuid.UUID
	Web                                     json.RawMessage
	Boilerplate                             *boilerplate.Settings // overrides; nil = the defaults
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
	}
	return m
}

func nullUser(a authz.Actor) uuid.NullUUID {
	return uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
}

// Create adds a source. A web source's first crawl starts in the same
// transaction (trigger "create").
func (s *Service) Create(ctx context.Context, a authz.Actor, o Owner, in CreateInput) (Summary, error) {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return Summary{}, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if err := validateText(in.Name, in.Description); err != nil {
		return Summary{}, err
	}
	if in.Type == "" {
		in.Type = TypeUpload
	}
	if err := validateBoilerplate(in.Boilerplate); err != nil {
		return Summary{}, err
	}
	config, err := s.typeConfig(ctx, sc, in)
	if err != nil {
		return Summary{}, err
	}
	var out Summary
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if sc.team != nil && s.Limits != nil {
			if err := s.Limits.LockUsage(ctx, q, sc.team.ID); err != nil {
				return err
			}
			if err := s.Limits.CheckResources(ctx, q, sc.team.ID, limits.Need{DataSources: 1}); err != nil {
				return err
			}
		}
		profileID, err := s.resolveProfile(ctx, q, in.ProfileID)
		if err != nil {
			return err
		}
		if err := s.checkClassification(ctx, q, sc, in.Classification, in.Type, profileID); err != nil {
			return err
		}
		src, err := q.InsertSource(ctx, dbgen.InsertSourceParams{
			TeamID: sc.teamID(), Name: in.Name, Description: in.Description,
			Type: in.Type, Config: config, Classification: in.Classification,
			EmbeddingProfileID: profileID, CreatedBy: nullUser(a),
		})
		if sc.nameTaken(err) {
			return sc.nameTakenErr()
		} else if err != nil {
			return err
		}
		if in.OCREnabled != nil && !*in.OCREnabled {
			if err := q.SetSourceOCR(ctx, dbgen.SetSourceOCRParams{ID: src.ID, OcrEnabled: false}); err != nil {
				return err
			}
			src.OcrEnabled = false
		}
		out.Source = src
		if src.Type == TypeWeb {
			cr, err := s.Web.StartRun(ctx, tx, src, web.TriggerCreate, a.UserID)
			if err != nil {
				return err
			}
			out.ActiveCrawl = &cr
		}
		return s.recordCreate(ctx, q, tx, a, sc, src, in.Boilerplate)
	})
	if err != nil {
		return out, err
	}
	bp, err := s.boilerplateSummaries(ctx, []dbgen.DataSource{out.Source}, []uuid.UUID{out.Source.ID})
	out.Boilerplate = bp[out.Source.ID]
	return out, err
}

// typeConfig validates the type-specific configuration of a new source.
func (s *Service) typeConfig(ctx context.Context, sc scope, in CreateInput) (json.RawMessage, error) {
	switch in.Type {
	case TypeUpload:
		if len(in.Web) > 0 && string(in.Web) != "null" {
			return nil, apperr.Invalid("invalid_web_config", "Only web sources take a web configuration")
		}
		return json.RawMessage(`{}`), nil
	case TypeWeb:
		cfg, err := s.Web.ValidateConfig(ctx, sc.teamID(), in.Web)
		if err != nil {
			return nil, err
		}
		return cfg.JSON(), nil
	}
	return nil, apperr.Invalid("unsupported_type", "type must be upload or web")
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

// Delete removes a source, its documents, chunks, vectors and crawl runs;
// its stored files go when the deleted-files retention says, unless a legal
// hold keeps them (docs/operations/retention.md). Sources used by knowledge
// bases must be detached first.
func (s *Service) Delete(ctx context.Context, a authz.Actor, o Owner, id uuid.UUID) error {
	sc, err := s.access(ctx, a, o, true)
	if err != nil {
		return err
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := s.source(ctx, q, sc, id, true)
		if err != nil {
			return err
		}
		kbs, err := q.SourceKnowledgeBases(ctx, id)
		if err != nil {
			return err
		}
		if len(kbs) > 0 {
			names := make([]string, len(kbs))
			for i, kb := range kbs {
				names[i] = kb.Name
			}
			return apperr.Conflict("source_in_use", "Remove this source from these knowledge bases first: "+strings.Join(names, ", "))
		}
		if err := q.DeleteSource(ctx, id); err != nil {
			return err
		}
		if err := retention.RecordDeletedFiles(ctx, q, retention.DeletedContent{
			TeamID: sc.teamID(), SourceID: id, Prefix: ingest.SourcePrefix(sc.teamID(), id), CreatedAt: cur.CreatedAt,
		}); err != nil {
			return err
		}
		e := a.Audit("source.delete", "data_source", id.String())
		e.TeamID, e.Before = sc.auditTeam(), sourceSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.Web.Promote(ctx, sc.teamID()) // its runs no longer hold crawl slots
	}
	return err
}

// deleteBlobs removes stored files after the database change committed. A
// failure only leaks storage, so it is logged rather than returned.
func (s *Service) deleteBlobs(ctx context.Context, prefix string) {
	if err := s.Blob.DeletePrefix(context.WithoutCancel(ctx), prefix); err != nil {
		s.Log.WarnContext(ctx, "could not delete stored files", "prefix", prefix, "err", err)
	}
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
