# Phase 2: web sources and platform-shared sources (implementation spec)

This spec turns DESIGN.md §5.3–5.4 and ADR-0008 into concrete behaviour.

**Exit criteria:**
- A real university website is crawled into a KB and can be searched with citations that link to the pages.
- A platform-shared source is used by knowledge bases in two teams.

## 1. Web source configuration

A `web` data source stores this JSON in `data_sources.config`. The type is fixed at creation; the config can be edited.

```json
{
  "mode": "crawl",                 // "scrape" (1 URL) | "batch" (list of URLs) | "crawl" (follow links)
  "urls": ["https://registrar.example.edu/"],
  "maxDepth": 3,                   // crawl only: link hops from a seed (0-10)
  "maxPages": 500,                 // 1..CRAWL_MAX_PAGES (platform setting, default 10000)
  "includePrefixes": ["/"],        // crawl only: path prefixes to follow (empty = whole host)
  "exclude": ["/calendar/**"],     // crawl only: path patterns to skip
  "allowSubdomains": false,
  "useSitemaps": true,             // crawl only: also seed from robots.txt/sitemap.xml
  "schedule": "weekly"             // "manual" | "daily" | "weekly"
}
```

**Validation:**
- URLs are normalised with `crawl.Normalize`.
- `scrape` takes exactly 1 URL, `batch` 1–1000, `crawl` 1–20 seeds.
- Every URL's host must be allowed for the team (§2).
- Unknown fields are rejected.

## 2. Allowlist and domain requests

**Pattern matching:**
- `*` matches any host.
- `*.example.edu` matches `example.edu` and every subdomain.
- `example.edu` matches only that host.
- Hosts are compared lower-case, IDNA ASCII.

**Allowed hosts:** a host is allowed for a team if it matches the **platform allowlist** (`crawl_allowlist`, empty on a new install, optionally seeded once with `CRAWL_ALLOWLIST_SEED`; ADR-0018) or a pattern from one of the **team's approved domain requests**. The check runs:
- when a source is created or its config changes (400 `host_not_allowed`, naming the host and pointing to domain requests);
- on every fetch and redirect hop, via `crawl.HostPolicy` (the page is skipped with reason `host_not_allowed`).

**Domain requests:**
- Team editors and above request a pattern with a reason (at least 10 characters).
- Platform admins approve, deny or revoke them, with an optional note.
- Every step is audited (`crawl.domain_request`, `crawl.domain_review`).
- Revoking takes effect on the next fetch.
- The allowlist cache per team is at most 30 s old.

**Admin allowlist:** platform admins add and delete patterns, audited as `crawl.allowlist_add` and `crawl.allowlist_remove`.

**SSRF protection** always applies (internal/crawl), even when the allowlist contains `*`.

## 3. Crawl runs

- **One active run per source.** A run is started by source creation (`trigger=create`), `POST …/sync` (`manual`, editors and above) or the scheduler (`schedule`). Starting a run while one is active returns the active run (HTTP 409 `crawl_in_progress` with the run in `details`, or 200 for idempotent callers; see the API).
- **Durable frontier.** Discovered URLs go in `web_frontier`, so a run survives restarts. A River job `web.crawl {crawlId}` processes up to 200 pages or 10 minutes per invocation, then snoozes itself (`river.JobSnooze(0)`) to continue. This keeps worker slots fair and makes shutdown safe.
- **Seeding** (on the first invocation, when the frontier is empty):
  - Every configured URL is inserted at depth 0.
  - In `crawl` mode with `useSitemaps`, sitemap URLs for each seed origin are added at depth 1, if in scope, bounded by `maxPages`.
- **Fetching:**
  - Pages are fetched sequentially within a run. Runs on different workers proceed in parallel, and the Valkey pacer spaces requests per origin (`CRAWL_ORIGIN_INTERVAL`, default 1 s).
  - A known document is fetched with `FetchIf` using its stored ETag/Last-Modified.
  - The User-Agent is `CRAWL_USER_AGENT` (default `grounded/1.0 (+<APP_URL>/bot)`).
