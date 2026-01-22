# Web Navigation Notes

## Provider Boundaries
### AuthProvider (session + identity)
- Owns authentication state (token presence, current user, loading state).
- Refreshes the session user via `api.getMe` and caches via React Query.
- Handles logout by clearing tokens, tenant id, and cached user data.
- Does not track tenant selection or page navigation state.

### TenantProvider (tenant selection)
- Depends on AuthProvider for the current user.
- Fetches available tenants (`api.getMyTenants`) and selects the active tenant.
- Persists the selected tenant id and restores it on reload.
- Invalidates tenant-scoped queries when the tenant changes (knowledge bases, agents, analytics).
- Does not own page navigation or per-page selection state.

### AppStateProvider (page + selection state)
- Owns UI navigation state: current page and selected entity ids.
- Resets selections on page navigation and tenant changes.
- Keeps selection state separate from API caches or auth data.

### Provider Order
- `AuthProvider` wraps `TenantProvider`, which wraps `AppStateProvider`, then `App`.
- This ordering allows tenant state to react to auth changes while keeping navigation state independent.
