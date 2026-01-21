# Phase 4: Test Suite Scheduler

## Overview

Background scheduler that runs test suites on their configured schedules (hourly, daily, weekly).

## File Location

`apps/api/src/services/test-suite-scheduler.ts`

## Architecture

Similar to `health-alerts.ts`, use a setInterval-based scheduler that checks which suites need to run. For horizontal scalability, the scheduler can run on every API instance, but use Redis schedule-window reservations to dedupe scheduled runs across instances. The per-suite run lock in the test runner provides the final guard against concurrent runs.

Use the shared Redis client already used for BullMQ/queues when reserving schedule windows.

## Core Implementation

```typescript
import { db } from "@grounded/db";
import { agentTestSuites, testSuiteRuns } from "@grounded/db/schema";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { log } from "@grounded/logger";
import { runTestSuite } from "./test-runner";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

export async function startTestSuiteScheduler(): Promise<void> {
  stopTestSuiteScheduler();
  
  log.info("api", "TestSuiteScheduler: Starting scheduler");
  
  // Run immediately on start
  checkAndRunDueSuites().catch((err) => 
    log.error("api", "TestSuiteScheduler: Check failed", { error: String(err) })
  );
  
  // Then check every minute
  schedulerInterval = setInterval(() => {
    checkAndRunDueSuites().catch((err) => 
      log.error("api", "TestSuiteScheduler: Check failed", { error: String(err) })
    );
  }, CHECK_INTERVAL_MS);
}

export function stopTestSuiteScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    log.info("api", "TestSuiteScheduler: Scheduler stopped");
  }
}

export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}
```

## Schedule Checking Logic

```typescript
async function checkAndRunDueSuites(): Promise<void> {
  const now = new Date();
  
  // Get all enabled, scheduled suites
  const suites = await db.query.agentTestSuites.findMany({
    where: and(
      eq(agentTestSuites.isEnabled, true),
      isNull(agentTestSuites.deletedAt),
      // Not manual
      sql`${agentTestSuites.scheduleType} != 'manual'`
    ),
  });
  
  for (const suite of suites) {
    if (shouldRunNow(suite, now)) {
      const reserved = await reserveScheduleWindow(suite, now);
      if (!reserved) continue;

      const canRun = await canStartScheduledRun(suite);
      if (canRun) {
        log.info("api", "TestSuiteScheduler: Starting scheduled run", { 
          suiteId: suite.id, 
          suiteName: suite.name 
        });
        
        await runTestSuite(suite.id, "schedule");
      }
    }
  }
}

function shouldRunNow(suite: TestSuite, now: Date): boolean {
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();
  
  // Parse scheduleTime if set (HH:MM format)
  let targetHour = 0;
  let targetMinute = 0;
  if (suite.scheduleTime) {
    const [h, m] = suite.scheduleTime.split(":").map(Number);
    targetHour = h;
    targetMinute = m;
  }
  
  switch (suite.scheduleType) {
    case "hourly":
      // Run at the start of each hour
      return currentMinute === 0;
      
    case "daily":
      // Run at specified time each day
      return currentHour === targetHour && currentMinute === targetMinute;
      
    case "weekly":
      // Run at specified time on specified day
      return (
        currentDay === suite.scheduleDayOfWeek &&
        currentHour === targetHour &&
        currentMinute === targetMinute
      );
      
    default:
      return false;
  }
}

async function reserveScheduleWindow(suite: TestSuite, now: Date): Promise<boolean> {
  const windowStart = getScheduleWindowStart(suite, now);
  const key = `test-suite:schedule:${suite.id}:${windowStart.toISOString()}`;
  const ttlMs = getScheduleWindowTtlMs(suite);

  const reserved = await redis.set(key, "1", "PX", ttlMs, "NX");
  return Boolean(reserved);
}

function getScheduleWindowTtlMs(suite: TestSuite): number {
  switch (suite.scheduleType) {
    case "hourly":
      return 2 * 60 * 60 * 1000;
    case "daily":
      return 2 * 24 * 60 * 60 * 1000;
    case "weekly":
      return 2 * 7 * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}
```

## Preventing Duplicate Runs

