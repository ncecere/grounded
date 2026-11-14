package ssogroups

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// TriggerSCIM marks changes made because the identity provider changed a SCIM group (docs/specs/scim/DESIGN.md).
const TriggerSCIM = "scim"

// scimGroups is a SCIM-linked user's groups for the rules: each SCIM group's name and external ID, normalised, so a rule
// written for a group's name or for its object ID matches.
func scimGroups(ctx context.Context, q *dbgen.Queries, userID uuid.UUID) (Seen, error) {
	rows, err := q.SCIMGroupsOfUser(ctx, userID)
	if err != nil {
		return Seen{}, err
	}
	raw := make([]string, 0, 2*len(rows))
	for _, r := range rows {
		raw = append(raw, r.DisplayName)
		if r.ExternalID != "" {
			raw = append(raw, r.ExternalID)
		}
	}
	return Seen{Groups: NormalizeGroups(raw), ClaimPresent: true}, nil
}

// SignInGroups is the groups a sign-in applies: once the identity provider has pushed a SCIM group, a SCIM-linked user's
// groups come from SCIM, not from the claim, so leaving a group takes effect at once and isn't undone by an old claim.
func SignInGroups(ctx context.Context, q *dbgen.Queries, user dbgen.User, claim Seen) (Seen, error) {
	if user.ScimExternalID == nil {
		return claim, nil
	}
	any, err := q.AnySCIMGroups(ctx)
	if err != nil || !any {
		return claim, err
	}
	return scimGroups(ctx, q, user.ID)
}

// SyncSCIM applies the rules to a SCIM-linked user after their SCIM groups changed.
func SyncSCIM(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, o Origin) error {
	seen, err := scimGroups(ctx, q, userID)
	if err != nil {
		return err
	}
	o.Trigger = TriggerSCIM
	return Sync(ctx, q, userID, seen, o)
}
