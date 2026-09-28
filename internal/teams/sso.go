package teams

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Hand changes to a membership the SSO group mapping created
// (internal/ssogroups, docs/operations/sso-groups.md).
type ssoHandChange int

const (
	ssoRoleChange ssoHandChange = iota
	ssoRemove
	ssoLeave
)

var ssoMessages = map[ssoHandChange]string{
	ssoRoleChange: "The role comes from SSO group %q and would be set back at their next sign-in. A platform admin can change the group mapping rule.",
	ssoRemove: "They're a member through SSO group %q and would be added again at their next sign-in. " +
		"Remove them from the group in the identity provider, or ask a platform admin to change the group mapping rule.",
	ssoLeave: "You're a member through SSO group %q and would be added again at your next sign-in. " +
		"Ask to be removed from the group in the identity provider.",
}

// takeOverFromMapping lets a hand change go ahead, or refuses it with 409
// sso_managed when a group mapping rule manages the membership (the change
// would be undone at the person's next sign-in). A membership the mapping
// created whose rule has since been deleted is no longer managed: the hand
// change makes it a hand-made membership. The team must be locked.
func takeOverFromMapping(ctx context.Context, q *dbgen.Queries, teamID, userID uuid.UUID, change ssoHandChange) error {
	m, err := q.GetSSOMembership(ctx, dbgen.GetSSOMembershipParams{TeamID: teamID, UserID: userID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil // added by hand
	} else if err != nil {
		return err
	}
	if m.RuleID.Valid {
		group := ""
		if m.GroupName != nil {
			group = *m.GroupName
		}
		e := apperr.Conflict("sso_managed", fmt.Sprintf(ssoMessages[change], group))
		e.Details = map[string]any{"ruleId": m.RuleID.UUID.String(), "group": group}
		return e
	}
	return q.DeleteSSOMembership(ctx, dbgen.DeleteSSOMembershipParams{TeamID: teamID, UserID: userID})
}

// releaseFromMapping makes a membership hand-made (a platform admin's
// Assign owner, a recovery action, takes it over). It reports whether the
// mapping had managed it.
func releaseFromMapping(ctx context.Context, q *dbgen.Queries, teamID, userID uuid.UUID) (bool, error) {
	if _, err := q.GetSSOMembership(ctx, dbgen.GetSSOMembershipParams{TeamID: teamID, UserID: userID}); errors.Is(store.NotFound(err), store.ErrNotFound) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, q.DeleteSSOMembership(ctx, dbgen.DeleteSSOMembershipParams{TeamID: teamID, UserID: userID})
}
