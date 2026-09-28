package teams

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

var errAdminOnly = apperr.Forbidden("Only platform admins can do this")

// Summary is a team with membership counts, for platform administration.
type Summary struct {
	Team        dbgen.Team
	MemberCount int64
	OwnerCount  int64
	Content     Content
}

// Content counts what a team holds (the admin Teams list and team Overview).
type Content struct {
	Agents, Sources, KBs, Documents, StorageBytes int64
}

// CreateInput describes a new team. Only platform admins create teams.
type CreateInput struct {
	Slug, Name, Description, MaxClassification, OwnerEmail string
}

func validateTeamFields(name, description string) error {
	if n := len(strings.TrimSpace(name)); n < 1 || n > 100 {
		return apperr.Invalid("invalid_name", "Name must be 1-100 characters")
	}
	if len(description) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	return nil
}

func checkClassification(ctx context.Context, q *dbgen.Queries, key string) error {
	if _, err := q.GetClassification(ctx, key); errors.Is(store.NotFound(err), store.ErrNotFound) {
		return apperr.Invalid("unknown_classification", "Unknown classification level")
	} else if err != nil {
		return err
	}
	return nil
}

// Create creates a team and assigns its first owner (added directly, or
// invited if they have not signed in yet).
func (s *Service) Create(ctx context.Context, a authz.Actor, in CreateInput) (Summary, AddResult, error) {
	if !a.IsPlatformAdmin() {
		return Summary{}, AddResult{}, errAdminOnly
	}
	in.Slug = strings.ToLower(strings.TrimSpace(in.Slug))
	in.Name = strings.TrimSpace(in.Name)
	if err := ValidateSlug(in.Slug); err != nil {
		return Summary{}, AddResult{}, err
	}
	if err := validateTeamFields(in.Name, in.Description); err != nil {
		return Summary{}, AddResult{}, err
	}
	var (
		sum   Summary
		owner AddResult
	)
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := checkClassification(ctx, q, in.MaxClassification); err != nil {
			return err
		}
		t, err := q.InsertTeam(ctx, dbgen.InsertTeamParams{
			Slug: in.Slug, Name: in.Name, Description: in.Description,
			MaxClassification: in.MaxClassification, CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true},
		})
		if apperr.IsUniqueViolation(err, "teams_slug_key") {
			return apperr.Conflict("slug_taken", "A team with that slug already exists")
		} else if err != nil {
			return err
		}
		e := a.Audit("team.create", "team", t.ID.String())
		e.TeamID, e.After = t.ID, teamSnapshot(t)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		if owner, err = s.addOrInvite(ctx, q, tx, a, t, in.OwnerEmail, authz.RoleOwner, "team.owner_assign"); err != nil {
			return err
		}
		sum, err = summary(ctx, q, t)
		return err
	})
	return sum, owner, err
}

func summary(ctx context.Context, q *dbgen.Queries, t dbgen.Team) (Summary, error) {
	c, err := q.TeamCounts(ctx, t.ID)
	return Summary{Team: t, MemberCount: c.MemberCount, OwnerCount: c.OwnerCount, Content: Content{
		Agents: c.AgentCount, Sources: c.SourceCount, KBs: c.KbCount, Documents: c.DocumentCount, StorageBytes: c.StorageBytes,
	}}, err
}

func teamSnapshot(t dbgen.Team) map[string]any {
	return map[string]any{
		"slug": t.Slug, "name": t.Name, "description": t.Description,
		"maxClassification": t.MaxClassification, "status": t.Status,
	}
}

// ListParams filter and page the admin team list.
type ListParams struct {
	Search, Status *string
	AfterSlug      *string
	Limit          int32
}

// ListAll lists every team for platform admins and auditors.
func (s *Service) ListAll(ctx context.Context, a authz.Actor, p ListParams) ([]Summary, error) {
	if !a.CanReadPlatform() {
		return nil, errAdminOnly
	}
	rows, err := s.q.ListTeamsAdmin(ctx, dbgen.ListTeamsAdminParams{
		Search: p.Search, Status: p.Status, AfterSlug: p.AfterSlug, PageSize: p.Limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]Summary, len(rows))
	for i, r := range rows {
		out[i] = Summary{Team: r.Team, MemberCount: r.MemberCount, OwnerCount: r.OwnerCount, Content: Content{
			Agents: r.AgentCount, Sources: r.SourceCount, KBs: r.KbCount, Documents: r.DocumentCount, StorageBytes: r.StorageBytes,
		}}
	}
	return out, nil
}

// GetSummary returns one team for platform admins and auditors.
func (s *Service) GetSummary(ctx context.Context, a authz.Actor, ref string) (Summary, error) {
	if !a.CanReadPlatform() {
		return Summary{}, errAdminOnly
	}
	t, err := resolve(ctx, s.q, ref)
	if err != nil {
		return Summary{}, err
	}
	return summary(ctx, s.q, t)
}

// UpdateInput holds optional changes; nil fields are left unchanged.
type UpdateInput struct {
	Name, Description, MaxClassification, Status *string
}