- **Per page:**

  | Outcome | Document | Frontier | Counter |
  |---|---|---|---|
  | 304, or identical body (sha256 unchanged) | `MarkDocumentSeen` | done | unchanged |
  | 2xx with new or changed body | body stored in blob `…/docs/{doc}/{uploadId}/original`, `UpsertWebDocument` (pending, picked up by ingest; the dispatcher is kicked) | done | changed |
  | robots-disallowed, host not allowed, blocked address, unsupported content, out of scope, trap | not seen | skipped (with reason) | skipped |
  | 404 / 410 | not seen (so it is deleted at the end) | failed (with HTTP status) | failed |
  | other non-2xx, or network error | **marked seen** (keeps the previous version) | failed | failed |

  In **crawl mode**, links from HTML pages (`crawl.Links`) at `depth+1 ≤ maxDepth` that pass `Scope.Allows` are inserted with `ON CONFLICT DO NOTHING`. The frontier is capped at `maxPages × 5` rows.

  **Redirects:** the document's identity (`external_id`) is the normalised **final** URL. If a different requested URL already has a document, that document simply isn't seen and is deleted as stale at the end of the run.
- **Page limit:** when `pages_fetched` reaches `maxPages`, the run marks `truncated` (`truncatedReason: max_pages`) and stops fetching new URLs.
- **Team limits** (DESIGN.md §11.1; shared sources are exempt):
  - A new or changed page that would exceed the team's `documents` or `storage_bytes` limit is not stored; the run stops as truncated (`documents_limit` / `storage_limit`), so no stale pages are deleted.
  - `crawl_pages_per_day`: each job invocation fetches at most the pages left for the UTC day and records them as `page_crawled` usage as it goes. At 0 left the run waits (`waitingReason: daily_page_limit`, `waitingUntil` = next UTC midnight) by snoozing its job.
  - `concurrent_crawls`: a run started while the team's slots are taken is created `queued` with `waitingReason: concurrent_crawls` and no job. When a run ends (or is cancelled, or its source paused or deleted) the oldest waiting run is admitted; the scheduler also re-checks every minute.
  - A limit of 0 refuses syncs with 409 `limit_reached`; the scheduler skips the source until its next period.
- **Finishing a run:**
  - **Stale-page removal:** if the run completed and was not truncated, `DeleteUnseenDocuments` removes documents not seen in this run (pages that disappeared), and their blobs are deleted afterwards. `documents_deleted` is recorded.
  - **Next sync:** `next_sync_at` is set from the schedule (daily +24 h, weekly +7 d, manual NULL), and `last_sync_at` is updated.
  - A run can be **cancelled** (`POST …/crawls/{id}/cancel`); the worker checks between pages.
- **Paused sources** don't start runs, and scheduled runs skip them.
- **Scheduler:** the periodic job `web.schedule` runs every minute. It takes due sources with `FOR UPDATE SKIP LOCKED` and starts a run for each unless one is active.

## 4. Parsing web pages

HTML documents from `web` sources are parsed with **main-content extraction** (`htmlmd.Options{MainContentOnly: true, BaseURL: page URL}`), which drops navigation, headers and footers. The page title comes from `<title>` or og:title. PDFs, DOCX and PPTX found by a crawl go through the normal parsers. Citations use `documents.url`.

Repeated text that extraction keeps (for example a QUICKLINKS list inside `<main>`) is removed per source by repeated-boilerplate suppression, which is on by default for web sources. After each crawl run, the source's blocks are recounted and pages are re-chunked from their stored parsed text (DESIGN.md §5.5, ADR-0021).

## 5. Platform-shared sources

- A shared source has `team_id IS NULL`. Only platform admins manage them, in the admin portal, with the same features as team sources: upload or web, documents, sync.
- **Visibility:** team members see a catalog of shared sources (name, description, type, classification, profile, document counts) at `GET /v1/shared-sources`. They cannot list the documents, but chunks appear in retrieval for KBs that attach the source.
- **Attaching** to a KB (editors and above): the source's classification rank must be ≤ the team's approved maximum, and its profile must equal the KB's.
- **Raising a shared source's classification** (platform admin): a `?preview=true` call lists every team and KB that would violate rule 2 (team maximum below the new rank). The change itself is rejected (409 `classification_impact`, listing them) until those KBs detach the source. Lowering needs a reason and is audited.
- **Ingestion fairness:** shared documents are dispatched as their own "platform" bucket, with the same per-team cap.
- **Blob keys** use the prefix `platform/sources/{src}/…`.

