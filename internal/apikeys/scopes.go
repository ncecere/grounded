package apikeys

import (
	"slices"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

// Validate the vocabulary before role grants (#119): a misspelled scope is a
// bad request, not a request for a privilege the caller might obtain later.
func validateScopes(scopes, allowed []string) error {
	if len(scopes) == 0 {
		return apperr.Invalid("invalid_scopes", "Choose at least one scope")
	}
	known := authz.MaxScopesForRole(authz.RoleOwner)
	for _, sc := range scopes {
		if !slices.Contains(known, sc) {
			return apperr.Invalid("invalid_scopes", "Scopes must be query, ingest, manage, mcp, configuration:export or configuration:apply (lower-case)")
		}
	}
	// Applying a configuration file changes sources, knowledge bases and agents: it needs manage on the same key, so
	// the scope never stands alone (docs/specs/config-as-code-import §6).
	if slices.Contains(scopes, authz.ScopeConfigurationApply) && !slices.Contains(scopes, authz.ScopeManage) {
		return apperr.Invalid("invalid_scopes", "The configuration:apply scope needs the manage scope on the same key")
	}
	for _, sc := range scopes {
		if !slices.Contains(allowed, sc) {
			return apperr.Forbidden("Your team role does not allow the " + sc + " scope")
		}
	}
	return nil
}
