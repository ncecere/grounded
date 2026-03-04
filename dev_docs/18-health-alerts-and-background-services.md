# Health Alerts & Background Services

This document covers the API server's background services: health alert monitoring, email delivery, caching, hard-delete scheduling, and source-run recovery.

## Health Alert System

**File:** `apps/api/src/services/health-alerts.ts` (452 lines)

### Scheduler Lifecycle

```
API server starts
  └── startHealthAlertScheduler()
        ├── Check: alerts enabled? Recipients configured? Email configured?
        ├── Run immediately on startup
        └── Start interval (default: every N minutes, from settings)
```

### Health Check Flow

```
runHealthCheck()
  │
  ├── Load settings (system + per-tenant overrides)
  ├── getTenantHealthData() for ALL tenants:
  │   ├── Query all tenants (where not deleted)
  │   ├── Load quotas (tenantQuotas) and usage (tenantUsage, current month)
  │   ├── Query chat_events from last 24h (aggregate per tenant)
  │   ├── Count KBs and agents per tenant
  │   └── For each tenant, evaluate health flags
  │
  ├── System-wide alert → admin recipients (if any tenants have issues)
  └── Per-tenant alerts → tenant owners/admins (respecting tenant alert settings)
```

### Health Flags

| Flag | Trigger Condition | Penalty |
|------|------------------|---------|
| `high_error_rate` | Error queries / total queries > threshold (last 24h, min 10 queries) | -25 |
| `kb_quota_warning` | KB count / maxKbs >= quota threshold % | -10 |
| `agent_quota_warning` | Agent count / maxAgents >= quota threshold % | -10 |
| `upload_quota_warning` | Monthly uploads / max >= quota threshold % | -15 |
| `scrape_quota_warning` | Monthly scrapes / max >= quota threshold % | -15 |
| `high_rate_limiting` | Rate-limited queries > 5% of total (last 24h, min 10 queries) | -20 |
| `low_activity` | No queries in N days (only if tenant has agents) | -5 |

**Health score** = `100 - sum(penalties)`, minimum 0.

### Settings Resolution (Layered)

```
System defaults (systemSettings table)
  ├── errorRateThreshold (e.g., 10%)
  ├── quotaWarningThreshold (e.g., 80%)
  ├── inactivityDays (e.g., 14)
  └── checkIntervalMinutes, recipientEmails, etc.
        ↓ overridden by
Per-tenant settings (tenantAlertSettings table)
  ├── enabled (can disable per tenant)
  ├── notifyOwners, notifyAdmins
  ├── additionalEmails
  └── Custom thresholds (override system defaults)
```

**File:** `apps/api/src/services/tenant-alert-helpers.ts` — `resolveAlertSettings()` merges system defaults with tenant overrides.

### Alert Recipients

**System alerts** go to `settings.recipientEmails` (configured in Admin UI).

**Per-tenant alerts** go to:
1. Tenant owners (if `notifyOwners` is true)
2. Tenant admins (if `notifyAdmins` is true)
3. Additional emails (comma-separated in tenant alert settings)
4. Deduplicated via `Set`

---

## Email Service

**File:** `apps/api/src/services/email.ts` (554 lines)

### Configuration

Email config is stored in `systemSettings` with `email.*` keys:

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `email.smtp_enabled` | boolean | false | Master toggle |
| `email.smtp_host` | string | "" | SMTP server hostname |
| `email.smtp_port` | number | 587 | SMTP port |
| `email.smtp_secure` | boolean | false | Use TLS |
| `email.smtp_user` | string | "" | SMTP username |
| `email.smtp_password` | string | "" | SMTP password |
| `email.from_address` | string | "" | Sender address |
| `email.from_name` | string | "" | Sender display name |

Config is loaded from the database with a **60-second cache** to avoid repeated queries.

### Email Types

| Method | Purpose | Recipients |
|--------|---------|-----------|
| `sendHealthAlert()` | System-wide health summary | Admin emails |
| `sendTenantHealthAlert()` | Per-tenant health warning | Tenant owners/admins |
| `sendTestRegressionAlert()` | Test suite regression alert | Tenant owners/admins + additional |

Each method generates both HTML and plain-text versions. Templates are inline in the service (no external template files).

### Transport

Uses `nodemailer` with lazy transport creation:
- Transport is created on first send and reused
- If config changes, transport is re-created on next cache miss
- `isConfigured()` — checks if SMTP is enabled and host is set

---

## Cache Service

**File:** `apps/api/src/services/cache.ts` (191 lines)

Redis-based caching layer for frequently-accessed, rarely-mutated data.

### Key Structure

Pattern: `cache:{domain}:{...parts}`

