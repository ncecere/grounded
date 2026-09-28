// Package demo seeds a neutral sample install (`grounded demo`,
// docs/demo.md; docs/phase5-deploy.md §5 F6): a Demo team with a web source
// over the Go documentation, a knowledge base and two published agents,
// plus the platform objects they need. It also holds the built-in fake
// model gateway used by the no-keys demo.
//
// Seeding calls the domain services as the team's owner, so every object
// is validated and audited as if created in the UI. It never changes
// existing data: it refuses unless the install has no teams (or --force),
// and each step only adds what is missing, so running it again is safe.
package demo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/web"
)

// Options configure a run.
type Options struct {
	Owner Owner
	// Force adds the Demo team to an install that already has teams.
	Force bool
	// SiteURL is the crawl seed ("" = DefaultSiteURL).
	SiteURL string
	Models  Models
	// AppURL builds the agent links in the result.
	AppURL string
}

// Result reports a run.
type Result struct {
	// Created lists what this run added, in order ("" = nothing).
	Created []string
	// Skipped: --force found a "demo" team the demo did not create, so
	// nothing was added.
	Skipped  bool
	TeamSlug string
	// OwnerEmail is the Demo team's owner.
	OwnerEmail string
	Agents     []AgentLink
	// FakeModels: the agents answer with the built-in fake gateway.
	FakeModels bool
}

// AgentLink is a published demo agent.
type AgentLink struct {
	Name, Audience, URL string
}

// ErrNotEmpty is returned when the install already has teams and --force
// was not given.
var ErrNotEmpty = errors.New("this install already has teams, and grounded demo only seeds an empty install. " +
	"Run it with --force to add the Demo team next to them (nothing existing is changed)")

type seeder struct {
	pool  *pgxpool.Pool
	q     *dbgen.Queries
	svc   *app.Services
	opts  Options
	actor authz.Actor
	res   Result
}

func (s *seeder) created(format string, args ...any) {
	s.res.Created = append(s.res.Created, fmt.Sprintf(format, args...))
}

// Seed runs the demo seeding. svc must be wired to pool (app.NewServices).
func Seed(ctx context.Context, pool *pgxpool.Pool, svc *app.Services, opts Options) (Result, error) {
	if opts.SiteURL == "" {
		opts.SiteURL = DefaultSiteURL
	}
	site, err := url.Parse(opts.SiteURL)
	if err != nil || (site.Scheme != "https" && site.Scheme != "http") || site.Hostname() == "" {
		return Result{}, fmt.Errorf("site URL %q is not an http(s) URL", opts.SiteURL)
	}
	if err := opts.Models.Validate(); err != nil {
		return Result{}, err
	}
	s := &seeder{pool: pool, q: dbgen.New(pool), svc: svc, opts: opts, res: Result{TeamSlug: TeamSlug}}
	// Reads before the owner is known: a platform reader with no account.
	s.actor = authz.Actor{PlatformRole: authz.PlatformAuditor, RequestID: "grounded-demo"}
	resume, err := s.demoTeam(ctx)
	if err != nil || s.res.Skipped {
		return s.res, err
	}
	owner, err := s.resolveOwner(ctx)
	if err != nil {
		return s.res, err
	}
	// The CLI runs with the database's authority: platform steps need the
	// platform admin role even when the owner doesn't have it.
	s.actor = authz.Actor{UserID: owner.ID, PlatformRole: authz.PlatformAdmin, RequestID: "grounded-demo"}
	s.res.OwnerEmail = owner.Email
	if err := s.seed(ctx, site, owner, resume); err != nil {
		return s.res, err
	}
	return s.res, s.auditRun(ctx)
}

func (s *seeder) seed(ctx context.Context, site *url.URL, owner dbgen.User, resume bool) error {
	level, err := s.classification(ctx)
	if err != nil {
		return err
	}
	if err := s.ensureAllowlist(ctx, site.Hostname()); err != nil {
		return err
	}
	models, err := s.ensureModels(ctx, level.Key)
	if err != nil {
		return err
	}
	if !resume {
		if err := s.createTeam(ctx, owner, level.Key); err != nil {
			return err
		}
	}
	src, err := s.ensureSource(ctx, level.Key, models.profile)
	if err != nil {
		return err
	}
	kb, err := s.ensureKB(ctx, models.profile, src)
	if err != nil {
		return err
	}
	for _, spec := range agentSpecs {
		if err := s.ensureAgent(ctx, spec, kb, models.chat); err != nil {
			return fmt.Errorf("agent %q: %w", spec.Name, err)
		}
	}
	return nil
}