## 6. Map (discovery preview)

`POST /v1/teams/{team}/web/map` with body `{url, useSitemaps, limit ≤ 2000, includePrefixes, exclude, allowSubdomains}` runs a synchronous, bounded discovery (at most 30 s). It fetches the URL, reads its links and optionally the sitemaps, applies scope and the allowlist, and returns `{urls[], truncated, sitemapUrls}`. Nothing is stored. The UI uses it to preview a crawl and to "map a site, pick URLs, create a batch source".

## 7. API (all under /v1, OpenAPI updated, contract test enforced)

**Team sources** (existing routes, extended):
- `DataSourceCreate` gets `type: upload|web` and an optional `web` object (§1).
- `DataSourceUpdate` gets `web`.
- The `DataSource` response gets `web` (config), `lastSyncAt`, `nextSyncAt`, and `activeCrawl` (a summary, or null).

**Crawls:**
- `POST   /v1/teams/{team}/sources/{sourceId}/sync` returns 202 with a `Crawl`, or 409 `crawl_in_progress`.
- `GET    /v1/teams/{team}/sources/{sourceId}/crawls?limit=` lists runs, newest first.
- `POST   /v1/teams/{team}/sources/{sourceId}/crawls/{crawlId}/cancel`.

**Map:** `POST /v1/teams/{team}/web/map`.

**Domain requests:**
- `GET/POST /v1/teams/{team}/domain-requests`.
- `GET  /v1/admin/domain-requests?status=`
- `POST /v1/admin/domain-requests/{id}/review` with body `{decision: approve|deny|revoke, note}`.

**Allowlist:** `GET/POST /v1/admin/crawl-allowlist`, `DELETE /v1/admin/crawl-allowlist/{id}`.

**Shared sources:**
- Admin, with the same shapes as team sources: `GET/POST /v1/admin/shared-sources`, `GET/PATCH/DELETE /v1/admin/shared-sources/{sourceId}`, `GET/POST …/{sourceId}/documents`, `DELETE …/documents/{documentId}`, `POST …/documents/{documentId}/retry`, `POST …/sync`, `GET …/crawls`, `POST …/crawls/{crawlId}/cancel`.
- Teams: `GET /v1/shared-sources`, the catalog above.
- `PUT /v1/teams/{team}/kbs/{kbId}/sources/{sourceId}` accepts shared sources.

**`Crawl` object:** `{id, sourceId, status, trigger, pagesDiscovered, pagesFetched, pagesChanged, pagesUnchanged, pagesSkipped, pagesFailed, documentsDeleted, truncated, truncatedReason, waitingReason, waitingUntil, error, createdAt, startedAt, finishedAt}`.

## 8. Configuration

| Setting | Default |
|---|---|
| `CRAWL_MAX_PAGES` | 10000 |
| `CRAWL_ORIGIN_INTERVAL` | 1s |
| `CRAWL_USER_AGENT` | `grounded/1.0 (+$APP_URL/bot)` |
| `CRAWL_TIMEOUT` (per request) | 30s |
| `CRAWL_MAX_BODY_BYTES` | 20 MiB |
| `CRAWL_CONCURRENCY` (web crawl jobs per worker; River queue `web`) | 4 |

## 9. Tests (integration, hermetic)

- An `httptest` site with pages, links, a sitemap, `robots.txt` disallows, a redirect, a 404, a PDF, a trap URL and an off-allowlist link.
- Tests use `AllowPrivateForTests` and a test allowlist that includes 127.0.0.1.
- **Assertions:**
  - crawl, batch and scrape modes; depth and page limits; conditional 304 re-sync;
  - changed-page reprocessing; stale-page removal after a page is removed; no removal when truncated;
  - cancel; scheduler; domain request approval unblocking a host;
  - shared source attached in two teams' KBs; retrieval returns shared chunks with URLs;
  - classification impact preview;
  - map preview; permissions (members can't sync, keys with `ingest` can);
  - main-content extraction dropping navigation.