| Domain | Key Example | TTL | Cached Data |
|--------|-----------|-----|-------------|
| `agent_config` | `cache:agent_config:{tenantId}:{agentId}` | 60s | Agent configuration for chat |
| `widget` | `cache:widget:{tokenHash}` | 120s | Widget token validation result |
| `embed` | `cache:embed:{sha256Hash}` | 300s | Query embedding vectors |

### API

```typescript
cacheGet<T>(domain, ...parts): Promise<T | null>
cacheSet<T>(domain, parts[], value, ttlSeconds): Promise<void>
cacheInvalidate(domain, ...parts): Promise<void>
  // Supports glob: cacheInvalidate("agent_config", tenantId, "*")
  // Uses SCAN + DEL for wildcard patterns
```

### Invalidation Points

- Agent config cache: invalidated on agent update, model change
- Widget cache: invalidated on widget token regeneration
- Embedding cache: keyed by `sha256(modelId + "::" + text)`, auto-expires

All cache operations are non-fatal — errors are logged but don't fail the request.

---

## Hard-Delete Scheduler

**File:** `apps/api/src/services/hard-delete-scheduler.ts` (230 lines)

Manages the soft-delete → permanent delete lifecycle.

### Flow

```
User deletes a resource (KB, source, agent, tenant)
  └── Soft-delete: set deletedAt = now()
  └── scheduleDeletionJob()
        └── INSERT INTO deletion_jobs:
              objectType, objectId, tenantId
              scheduledHardDeleteAt = now + delayDays (default: 30)
              status: "pending"
                                          ↓  (after 30 days)
scanPendingDeletions() — periodic scheduler
  ├── SELECT FROM deletion_jobs WHERE status='pending' AND scheduledHardDeleteAt <= now
  ├── For each job:
  │   ├── addHardDeleteJob() → BullMQ queue
  │   └── UPDATE status → "running"
  └── Ingestion worker processes hard-delete:
      ├── Delete vector embeddings from pgvector
      ├── Delete chunks from main DB
      ├── Delete source files / metadata
      └── UPDATE deletion_jobs status → "succeeded" / "failed"
```

### Settings

| Key | Default | Purpose |
|-----|---------|---------|
| `deletion.hard_delete_enabled` | true | Master toggle |
| `deletion.hard_delete_delay_days` | 30 | Days before permanent deletion |
| `deletion.hard_delete_check_interval_minutes` | 60 | How often to scan for due jobs |

Settings are re-read on each scan, allowing dynamic interval changes.

### Restore Window

During the delay period (default 30 days), soft-deleted resources can be restored by clearing `deletedAt`. The deletion job remains pending but won't find the resource when executed (it checks `deletedAt`).

---

## Source Run Recovery

**File:** `apps/api/src/services/source-run-recovery.ts` (188 lines)

Recovers source runs that get stuck due to process crashes, network failures, or other interruptions.

### What It Recovers

1. **Stuck "running" runs** — Runs in `running` status that haven't been updated beyond a timeout threshold
2. **Orphaned stages** — Individual page-fetch or chunk-create jobs that never completed

### Recovery Actions

- Mark stuck runs as `failed` with an error message
- Reset orphaned page stages to allow re-processing
- Clean up associated Redis state (crawl state, fairness slots)

---

## Startup & Shutdown

All background services are started when the API server boots and stopped on graceful shutdown:

```typescript
// apps/api/src/app.ts (or startup module)

// Start:
await startHealthAlertScheduler();
await startHardDeleteScheduler();
// Test suite scheduler, source run recovery also start here

// Shutdown:
stopHealthAlertScheduler();
stopHardDeleteScheduler();
```

---

## File Map

| File | Lines | Purpose |
|------|-------|---------|
| `apps/api/src/services/health-alerts.ts` | 452 | Health monitoring, flag calculation, alerting |
| `apps/api/src/services/email.ts` | 554 | SMTP transport, template generation, sending |
| `apps/api/src/services/tenant-alert-helpers.ts` | — | Settings resolution, email parsing |
| `apps/api/src/services/cache.ts` | 191 | Redis caching layer with domain helpers |
| `apps/api/src/services/hard-delete-scheduler.ts` | 230 | Soft-delete → hard-delete pipeline |
| `apps/api/src/services/source-run-recovery.ts` | 188 | Stuck run & orphaned stage recovery |
| `apps/api/src/services/test-suite-lock-recovery.ts` | — | Stale test-suite lock cleanup |

---

## Related Docs

- [14 — Security](./14-security.md) — Alert settings access control
- [15 — Workers & Fairness](./15-workers-and-fairness.md) — Hard-delete job processing by ingestion worker
- [05 — Ingestion Pipeline](./05-ingestion-pipeline.md) — Source run stages and recovery context
