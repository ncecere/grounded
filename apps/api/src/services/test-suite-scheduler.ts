import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@grounded/db";
import { agentTestSuites, systemSettings, testSuiteRuns } from "@grounded/db/schema";
import { log } from "@grounded/logger";
import { redis } from "@grounded/queue";
import { getEnv, getEnvNumber } from "@grounded/shared";
import { runTestSuite } from "./test-runner";

type TestSuite = InferSelectModel<typeof agentTestSuites>;
type TestSuiteRun = InferSelectModel<typeof testSuiteRuns>;

export interface RetentionSettings {
  cleanupTime: string;
  retentionDays: number;
  retentionRuns: number;
}

export interface SchedulerStatus {
  running: boolean;
  scheduledSuites: number;
  nextCheck: string | null;
  lastCheck: string | null;
}

const CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  cleanupTime: "02:00",
  retentionDays: 30,
  retentionRuns: 30,
};

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckTime: Date | null = null;
let nextCheckTime: Date | null = null;

export async function startTestSuiteScheduler(): Promise<void> {
  stopTestSuiteScheduler();

  log.info("api", "TestSuiteScheduler: Starting scheduler");

  void runSchedulerCheck();
  scheduleNextCheck();

  schedulerInterval = setInterval(() => {
    void runSchedulerCheck();
    scheduleNextCheck();
  }, CHECK_INTERVAL_MS);
}

export function stopTestSuiteScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    nextCheckTime = null;
    log.info("api", "TestSuiteScheduler: Scheduler stopped");
  }
}

export function isTestSuiteSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

export async function getTestSuiteSchedulerStatus(): Promise<SchedulerStatus> {
  const scheduledSuites = await getScheduledSuiteCount();

  return {
    running: isTestSuiteSchedulerRunning(),
    scheduledSuites,
    nextCheck: nextCheckTime?.toISOString() ?? null,
    lastCheck: lastCheckTime?.toISOString() ?? null,
  };
}

export function parseScheduleTime(scheduleTime?: string | null): { hour: number; minute: number } {
  if (!scheduleTime) {
    return { hour: 0, minute: 0 };
  }

  const [hourRaw, minuteRaw] = scheduleTime.split(":").map((value) => Number(value));
  const hour = Number.isFinite(hourRaw) ? Math.min(Math.max(hourRaw, 0), 23) : 0;
  const minute = Number.isFinite(minuteRaw) ? Math.min(Math.max(minuteRaw, 0), 59) : 0;

  return { hour, minute };
}

export function shouldRunNow(suite: TestSuite, now: Date): boolean {
  const { hour: targetHour, minute: targetMinute } = parseScheduleTime(suite.scheduleTime);
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentDay = now.getUTCDay();

  switch (suite.scheduleType) {
    case "hourly":
      return currentMinute === 0;
    case "daily":
      return currentHour === targetHour && currentMinute === targetMinute;
    case "weekly":
      return (
        currentDay === suite.scheduleDayOfWeek &&
        currentHour === targetHour &&
        currentMinute === targetMinute
      );
    default:
      return false;
  }
}

export function shouldRunRetentionCleanup(now: Date, settings: RetentionSettings): boolean {
  const { hour: targetHour, minute: targetMinute } = parseScheduleTime(settings.cleanupTime);
  return now.getUTCHours() === targetHour && now.getUTCMinutes() === targetMinute;
}

export function getScheduleWindowStart(suite: TestSuite, now: Date = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const hour = now.getUTCHours();

  switch (suite.scheduleType) {
    case "hourly":
      return new Date(Date.UTC(year, month, date, hour, 0, 0, 0));
    case "daily":
      return new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
    case "weekly": {
      const daysSinceSunday = now.getUTCDay();
      return new Date(Date.UTC(year, month, date - daysSinceSunday, 0, 0, 0, 0));
    }
    default:
      return now;
  }
}