// demoTeam finds the team an earlier run created (resume = true). Without
// one, it applies the empty-install rule: ErrNotEmpty, or with --force a
// Skipped result when another team already uses the "demo" slug.
func (s *seeder) demoTeam(ctx context.Context) (bool, error) {
	var details []byte
	err := s.pool.QueryRow(ctx, "SELECT details FROM bootstrap_state WHERE key = $1", markerKey).Scan(&details)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if err == nil {
		var m struct {
			TeamID uuid.UUID `json:"teamId"`
		}
		if json.Unmarshal(details, &m) == nil {
			t, err := s.q.GetTeamByID(ctx, m.TeamID)
			if err == nil && t.Status == teams.StatusActive {
				return true, nil
			} else if err == nil {
				return false, fmt.Errorf("the Demo team (%s) is archived: restore it, or delete it and run grounded demo again", t.Slug)
			} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
				return false, err
			}
		}
	}
	existing, err := s.svc.Teams.ListAll(ctx, s.actor, teams.ListParams{Limit: 1})
	if err != nil {
		return false, err
	}
	if len(existing) > 0 && !s.opts.Force {
		return false, ErrNotEmpty
	}
	if _, err := s.q.GetTeamBySlug(ctx, TeamSlug); err == nil {
		s.res.Skipped = true // someone else's "demo" team: leave it alone
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return false, err
	}
	return false, nil
}

// classification is the least sensitive level that allows web sources and
// signed-in audiences ("open" on a default install).
func (s *seeder) classification(ctx context.Context) (dbgen.ClassificationLevel, error) {
	levels, err := s.q.ListClassifications(ctx)
	if err != nil {
		return dbgen.ClassificationLevel{}, err
	}
	for _, l := range levels { // ordered by rank
		if slices.Contains(l.AllowedSourceTypes, "web") && authz.AudienceAllowed(authz.AudienceAllAuthenticated, l.MaxAudience) {
			return l, nil
		}
	}
	return dbgen.ClassificationLevel{}, errors.New("no classification level allows web sources shared with signed-in users; " +
		"a platform admin can change the levels under Admin → Classification")
}

func (s *seeder) ensureAllowlist(ctx context.Context, host string) error {
	ok, err := s.svc.Web.Allow.Allowed(ctx, uuid.NullUUID{}, host)
	if err != nil || ok {
		return err
	}
	if _, err := s.svc.Web.AddAllowlist(ctx, s.actor, host, "Added by grounded demo for the Go documentation source"); err != nil {
		return fmt.Errorf("crawl allowlist: %w", err)
	}
	s.created("crawl allowlist entry %s", host)
	return nil
}

// createTeam creates the Demo team with the owner and records it, so later
// runs find it (demoTeam).
func (s *seeder) createTeam(ctx context.Context, owner dbgen.User, level string) error {
	sum, _, err := s.svc.Teams.Create(ctx, s.actor, teams.CreateInput{
		Slug: TeamSlug, Name: teamName, Description: teamDescription, MaxClassification: level, OwnerEmail: owner.Email,
	})
	if err != nil {
		return fmt.Errorf("team: %w", err)
	}
	details, _ := json.Marshal(map[string]any{"teamId": sum.Team.ID})
	if _, err := s.pool.Exec(ctx, `INSERT INTO bootstrap_state (key, details) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET details = EXCLUDED.details, created_at = now()`, markerKey, details); err != nil {
		return err
	}
	s.created("team %s (owner %s)", teamName, owner.Email)
	return nil
}

