# Cloud Storage Integration Plan

## Overview

Add Dropbox, OneDrive, and Google Drive as source types under a unified `cloud_storage` source type with a `provider` discriminator. Each provider follows the same architectural pattern: admin configures OAuth app credentials globally, tenant users connect their own accounts via OAuth, then create sources pointing to specific folders.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Admin UI (Settings > Cloud Providers)                    │
│  - Configure OAuth app credentials per provider          │
│  - Enable/disable providers                              │
└──────────────────────┬──────────────────────────────────┘
                       │ stored in systemSettings table
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Tenant User (Sources > Create Source > Cloud Storage)    │
│  1. Select provider (Dropbox / OneDrive / Google Drive)  │
│  2. Click "Connect" → OAuth consent flow                 │
│  3. Pick folder path                                     │
│  4. Configure: recursive, schedule                       │
└──────────────────────┬──────────────────────────────────┘
                       │ creates cloud_connections row +
                       │ source with cloud_storage config
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Source Run (triggered manually or on schedule)            │
│  DISCOVERING: List files via provider API                 │
│  SCRAPING: Download each file via provider API            │
│  PROCESSING: Extract text (reuse upload pipeline)         │
│  INDEXING → EMBEDDING: Same as existing pipeline          │
└─────────────────────────────────────────────────────────┘
```

## Key Decisions

| Decision | Choice |
|----------|--------|
| Source type model | Generic `cloud_storage` with `provider` field |
| Token storage | Dedicated `cloud_connections` table with encrypted tokens |
| Sync behavior | Incremental by default (cursor + file manifest comparison) |
| Folder selection | Folder path with configurable recursive subfolder toggle |
| OAuth credential management | Admin configures app credentials globally, tenants connect their own accounts |
| Implementation order | Dropbox first, then OneDrive + Google Drive |

---

## Part 1: Database Changes

### 1A. New `cloud_connections` Table

```sql
CREATE TABLE cloud_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,  -- "dropbox" | "onedrive" | "gdrive"
  account_email   TEXT,           -- display name for the connected account
  access_token    TEXT NOT NULL,  -- encrypted at rest (AES-256)
  refresh_token   TEXT,           -- encrypted at rest (AES-256)
  token_expires_at TIMESTAMPTZ,
  scopes          TEXT[],         -- granted OAuth scopes
  metadata        JSONB DEFAULT '{}',  -- provider-specific data (account ID, etc.)
  status          TEXT NOT NULL DEFAULT 'active',  -- "active" | "expired" | "revoked"
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cloud_connections_tenant_idx ON cloud_connections(tenant_id);
CREATE INDEX cloud_connections_provider_idx ON cloud_connections(tenant_id, provider);
```

- RLS policy scoped to `tenant_id`
- Access/refresh tokens encrypted using a `TOKEN_ENCRYPTION_KEY` env var
- One connection can be shared across multiple sources (e.g., two different folders from the same Dropbox account)

### 1B. Expand `sources.type` Column

From `"web" | "upload"` to `"web" | "upload" | "cloud_storage"`.

No migration needed for the column itself (it's `TEXT`), but the TypeScript types and Zod schemas need updating.

### 1C. New `cloud_sync_state` Table

For tracking incremental sync state between runs.

```sql
CREATE TABLE cloud_sync_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID NOT NULL UNIQUE REFERENCES sources(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  cursor          TEXT,          -- provider-specific delta cursor / page token
  file_manifest   JSONB DEFAULT '{}',  -- { filePath: { hash, modifiedAt, size, lastSyncedRunId } }
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cloud_sync_state_source_idx ON cloud_sync_state(source_id);
```

---

## Part 2: Shared Types & Config Schema

### 2A. Extend SourceType

```typescript
export const SourceType = {
  WEB: "web",
  UPLOAD: "upload",
  CLOUD_STORAGE: "cloud_storage",
} as const;
```

### 2B. Cloud Provider Enum

```typescript
export const CloudProvider = {
  DROPBOX: "dropbox",
  ONEDRIVE: "onedrive",
  GDRIVE: "gdrive",
} as const;
```

### 2C. Cloud Storage Config Schema

```typescript
export const cloudStorageConfigSchema = z.object({
  provider: z.enum(["dropbox", "onedrive", "gdrive"]),
  connectionId: z.string().uuid(),
  folderPath: z.string(),
  recursive: z.boolean().default(true),
  schedule: z.enum(["daily", "weekly"]).nullable().default(null),
});
```

The existing `sourceConfigSchema` stays as-is for web sources. The overall source config becomes a discriminated union at the validation layer based on `source.type`.

---

## Part 3: Admin Settings

New `cloud` settings category:

| Key | Type | Secret? | Description |
|-----|------|---------|-------------|
| `cloud.dropbox_enabled` | boolean | No | Enable Dropbox as a source option |
| `cloud.dropbox_app_key` | string | No | Dropbox OAuth app key |
| `cloud.dropbox_app_secret` | string | Yes | Dropbox OAuth app secret |
| `cloud.onedrive_enabled` | boolean | No | Enable OneDrive as a source option |
| `cloud.onedrive_client_id` | string | No | Microsoft Entra app client ID |
| `cloud.onedrive_client_secret` | string | Yes | Microsoft Entra app client secret |
| `cloud.onedrive_tenant_id` | string | No | Microsoft Entra tenant (or "common") |
| `cloud.gdrive_enabled` | boolean | No | Enable Google Drive as a source option |
| `cloud.gdrive_client_id` | string | No | Google OAuth client ID |
| `cloud.gdrive_client_secret` | string | Yes | Google OAuth client secret |

---

## Part 4: API Routes

### 4A. Cloud Auth Routes

New file: `apps/api/src/routes/cloud-auth.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/cloud/providers` | List enabled providers (reads admin settings) |
| `GET` | `/cloud/connections` | List tenant's cloud connections |
| `POST` | `/cloud/connect/:provider` | Initiate OAuth -- returns redirect URL |
| `GET` | `/cloud/callback/:provider` | OAuth callback -- exchanges code for tokens, creates `cloud_connections` row |
| `POST` | `/cloud/connections/:id/refresh` | Force token refresh |
| `DELETE` | `/cloud/connections/:id` | Disconnect (revoke token, delete connection) |
| `GET` | `/cloud/connections/:id/folders` | Browse folders (for folder picker in UI) |

### 4B. OAuth Flow Details

**Dropbox:**
- Auth URL: `https://www.dropbox.com/oauth2/authorize`
- Token URL: `https://api.dropboxapi.com/oauth2/token`
- Scopes: `files.metadata.read files.content.read`
- Refresh tokens: supported (use `token_access_type=offline`)

**OneDrive (Microsoft Graph):**
- Auth URL: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
- Token URL: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
- Scopes: `Files.Read Files.Read.All offline_access`
- Refresh tokens: supported with `offline_access` scope

**Google Drive:**
- Auth URL: `https://accounts.google.com/o/oauth2/v2/auth`
- Token URL: `https://oauth2.googleapis.com/token`
- Scopes: `https://www.googleapis.com/auth/drive.readonly`
- Refresh tokens: supported with `access_type=offline prompt=consent`

State parameter includes `tenantId` + `userId` + CSRF token, validated on callback.

---

## Part 5: Cloud Provider SDK Package

New package: `packages/cloud-providers/`

```
packages/cloud-providers/
├── src/
│   ├── index.ts            # Factory: getCloudProvider(provider, connection)
│   ├── types.ts            # Common interface
│   ├── dropbox.ts          # Dropbox implementation
│   ├── onedrive.ts         # OneDrive (Microsoft Graph) implementation
│   ├── gdrive.ts           # Google Drive implementation
│   └── token-manager.ts    # Token refresh + encryption helpers
├── package.json
└── tsconfig.json
```

### Common Interface

```typescript
interface CloudProviderClient {
  // List files in a folder (with optional recursion and cursor-based pagination)
  listFiles(folderPath: string, options: {
    recursive: boolean;
    cursor?: string;
  }): Promise<{ files: CloudFile[]; cursor?: string; hasMore: boolean }>;

  // Download a file's content as a Buffer
  downloadFile(fileId: string): Promise<{ content: Buffer; mimeType: string }>;

  // Get folder tree for the UI folder picker
  listFolders(parentPath: string): Promise<CloudFolder[]>;

  // Refresh the access token using the refresh token
  refreshToken(): Promise<{ accessToken: string; expiresAt: Date }>;
}

interface CloudFile {
  id: string;           // provider-specific file ID
  name: string;
  path: string;         // full path including filename
  mimeType: string;
  size: number;
  hash: string;         // content hash for change detection
  modifiedAt: Date;
}

interface CloudFolder {
  id: string;
  name: string;
  path: string;
}
```

Each provider implements this interface using their respective APIs:
- **Dropbox**: `@dropbox/sdk` or raw HTTP to `api.dropboxapi.com`
- **OneDrive**: Microsoft Graph API (`graph.microsoft.com/v1.0/me/drive`)
- **Google Drive**: `googleapis` npm package or raw HTTP

---

## Part 6: Ingestion Pipeline Changes

### 6A. Source Discovery

Add a cloud storage branch in `source-discover.ts` (or a new handler based on `source.type === "cloud_storage"`):

1. Load `cloud_connections` row for `config.connectionId`
2. Refresh token if expired via `CloudProviderClient.refreshToken()`
3. Call `listFiles(folderPath, { recursive, cursor })` from provider client
4. Compare against `cloud_sync_state.fileManifest`:
   - **New files** (not in manifest) -- add to URL list as `cloud://{connectionId}/{fileId}/{filename}`
   - **Changed files** (hash differs) -- add to URL list
   - **Deleted files** (in manifest but not in listing) -- mark for chunk/vector cleanup
5. Update `cloud_sync_state` with new cursor and manifest
6. Queue URLs for SCRAPING stage

### 6B. Cloud File Fetch

New processor (or branch in page-fetch) that handles `cloud://` URIs:

1. Parse the URI to extract `connectionId` and `fileId`
2. Load connection, refresh token if needed
3. Download file content via `CloudProviderClient.downloadFile()`
4. Store raw content in Redis (similar to `storeFetchedHtml`)
5. Increment stage progress

### 6C. Processing Stage

The PROCESSING stage detects the `cloud://` URI prefix and routes to `extractTextFromUpload()` logic (already supports PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML) rather than HTML content extraction.

### 6D. Incremental Sync -- Deleted File Cleanup

During discovery, files that were in the previous manifest but are no longer listed by the provider need cleanup:

- Soft-delete the corresponding `sourceRunPages` entries
- Delete associated `kb_chunks` and vector embeddings
- Remove from the manifest

Reuses existing `cascadeSoftDeleteSource` patterns.

---

## Part 7: Frontend Changes

### 7A. Create Source Modal

Add a third option to the type selector: **"Cloud Storage"**

When selected, show:
1. **Provider selector**: Dropbox / OneDrive / Google Drive (only enabled providers)
2. **Connection status**:
   - No connection: "Connect to Dropbox" button (opens OAuth popup/redirect)
   - Connected: Show account email, "Disconnect" option
3. **Folder path**: Text input with a browse button that opens a folder tree modal (calls `/cloud/connections/:id/folders`)
4. **Include subfolders**: Toggle (default on)
5. **Auto-refresh schedule**: None / Daily / Weekly

### 7B. Admin Settings UI

New "Cloud Providers" section in Admin Settings:
- Dropbox card: enabled toggle, app key, app secret fields, setup instructions link
- OneDrive card: enabled toggle, client ID, client secret, tenant ID fields
- Google Drive card: enabled toggle, client ID, client secret fields
- Each card shows a status indicator (configured / not configured)

### 7C. Source Manager

- Cloud storage sources show the provider icon, folder path, and connection status
- "Run Now" triggers incremental sync
- "Force Re-index" does a full sync (ignores manifest, re-downloads everything)

---

## Part 8: Implementation Phases

| Phase | Scope | Effort |
|-------|-------|--------|
| **Phase 1** | DB migrations, shared types, cloud config schema, admin settings for provider credentials | Small |
| **Phase 2** | `packages/cloud-providers` -- provider SDK abstraction + Dropbox implementation (simplest OAuth flow) | Medium |
| **Phase 3** | OAuth routes, `cloud_connections` CRUD, token encryption | Medium |
| **Phase 4** | Discovery job -- cloud file listing + incremental sync state | Medium |
| **Phase 5** | Cloud file fetch + processing pipeline integration | Medium |
| **Phase 6** | Frontend -- create source form, folder picker, admin settings UI | Medium |
| **Phase 7** | OneDrive + Google Drive provider implementations | Medium |
| **Phase 8** | Deleted file cleanup, token refresh cron, error handling polish | Small |

Start with Dropbox -- it has the simplest OAuth flow and API. Once the full pipeline works end-to-end for Dropbox, adding OneDrive and Google Drive is mostly implementing the `CloudProviderClient` interface.

---

## Environment Variables

Add to `.env.example`:

```bash
# Cloud Storage (optional — can also be configured via Admin UI)
TOKEN_ENCRYPTION_KEY=         # 32-byte hex key for encrypting OAuth tokens at rest

# Dropbox (alternative to Admin UI settings)
DROPBOX_APP_KEY=
DROPBOX_APP_SECRET=

# OneDrive / Microsoft Graph
ONEDRIVE_CLIENT_ID=
ONEDRIVE_CLIENT_SECRET=
ONEDRIVE_TENANT_ID=common

# Google Drive
GDRIVE_CLIENT_ID=
GDRIVE_CLIENT_SECRET=
```

---

## Supported File Types

Cloud storage sources will support the same file types as the existing upload pipeline:

- PDF (`.pdf`)
- Word (`.docx`)
- Excel (`.xlsx`)
- PowerPoint (`.pptx`)
- CSV (`.csv`)
- Plain text (`.txt`)
- Markdown (`.md`)
- HTML (`.html`)
- JSON (`.json`)
- XML (`.xml`)

Files with unsupported extensions are skipped during discovery and logged.