export function getScheduleWindowTtlMs(suite: TestSuite): number {
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

export function selectRunsForRetentionCleanup(
  runs: Array<Pick<TestSuiteRun, "id" | "createdAt" | "completedAt">>,
  latestRunIds: string[],
  cutoffDate: Date
): { keepIds: string[]; deleteIds: string[] } {
  const keepSet = new Set(latestRunIds);
  const keepIds: string[] = [];
  const deleteIds: string[] = [];

  for (const run of runs) {
    const runDate = run.completedAt ?? run.createdAt;
    if (runDate >= cutoffDate || keepSet.has(run.id)) {
      keepSet.add(run.id);
      keepIds.push(run.id);
    } else {
      deleteIds.push(run.id);
    }
  }

  return { keepIds, deleteIds };
}

async function runSchedulerCheck(): Promise<void> {
  lastCheckTime = new Date();

  try {
    await checkAndRunDueSuites(lastCheckTime);
  } catch (error) {
    log.error("api", "TestSuiteScheduler: Check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkAndRunDueSuites(now: Date): Promise<void> {
  const suites = await db.query.agentTestSuites.findMany({
    where: and(
      eq(agentTestSuites.isEnabled, true),
      isNull(agentTestSuites.deletedAt),
      sql`${agentTestSuites.scheduleType} != 'manual'`
    ),
  });

  for (const suite of suites) {
    try {
      if (!shouldRunNow(suite, now)) {
        continue;
      }

      const reserved = await reserveScheduleWindow(suite, now);
      if (!reserved) {
        continue;
      }

      const canRun = await canStartScheduledRun(suite, now);
      if (!canRun) {
        continue;
      }

      log.info("api", "TestSuiteScheduler: Starting scheduled run", {
        suiteId: suite.id,
        suiteName: suite.name,
      });

      const result = await runTestSuite(suite.id, "schedule");
      if (result.status === "error") {
        log.error("api", "TestSuiteScheduler: Failed to start scheduled run", {
          suiteId: suite.id,
          error: result.error,
        });
      }
    } catch (error) {
      log.error("api", "TestSuiteScheduler: Suite check failed", {
        suiteId: suite.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await runRetentionCleanupIfDue(now);
}

async function reserveScheduleWindow(suite: TestSuite, now: Date): Promise<boolean> {
  const windowStart = getScheduleWindowStart(suite, now);
  const key = `test-suite:schedule:${suite.id}:${windowStart.toISOString()}`;
  const ttlMs = getScheduleWindowTtlMs(suite);

  try {
    const reserved = await redis.set(key, "1", "PX", ttlMs, "NX");
    return Boolean(reserved);
  } catch (error) {
    log.error("api", "TestSuiteScheduler: Failed to reserve schedule window", {
      suiteId: suite.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function canStartScheduledRun(suite: TestSuite, now: Date): Promise<boolean> {
  const activeRun = await db.query.testSuiteRuns.findFirst({
    where: and(
      eq(testSuiteRuns.suiteId, suite.id),
      or(eq(testSuiteRuns.status, "pending"), eq(testSuiteRuns.status, "running"))
    ),
  });

  if (activeRun) {
    log.debug("api", "TestSuiteScheduler: Run already in progress", { suiteId: suite.id });
    return false;
  }

  const windowStart = getScheduleWindowStart(suite, now);
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

async function getScheduledSuiteCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTestSuites)
    .where(
      and(
        eq(agentTestSuites.isEnabled, true),
        isNull(agentTestSuites.deletedAt),
        sql`${agentTestSuites.scheduleType} != 'manual'`
      )
    );

  return result[0]?.count ?? 0;
}

async function runRetentionCleanupIfDue(now: Date): Promise<void> {
  const settings = await getRetentionSettings();
  if (!shouldRunRetentionCleanup(now, settings)) {
    return;
  }

  const reserved = await reserveRetentionWindow(now);
  if (!reserved) {
    return;
  }

  await runRetentionCleanup(now, settings);
}

async function reserveRetentionWindow(now: Date): Promise<boolean> {
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const key = `test-suite:retention-cleanup:${windowStart.toISOString()}`;
  const ttlMs = 2 * 24 * 60 * 60 * 1000;

  try {
    const reserved = await redis.set(key, "1", "PX", ttlMs, "NX");
    return Boolean(reserved);
  } catch (error) {
    log.error("api", "TestSuiteScheduler: Failed to reserve cleanup window", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function runRetentionCleanup(now: Date, settings: RetentionSettings): Promise<void> {
  const suites = await db.query.agentTestSuites.findMany({
    columns: { id: true, name: true },
    where: isNull(agentTestSuites.deletedAt),
  });

  const cutoffDate = new Date(now.getTime() - settings.retentionDays * 24 * 60 * 60 * 1000);
  let totalRunsDeleted = 0;

  for (const suite of suites) {
    try {
      const activeRun = await db.query.testSuiteRuns.findFirst({
        where: and(
          eq(testSuiteRuns.suiteId, suite.id),
          or(eq(testSuiteRuns.status, "pending"), eq(testSuiteRuns.status, "running"))
        ),
      });

      if (activeRun) {
        continue;
      }

      const latestRuns = await db.query.testSuiteRuns.findMany({
        columns: { id: true },
        where: eq(testSuiteRuns.suiteId, suite.id),
        orderBy: [desc(testSuiteRuns.createdAt)],
        limit: settings.retentionRuns,
      });

      const runs = await db.query.testSuiteRuns.findMany({
        columns: { id: true, createdAt: true, completedAt: true },
        where: eq(testSuiteRuns.suiteId, suite.id),
      });

      const { deleteIds } = selectRunsForRetentionCleanup(
        runs,
        latestRuns.map((run) => run.id),
        cutoffDate
      );

      if (deleteIds.length === 0) {
        continue;
      }

      const deleted = await db
        .delete(testSuiteRuns)
        .where(inArray(testSuiteRuns.id, deleteIds))
        .returning({ id: testSuiteRuns.id });

      totalRunsDeleted += deleted.length;
    } catch (error) {
      log.error("api", "TestSuiteScheduler: Retention cleanup failed for suite", {
        suiteId: suite.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info("api", "TestSuiteScheduler: Retention cleanup complete", {
    suitesProcessed: suites.length,
    runsDeleted: totalRunsDeleted,
    retentionDays: settings.retentionDays,
    retentionRuns: settings.retentionRuns,
  });
}

async function getRetentionSettings(): Promise<RetentionSettings> {
  const settingKeys = [
    "test_suites.retention_cleanup_time",
    "test_suites.retention_days",
    "test_suites.retention_runs",
  ];

  const dbSettings = await db.query.systemSettings.findMany({
    where: inArray(systemSettings.key, settingKeys),
  });

  const settingsMap = new Map<string, string | number | boolean>();
  for (const setting of dbSettings) {
    try {
      settingsMap.set(setting.key, JSON.parse(setting.value));
    } catch {
      // Ignore malformed settings
    }
  }

  const cleanupTime =
    (settingsMap.get("test_suites.retention_cleanup_time") as string | undefined) ??
    getEnv("TEST_SUITES_RETENTION_CLEANUP_TIME", DEFAULT_RETENTION_SETTINGS.cleanupTime);

  const retentionDaysRaw =
    (settingsMap.get("test_suites.retention_days") as number | undefined) ??
    getEnvNumber("TEST_SUITES_RETENTION_DAYS", DEFAULT_RETENTION_SETTINGS.retentionDays);

  const retentionRunsRaw =
    (settingsMap.get("test_suites.retention_runs") as number | undefined) ??
    getEnvNumber("TEST_SUITES_RETENTION_RUNS", DEFAULT_RETENTION_SETTINGS.retentionRuns);

  return {
    cleanupTime,
    retentionDays: Math.max(1, retentionDaysRaw),
    retentionRuns: Math.max(1, retentionRunsRaw),
  };
}

function scheduleNextCheck(): void {
  nextCheckTime = new Date(Date.now() + CHECK_INTERVAL_MS);
}