func (s *seeder) ensureSource(ctx context.Context, level string, profile uuid.UUID) (dbgen.DataSource, error) {
	list, err := s.svc.Sources.List(ctx, s.actor, sources.Team(TeamSlug))
	if err != nil {
		return dbgen.DataSource{}, err
	}
	for _, src := range list {
		if src.Source.Name == sourceName {
			return src.Source, nil
		}
	}
	cfg, _ := json.Marshal(map[string]any{
		"mode": web.ModeCrawl, "urls": []string{s.opts.SiteURL}, "maxDepth": sourceDepth, "maxPages": sourceMaxPages,
		"includePrefixes": []string{sourcePrefix}, "schedule": web.ScheduleWeekly,
	})
	sum, err := s.svc.Sources.Create(ctx, s.actor, sources.Team(TeamSlug), sources.CreateInput{
		Name: sourceName, Description: sourceDescription, Type: sources.TypeWeb, Classification: level,
		ProfileID: &profile, Web: cfg,
	})
	if err != nil {
		return dbgen.DataSource{}, fmt.Errorf("web source: %w", err)
	}
	s.created("web source %q crawling %s (up to %d pages; the first crawl has started)", sourceName, s.opts.SiteURL, sourceMaxPages)
	return sum.Source, nil
}

func (s *seeder) ensureKB(ctx context.Context, profile uuid.UUID, src dbgen.DataSource) (uuid.UUID, error) {
	list, err := s.svc.KBs.List(ctx, s.actor, TeamSlug)
	if err != nil {
		return uuid.Nil, err
	}
	var kb *uuid.UUID
	attached := false
	for _, k := range list {
		if k.Name == kbName {
			id := k.ID
			kb = &id
			attached = slices.ContainsFunc(k.Sources, func(r kbs.SourceRef) bool { return r.ID == src.ID })
		}
	}
	if kb == nil {
		created, err := s.svc.KBs.Create(ctx, s.actor, TeamSlug, kbs.Input{Name: kbName, Description: kbDescription, ProfileID: &profile})
		if err != nil {
			return uuid.Nil, fmt.Errorf("knowledge base: %w", err)
		}
		kb = &created.ID
		s.created("knowledge base %q", kbName)
	}
	if !attached {
		if _, err := s.svc.KBs.AttachSource(ctx, s.actor, TeamSlug, *kb, src.ID); err != nil {
			return uuid.Nil, fmt.Errorf("attach source: %w", err)
		}
	}
	return *kb, nil
}

// ensureAgent creates a demo agent that doesn't exist and publishes it if
// it has never been published.
func (s *seeder) ensureAgent(ctx context.Context, spec agentSpec, kb, chat uuid.UUID) error {
	list, err := s.svc.Agents.List(ctx, s.actor, TeamSlug)
	if err != nil {
		return err
	}
	var id uuid.UUID
	published := false
	for _, v := range list {
		if v.Agent.Slug == spec.Slug {
			id, published = v.Agent.ID, v.Agent.PublishedVersionID.Valid
		}
	}
	if id == uuid.Nil {
		if id, err = s.createAgent(ctx, spec, kb, chat); err != nil {
			return err
		}
	}
	if !published {
		if _, err := s.svc.Agents.Publish(ctx, s.actor, TeamSlug, id, "Published by grounded demo"); err != nil {
			return fmt.Errorf("publish: %w", err)
		}
		s.created("published agent %q (%s)", spec.Name, audienceText(spec.Audience))
	}
	s.res.Agents = append(s.res.Agents, AgentLink{
		Name: spec.Name, Audience: audienceText(spec.Audience),
		URL: strings.TrimRight(s.opts.AppURL, "/") + "/a/" + TeamSlug + "/" + spec.Slug,
	})
	return nil
}

func audienceText(a string) string {
	if a == authz.AudienceAllAuthenticated {
		return "everyone who signs in"
	}
	return "members of the Demo team"
}

// auditRun records one system entry listing what the run added, so the
// audit log shows the objects came from the demo.
func (s *seeder) auditRun(ctx context.Context) error {
	if len(s.res.Created) == 0 {
		return nil
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		t, err := q.GetTeamBySlug(ctx, TeamSlug)
		if err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{
			ActorKind: audit.ActorSystem, Action: "demo.seed", TeamID: t.ID, TargetType: "team", TargetID: t.ID.String(),
			Metadata: map[string]any{"created": s.res.Created, "ownerId": s.actor.UserID, "models": s.opts.Models.Mode},
		})
	})
}
