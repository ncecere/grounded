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
			return apperr.Invalid("invalid_scopes", "Scopes must be query, ingest, manage or mcp (lower-case)")
		}
	}
	for _, sc := range scopes {
		if !slices.Contains(allowed, sc) {
			return apperr.Forbidden("Your team role does not allow the " + sc + " scope")
		}
	}
	return nil
}