```typescript
async function canStartScheduledRun(suite: TestSuite): Promise<boolean> {
  // Check if there's already a run in progress
  const activeRun = await db.query.testSuiteRuns.findFirst({
    where: and(
      eq(testSuiteRuns.suiteId, suite.id),
      or(
        eq(testSuiteRuns.status, "pending"),
        eq(testSuiteRuns.status, "running")
      )
    ),
  });
  
  if (activeRun) {
    log.debug("api", "TestSuiteScheduler: Run already in progress", { suiteId: suite.id });
    return false;
  }
  
  // Check if we already ran in this time window
  const windowStart = getScheduleWindowStart(suite);
  const recentRun = await db.query.testSuiteRuns.findFirst({
    where: and(
      eq(testSuiteRuns.suiteId, suite.id),
      eq(testSuiteRuns.triggeredBy, "schedule"),
      gte(testSuiteRuns.createdAt, windowStart)
    ),
  });
  
  if (recentRun) {
    log.debug("api", "TestSuiteScheduler: Already ran in this window", { suiteId: suite.id });
    return false;
  }
  
  return true;
}

function getScheduleWindowStart(suite: TestSuite, now: Date = new Date()): Date {
  
  switch (suite.scheduleType) {
    case "hourly":
      // Window is the current hour
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
      
    case "daily":
      // Window is today
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      
    case "weekly":
      // Window is this week (from Sunday)
      const daysSinceSunday = now.getDay();
      const sunday = new Date(now);
      sunday.setDate(now.getDate() - daysSinceSunday);
      sunday.setHours(0, 0, 0, 0);
      return sunday;
      
    default:
      return now;
  }
}
```

`reserveScheduleWindow` uses Redis `SET NX` with a TTL at least as long as the schedule window, which prevents duplicate runs across instances. Keep `canStartScheduledRun` as a safety check to avoid queuing runs while another run is active.

## Integration with API Server

In `apps/api/src/index.ts`:

```typescript
import { startTestSuiteScheduler, stopTestSuiteScheduler } from "./services/test-suite-scheduler";

// After server starts
startTestSuiteScheduler();

// On shutdown
process.on("SIGTERM", () => {
  stopTestSuiteScheduler();
  // ... other cleanup
});
```

## Admin API for Scheduler Status

Add to admin routes:

```typescript
// GET /api/v1/admin/test-scheduler/status
{
  running: boolean;
  scheduledSuites: number; // Count of non-manual suites
  nextCheck: string; // ISO timestamp of next check
}

// POST /api/v1/admin/test-scheduler/restart
// Restarts the scheduler
```

## Retention Cleanup Job

Add a nightly cleanup job to enforce the retention policy (last 30 days or last 30 runs per suite, whichever is larger). The cleanup time should be configurable via Admin UI settings with an env var fallback. Use UTC unless a timezone setting is later added.

UI settings should override env vars, consistent with other worker settings in the repo.

Suggested settings:
- `test_suites.retention_cleanup_time` (HH:MM, default `02:00`, env `TEST_SUITES_RETENTION_CLEANUP_TIME`)
- `test_suites.retention_days` (default `30`, env `TEST_SUITES_RETENTION_DAYS`)
- `test_suites.retention_runs` (default `30`, env `TEST_SUITES_RETENTION_RUNS`)

Settings should be added to `apps/api/src/routes/admin/settings.ts` with category `test_suites`. Resolve values in this order:
1. System setting value (Admin UI)
2. Env var fallback
3. Hard-coded default

Implementation notes:
- Use a Redis schedule-window reservation (similar to `reserveScheduleWindow`) to ensure only one instance runs cleanup per day.
- Delete oldest runs beyond the retention threshold and rely on cascading deletes for `test_case_results`.
- Log counts of deleted runs/results for observability.

Cleanup algorithm (per suite):
1. Skip suites with active runs (`pending` or `running`).
2. Fetch the latest `retention_runs` run IDs for the suite.
3. Compute `cutoffDate = now - retention_days` using `completedAt` (fallback to `createdAt`).
4. Keep all runs newer than `cutoffDate` plus the latest `retention_runs` runs.
5. Delete any runs not in the keep set.

Use `completedAt` for age calculations where available so slow runs do not expire early.

## Time Zone Considerations

For MVP, use server time (UTC in production). Future enhancement could add per-tenant or per-suite timezone settings.

## Error Recovery

If the scheduler fails to check/run:
1. Log the error with full context
2. Continue checking on next interval
3. Individual suite failures don't affect other suites
