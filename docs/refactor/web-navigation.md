# Web Navigation Notes

## Page Registry
- The page registry lives in `apps/web/src/app/page-registry.ts` and defines page metadata for navigation.
- Each entry includes `id`, `label`, `group`, `component`, `authGate`, and `order`.
- `group` is either `workspace` or `admin` to drive sidebar sections.
- `order` is used to preserve the current nav ordering within each group.
- `pageRegistryById` is the lookup map used by App and the sidebar.

### Page Registry Usage
- `App.tsx` resolves the current page via `pageRegistryById` and uses `pageRegistry` for default selection.
- `AppSidebar` filters entries by access and group to render the navigation list.

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

## Page Access Gates
- Access rules are centralized in `canAccessPage` within the page registry module.
- `tenant`: requires an active tenant (`hasTenant`).
- `tenant-admin`: requires tenant admin rights (`hasTenant` + `canManageTenant`).
- `system-admin`: requires system admin privileges (`isSystemAdmin`).
- `App` and `AppSidebar` use these gates to enforce admin/workspace segmentation.
