// Audiences (docs/phase4-publishing.md §3, ADR-0009): who may publish to
// which audience, the checks public publishing needs, and who may chat.

package agents

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Directory groups (the UI's "Your teams", "Across the organisation" and
// "Public").
const (
	GroupTeam         = "team"
	GroupOrganisation = "organisation"
	GroupPublic       = "public"
)

// publicEnabled reports the platform's public switch (off when unknown).
func (s *Service) publicEnabled(ctx context.Context) (bool, error) {
	if s.PublicEnabled == nil {
		return false, nil
	}
	return s.PublicEnabled(ctx)
}

// errAudienceRole: editors publish to the team only.
func errAudienceRole() error {
	return apperr.New(403, "audience_forbidden",
		"Only team admins and owners can publish an agent to all signed-in users or the public. Editors can publish to the team.")
}

// ErrPublicDisabled is the 409 of publishing to public while the platform
// switch is off.
func errPublicSwitchOff() error {
	return apperr.Conflict("public_disabled",
		"Public agents are turned off on this platform. Ask a platform admin to turn on public access before publishing to the public.")
}

// checkPublishAudience runs the audience rules that need no transaction:
// the publisher's role, and for public the platform switch and a working
// moderation provider (409 moderation_not_ready). The classification
// ceiling is part of strict validation (422).
func (s *Service) checkPublishAudience(ctx context.Context, role, audience string) error {
	if audience == authz.AudienceTeam {
		return nil
	}
	if !authz.RoleAtLeast(role, authz.RoleAdmin) {
		return errAudienceRole()
	}
	if audience != authz.AudiencePublic {
		return nil
	}
	on, err := s.publicEnabled(ctx)
	if err != nil {
		return err
	}
	if !on {
		return errPublicSwitchOff()
	}
	if s.Moderation == nil {
		return apperr.Conflict("moderation_not_ready", "Moderation is not configured, so agents can't be public")
	}
	return s.Moderation.Ready(ctx, authz.AudiencePublic)
}

// mayUse decides whether a caller may chat with an agent of teamID with
// the given grant: members and the team's API keys always; any signed-in
// user for all_authenticated; for public, any signed-in user while the
// public switch is on (anonymous visitors use PublicChat).
func (s *Service) mayUse(ctx context.Context, a authz.Actor, teamID uuid.UUID, grant string) (bool, error) {
	if a.Key != nil {
		return a.Key.TeamID == teamID, nil
	}
	if a.UserID == uuid.Nil {
		return false, nil
	}
	_, err := s.q.GetMembership(ctx, dbgen.GetMembershipParams{TeamID: teamID, UserID: a.UserID})
	if err == nil {
		return true, nil
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return false, err
	}
	switch grant {
	case authz.AudienceAllAuthenticated:
		return true, nil
	case authz.AudiencePublic:
		return s.publicEnabled(ctx)
	}
	return false, nil
}

// AudienceOption says whether the caller could publish the draft to an
// audience, and why not.
type AudienceOption struct {
	Audience string   `json:"audience"`
	Allowed  bool     `json:"allowed"`
	Reasons  []string `json:"reasons"`
}

// Sharing is what the editor's Audience section and Share tab show.
type Sharing struct {
	Agent               dbgen.Agent
	TeamSlug            string
	Audience            string // published
	DraftAudience       string
	ShortName           *string
	PublicAgentsEnabled bool
	Classification      string
	MaxAudience         string
	Options             []AudienceOption
}

// Sharing returns the audiences the caller could publish the draft to, and
// the agent's links (members of the team).
func (s *Service) Sharing(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Sharing, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, "")
	if err != nil {
		return Sharing{}, err
	}
	ag, err := s.loadVisible(ctx, a, acc.Team.ID, id)
	if err != nil {
		return Sharing{}, err
	}
	cfg := DecodeConfig(ag.Draft)
	out := Sharing{Agent: ag, TeamSlug: acc.Team.Slug, Audience: authz.AudienceTeam, DraftAudience: cfg.Audience}
	if g, err := s.q.GetAudienceGrant(ctx, ag.ID); err == nil {
		out.Audience = g.PrincipalType
	}
	if sn, err := s.q.GetShortName(ctx, ag.ID); err == nil {
		out.ShortName = &sn.ShortName
	}
	if out.PublicAgentsEnabled, err = s.publicEnabled(ctx); err != nil {
		return out, err
	}
	pol, err := s.evaluate(ctx, s.q, acc.Team, nil, cfg.KBIDs(), authz.AudienceTeam)
	if err != nil {
		return out, err
	}
	out.Classification, out.MaxAudience = pol.Classification, pol.MaxAudience
	modReason := s.moderationReason(ctx)
	for _, aud := range []string{authz.AudienceTeam, authz.AudienceAllAuthenticated, authz.AudiencePublic} {
		out.Options = append(out.Options, audienceOption(aud, acc.Role, pol, out.PublicAgentsEnabled, modReason))
	}
	return out, nil
}

// moderationReason is why public moderation isn't configured ("" when it
// is). It doesn't call the provider: publishing does (Ready).
func (s *Service) moderationReason(ctx context.Context) string {
	const msg = "A platform admin must set a public moderation policy with a working provider"
	if s.Moderation == nil {
		return msg
	}
	has, err := s.Moderation.HasProvider(ctx, authz.AudiencePublic)
	if err != nil || !has {
		return msg
	}
	plan, err := s.Moderation.Plan(ctx, authz.AudiencePublic, moderation.Override{})
	if err != nil || !plan.Active(moderation.StageInput) || !plan.Active(moderation.StageOutput) {
		return msg
	}
	return ""
}

func audienceOption(aud, role string, pol policy, publicOn bool, modReason string) AudienceOption {
	o := AudienceOption{Audience: aud, Reasons: []string{}}
	if aud != authz.AudienceTeam {
		if !authz.RoleAtLeast(role, authz.RoleAdmin) {
			o.Reasons = append(o.Reasons, "Only team admins and owners can publish beyond the team")
		}
		if !authz.AudienceAllowed(aud, pol.MaxAudience) {
			o.Reasons = append(o.Reasons, fmt.Sprintf("The knowledge bases hold %s data, which allows at most the %s audience",
				pol.LevelName, audienceLabel(pol.MaxAudience)))
		}
	}
	if aud == authz.AudiencePublic {
		if !publicOn {
			o.Reasons = append(o.Reasons, "Public agents are turned off on this platform")
		}
		if modReason != "" {
			o.Reasons = append(o.Reasons, modReason)
		}
	}
	o.Allowed = len(o.Reasons) == 0
	return o
}

func audienceLabel(a string) string {
	switch a {
	case authz.AudienceAllAuthenticated:
		return "authenticated"
	case authz.AudiencePublic:
		return "public"
	}
	return "team"
}
