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
	"errors"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/platform"
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
	// Access computes a person's document permissions (nil: every reader reads unrestricted documents only).
	Access         *access.Resolver
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
	// key is the API key acting, if any: one restricted to some knowledge
	// bases reaches only the sources those use.
	key *authz.KeyGrant
	// breakGlass: a platform admin's read under a break-glass session, which document permissions do not limit.
	breakGlass bool
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
	if err == nil {
		ok, kerr := s.keyAllows(ctx, sc, src.ID)
		if kerr != nil {
			return src, kerr
		}
		if !ok {
			return src, errNoSource // outside the key's knowledge bases: it does not exist for this key
		}
	}
	return src, err
}

// sourceRead is a break-glass read of one source's data.
func sourceRead(kind string, id uuid.UUID) breakglass.Read {
	return breakglass.Read{Kind: kind, TargetType: "data_source", TargetID: id.String()}
}
