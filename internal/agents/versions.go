// Published versions: publishing the draft after strict validation, listing
// versions and reverting the draft to one.

package agents

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Publish snapshots the draft into a new immutable version after strict
// validation (422 agent_invalid), points the agent at it and sets its
// audience grant from the draft (docs/phase4-publishing.md §3). Editors
// publish to the team; team admins and owners to any audience the
// classification allows (403 audience_forbidden). Public also needs the
// platform switch (409 public_disabled) and working moderation (409
// moderation_not_ready). Publishing beyond the team notifies the owners.
func (s *Service) Publish(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, note string) (Version, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return Version{}, err
	}
	note = strings.TrimSpace(note)
	if len([]rune(note)) > 500 {
		return Version{}, apperr.Invalid("invalid_note", "The note must be at most 500 characters")
	}
	// The audience checks may call the moderation provider: not while the
	// agent row is locked.
	pre, err := s.loadAgent(ctx, s.q, acc.Team.ID, id, false)
	if err != nil {
		return Version{}, err
	}
	audience := DecodeConfig(pre.Draft).Audience
	if err := s.checkPublishAudience(ctx, acc.Role, audience); err != nil {
		return Version{}, err
	}
	var ver dbgen.AgentVersion
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := s.loadAgent(ctx, q, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		cfg := DecodeConfig(cur.Draft)
		if cfg.Audience != audience {
			return apperr.Conflict("draft_changed", "The draft changed while publishing. Try again.")
		}
		probs, pol, err := s.strictProblems(ctx, q, acc.Team, cfg, audience)
		if err != nil {
			return err
		}
		if len(probs) > 0 {
			return Invalid(probs)
		}
		previous := authz.AudienceTeam
		if g, err := q.GetAudienceGrant(ctx, id); err == nil {
			previous = g.PrincipalType
		}
		if ver, err = s.insertVersion(ctx, q, a, cfg, id, pol.Rank, note); err != nil {
			return err
		}
		if err := q.SetAudienceGrant(ctx, dbgen.SetAudienceGrantParams{AgentID: id, PrincipalType: audience,
			CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}}); err != nil {
			return err
		}
		e := a.Audit("agent.publish", "agent", id.String())
		e.TeamID = acc.Team.ID
		e.After = map[string]any{"version": ver.Version, "chatModelId": cfg.ChatModelID, "kbIds": cfg.KBIDs(),
			"effectiveRank": pol.Rank, "classification": pol.Classification, "audience": audience, "note": note}
		if previous != audience {
			e.Before = map[string]any{"audience": previous}
		}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		if err := s.notifyPublished(ctx, tx, a, acc.Team, cur, audience, previous, ver.Version); err != nil {
			return err
		}
		if s.OnPublished != nil {
			return s.OnPublished(ctx, tx, id)
		}
		return nil
	})
	if err != nil {
		return Version{}, err
	}
	name := ""
	if u, err := s.q.GetUser(ctx, a.UserID); err == nil {
		name = u.DisplayName
	}
	return s.versionView(ctx, ver, name), nil
}

// insertVersion stores the version and its KBs and publishes it.
func (s *Service) insertVersion(ctx context.Context, q *dbgen.Queries, a authz.Actor, cfg Config, id uuid.UUID, rank int32, note string) (dbgen.AgentVersion, error) {
	n, err := q.NextAgentVersion(ctx, id)
	if err != nil {
		return dbgen.AgentVersion{}, err
	}
	ver, err := q.InsertAgentVersion(ctx, dbgen.InsertAgentVersionParams{
		AgentID: id, Version: n, Config: cfg.JSON(), ChatModelID: *cfg.ChatModelID, EffectiveRank: rank,
		Note: note, PublishedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
	})
	if err != nil {
		return ver, err
	}
	for _, kbID := range cfg.KBIDs() {
		if err := q.InsertAgentVersionKB(ctx, dbgen.InsertAgentVersionKBParams{VersionID: ver.ID, KBID: kbID}); err != nil {
			return ver, err
		}
	}
	_, err = q.SetAgentPublished(ctx, dbgen.SetAgentPublishedParams{ID: id, VersionID: uuid.NullUUID{UUID: ver.ID, Valid: true}})
	return ver, err
}

// notifyPublished tells the team's owners when a version widens the
// audience to all signed-in users or the public (docs/phase4-publishing.md
// §8), in the publishing transaction.
func (s *Service) notifyPublished(ctx context.Context, tx pgx.Tx, a authz.Actor, t dbgen.Team, ag dbgen.Agent, audience, previous string, version int32) error {
	if s.Notify == nil || audience == authz.AudienceTeam || audience == previous {
		return nil
	}
	ev := notify.AgentPublishedEvent(notify.TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, ag.ID, ag.Name, audience, int(version))
	return s.Notify.Emit(ctx, tx, ev.By(a.UserID))
}

// Versions lists published versions, newest first.
func (s *Service) Versions(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) ([]Version, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, "")
	if err != nil {
		return nil, err
	}
	if _, err := s.loadVisible(ctx, a, acc.Team.ID, id); err != nil {
		return nil, err
	}
	rows, err := s.q.ListAgentVersions(ctx, id)
	if err != nil {
		return nil, err
	}
	out := make([]Version, len(rows))
	for i, r := range rows {
		out[i] = s.versionView(ctx, dbgen.AgentVersion{
			ID: r.ID, AgentID: r.AgentID, Version: r.Version, Config: r.Config, ChatModelID: r.ChatModelID,
			EffectiveRank: r.EffectiveRank, Note: r.Note, PublishedBy: r.PublishedBy, PublishedAt: r.PublishedAt,
		}, r.PublishedByName)
	}
	return out, nil
}

// GetVersion returns one published version.
func (s *Service) GetVersion(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, n int32) (Version, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, "")
	if err != nil {
		return Version{}, err
	}
	if _, err := s.loadVisible(ctx, a, acc.Team.ID, id); err != nil {
		return Version{}, err
	}
	v, err := s.q.GetAgentVersionByNumber(ctx, dbgen.GetAgentVersionByNumberParams{AgentID: id, Version: n})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Version{}, errNoVersion
	} else if err != nil {
		return Version{}, err
	}
	name := ""
	if v.PublishedBy.Valid {
		if u, err := s.q.GetUser(ctx, v.PublishedBy.UUID); err == nil {
			name = u.DisplayName
		}
	}
	return s.versionView(ctx, v, name), nil
}

// Revert copies a version's configuration into the draft (editors).
func (s *Service) Revert(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, n int32) (View, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return View{}, err
	}
	var out dbgen.Agent
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if _, err := s.loadAgent(ctx, q, acc.Team.ID, id, true); err != nil {
			return err
		}
		v, err := q.GetAgentVersionByNumber(ctx, dbgen.GetAgentVersionByNumberParams{AgentID: id, Version: n})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoVersion
		} else if err != nil {
			return err
		}
		if out, err = q.SetAgentDraft(ctx, dbgen.SetAgentDraftParams{ID: id, Draft: DecodeConfig(v.Config).JSON()}); err != nil {
			return err
		}
		e := a.Audit("agent.revert", "agent", id.String())
		e.TeamID, e.Metadata = acc.Team.ID, mergeMeta(e.Metadata, map[string]any{"version": n})
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, out, acc.Team, true)
}