// Update changes team metadata, approved classification or status.
func (s *Service) Update(ctx context.Context, a authz.Actor, ref string, in UpdateInput, expectedRevision int64) (Summary, error) {
	if !a.IsPlatformAdmin() {
		return Summary{}, errAdminOnly
	}
	var sum Summary
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		t, err := resolve(ctx, q, ref)
		if err != nil {
			return err
		}
		if t, err = q.LockTeam(ctx, t.ID); err != nil {
			return err
		}
		if t.Revision != expectedRevision {
			return apperr.Stale()
		}
		p := dbgen.UpdateTeamParams{ID: t.ID, Name: t.Name, Description: t.Description, MaxClassification: t.MaxClassification, Status: t.Status}
		if in.Name != nil {
			p.Name = strings.TrimSpace(*in.Name)
		}
		if in.Description != nil {
			p.Description = *in.Description
		}
		if err := validateTeamFields(p.Name, p.Description); err != nil {
			return err
		}
		if in.Status != nil {
			if *in.Status != StatusActive && *in.Status != StatusArchived {
				return apperr.Invalid("invalid_status", "Status must be active or archived")
			}
			p.Status = *in.Status
		}
		if in.MaxClassification != nil && *in.MaxClassification != t.MaxClassification {
			if err := checkTeamClassification(ctx, q, t.ID, *in.MaxClassification); err != nil {
				return err
			}
			p.MaxClassification = *in.MaxClassification
		}
		updated, err := q.UpdateTeam(ctx, p)
		if err != nil {
			return err
		}
		e := a.Audit(teamAction(t, updated), "team", t.ID.String())
		e.TeamID, e.Before, e.After = t.ID, teamSnapshot(t), teamSnapshot(updated)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		sum, err = summary(ctx, q, updated)
		return err
	})
	return sum, err
}

// checkTeamClassification checks a new maximum classification: it must
// exist, and a team cannot be approved below data it already holds
// (ADR-0006 rule 1).
func checkTeamClassification(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, key string) error {
	if err := checkClassification(ctx, q, key); err != nil {
		return err
	}
	level, err := q.GetClassification(ctx, key)
	if err != nil {
		return err
	}
	held, err := q.MaxSourceRankForTeam(ctx, teamID)
	if err != nil {
		return err
	}
	if held > level.Rank {
		return apperr.Conflict("classification_in_use",
			"This team has data sources (or attached shared sources) above that classification. Lower or remove them first.")
	}
	return nil
}

// teamAction is the audit action of a team update.
func teamAction(before, after dbgen.Team) string {
	switch {
	case before.Status != after.Status && after.Status == StatusArchived:
		return "team.archive"
	case before.Status != after.Status:
		return "team.unarchive"
	}
	return "team.update"
}

// AssignOwner lets a platform admin make someone an owner of any team, for
// example to recover a team whose owners have left. Existing members are
// promoted; unknown addresses are invited as owners.
func (s *Service) AssignOwner(ctx context.Context, a authz.Actor, ref, email string) (AddResult, error) {
	if !a.IsPlatformAdmin() {
		return AddResult{}, errAdminOnly
	}
	var res AddResult
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		t, err := resolve(ctx, q, ref)
		if err != nil {
			return err
		}
		if t, err = q.LockTeam(ctx, t.ID); err != nil {
			return err
		}
		normalized, err := NormalizeEmail(email)
		if err != nil {
			return err
		}
		users, err := q.ListUsersByEmail(ctx, normalized)
		if err != nil {
			return err
		}
		if len(users) == 1 {
			m, err := q.GetMembership(ctx, dbgen.GetMembershipParams{TeamID: t.ID, UserID: users[0].ID})
			if err == nil {
				if m.Role != authz.RoleOwner {
					before := m.Role
					// The admin's choice outlasts the group mapping: the
					// membership becomes hand-made.
					released, err := releaseFromMapping(ctx, q, t.ID, m.UserID)
					if err != nil {
						return err
					}
					if m, err = q.UpdateMemberRole(ctx, dbgen.UpdateMemberRoleParams{TeamID: t.ID, UserID: m.UserID, Role: authz.RoleOwner}); err != nil {
						return err
					}
					e := a.Audit("team.owner_assign", "user", m.UserID.String())
					e.TeamID, e.Before, e.After = t.ID, map[string]any{"role": before}, map[string]any{"role": authz.RoleOwner}
					if released {
						e.Metadata = map[string]any{"ssoReleased": true}
					}
					if err := audit.Record(ctx, q, e); err != nil {
						return err
					}
					if err := s.Notify.Emit(ctx, tx, notify.RoleChangedEvent(teamRef(t), m.UserID, before, authz.RoleOwner).By(a.UserID)); err != nil {
						return err
					}
				}
				res = AddResult{Status: "added", Member: &Member{TeamMember: m, User: users[0]}}
				return nil
			} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
				return err
			}
		}
		res, err = s.addOrInvite(ctx, q, tx, a, t, normalized, authz.RoleOwner, "team.owner_assign")
		return err
	})
	return res, err
}
