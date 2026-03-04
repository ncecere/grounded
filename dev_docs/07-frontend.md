# Frontend (Web Admin UI)

## Tech Stack

- **React 19** with TypeScript
- **Vite** for dev server and builds
- **TanStack Query** for server state management
- **Radix UI** + **shadcn/ui** for component primitives
- **Tailwind CSS** for styling
- **Lucide React** for icons

## Project Structure

```
apps/web/src/
├── App.tsx                    # Root component, page routing
├── main.tsx                   # Entry point
├── app/
│   ├── page-registry.ts       # All pages registered here (auth gates, groups)
│   └── providers/
│       ├── app-state-provider.tsx   # Navigation state, selected items
│       ├── auth-provider.tsx        # Auth state, login/logout, user info
│       └── tenant-provider.tsx      # Current tenant context
├── components/
│   ├── ui/                    # shadcn/ui base components (button, card, dialog, etc.)
│   ├── ai-elements/           # AI-specific UI (reasoning steps, citations, etc.)
│   ├── agents/                # Agent management components
│   ├── knowledge-bases/       # KB management components
│   ├── test-suites/           # Test suite components
│   ├── analytics/             # Analytics charts and tables
│   ├── app-sidebar.tsx        # Main navigation sidebar
│   ├── tenant-switcher.tsx    # Tenant selection dropdown
│   └── nav-user.tsx           # User menu
├── pages/
│   ├── Login.tsx              # Login page
│   ├── KnowledgeBases.tsx     # KB list + detail panel
│   ├── Agents.tsx             # Agent list + configuration
│   ├── Sources.tsx            # Source management
│   ├── SourcesManager.tsx     # Source detail with run history
│   ├── Chat.tsx               # Admin chat interface
│   ├── Analytics.tsx          # Tenant analytics
│   ├── TenantSettings.tsx     # Tenant settings (members, API keys, alerts)
│   ├── Admin*.tsx             # System admin pages
│   └── sources/               # Source-specific modals and utilities
├── lib/
│   ├── api/
│   │   ├── client.ts          # HTTP client (fetch wrapper with auth)
│   │   ├── index.ts           # Re-exports
│   │   ├── agents.ts          # Agent API calls
│   │   ├── knowledge-bases.ts # KB API calls
│   │   ├── sources.ts         # Source API calls
│   │   ├── chat.ts            # Chat API calls (SSE streaming)
│   │   ├── auth.ts            # Auth API calls
│   │   ├── tenants.ts         # Tenant API calls
│   │   ├── admin.ts           # Admin API calls
│   │   ├── test-suites.ts     # Test suite API + hooks
│   │   ├── analytics.ts       # Analytics API
│   │   ├── tools.ts           # Tools API
│   │   └── types/             # TypeScript types for API responses
│   └── utils.ts               # Utility functions (cn, formatDate, etc.)
└── hooks/
    ├── use-mobile.tsx         # Mobile detection
    └── use-theme.ts           # Theme management
```

## Navigation Pattern

The app uses **state-based navigation** instead of React Router:

```typescript
// Page IDs are registered in page-registry.ts
type PageId = "kbs" | "agents" | "sources" | "chat" | "analytics" | "settings" | ...;

// Navigation happens via context
const { currentPage, navigate } = useAppState();
navigate("agents");  // Changes page
```

### Page Registry
Each page is registered in `apps/web/src/app/page-registry.ts`:

```typescript
{
  id: "agents",
  label: "Agents",
  group: "workspace",      // "workspace" or "admin"
  component: AgentsPage,
  authGate: "tenant",       // "tenant" | "tenant-admin" | "system-admin"
  order: 2,
}
```

- **`tenant`** — Any tenant member can access
- **`tenant-admin`** — Only tenant owners/admins
- **`system-admin`** — Only system admins

Pages are lazy-loaded with `React.lazy()` for code splitting.

## State Management

### Auth Provider (`auth-provider.tsx`)
- Manages JWT token storage
- Login/logout flow
- Current user info (`/api/v1/auth/me`)
- Tenant list for tenant switcher

### Tenant Provider (`tenant-provider.tsx`)
- Current selected tenant
- Tenant switching
- Passes `X-Tenant-ID` header on all API calls

### App State Provider (`app-state-provider.tsx`)
- Current page navigation
- Selected items (selected KB, selected agent, etc.)
- UI state that doesn't belong to server data

### Server State (TanStack Query)
All server data is managed via TanStack Query:

```typescript
// Example: Fetching agents
const { data: agents, isLoading } = useQuery({
  queryKey: ["agents", tenantId],
  queryFn: () => api.agents.list(tenantId),
});

// Example: Creating an agent
const mutation = useMutation({
  mutationFn: (data) => api.agents.create(tenantId, data),
  onSuccess: () => queryClient.invalidateQueries(["agents"]),
});
```

## API Client

The HTTP client in `lib/api/client.ts`:
- Wraps `fetch` with auth headers
- Adds `Authorization: Bearer <token>` from auth context
- Adds `X-Tenant-ID` from tenant context
- Handles error responses
- Supports SSE streaming for chat

## Key UI Patterns

### Detail Panels
Many pages use a list + detail panel layout:
- Left side: Card grid or list of items
- Right side: Sheet/drawer with full details when an item is selected

### Forms with Zod
Form validation uses Zod schemas that mirror API expectations.

### Loading States
- `LoadingSkeleton` component for initial loads
- TanStack Query's `isLoading` / `isFetching` states
- Optimistic updates for mutations where appropriate

### Theming
- Light/dark mode via `ThemeProvider`
- CSS variables for theme colors
- Widget config has its own separate theme system

## Adding a New Page

1. Create component in `apps/web/src/pages/YourPage.tsx`
2. Register in `apps/web/src/app/page-registry.ts`:
   ```typescript
   {
     id: "your-page",
     label: "Your Page",
     group: "workspace",
     component: lazy(() => import("@/pages/YourPage")),
     authGate: "tenant",
     order: 20,
   }
   ```
3. Add navigation item in `app-sidebar.tsx` if needed
4. The page will automatically be accessible via `navigate("your-page")`

## Component Library

The `components/ui/` directory contains shadcn/ui components. Notable custom ones:

| Component | Description |
|-----------|-------------|
| `empty-state.tsx` | Placeholder for empty lists |
| `stat-card.tsx` | Metric display card |
| `status-badge.tsx` | Status indicator (running, failed, etc.) |
| `confirm-dialog.tsx` | Confirmation dialog wrapper |
| `data-table.tsx` | Sortable, filterable data table |
| `query-chart.tsx` | Chart component with TanStack Query integration |
| `page-header.tsx` | Consistent page header with breadcrumbs |
| `form-section.tsx` | Grouped form sections |
| `toggle-field.tsx` | Toggle/switch with label |
