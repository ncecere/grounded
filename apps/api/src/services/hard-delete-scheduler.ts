/**
 * Hard-Delete Scheduler
 *
 * Periodically scans the deletion_jobs table for pending jobs whose
 * scheduledHardDeleteAt has passed, and enqueues them for processing
 * by the ingestion worker's hard-delete handler.
 *
 * Settings are configurable via Admin UI > Settings > Deletion:
 *   - deletion.hard_delete_enabled (default: true)
 *   - deletion.hard_delete_delay_days (default: 30)
 *   - deletion.hard_delete_check_interval_minutes (default: 60)
 */

import { db } from "@grounded/db";
import { deletionJobs, systemSettings } from "@grounded/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { addHardDeleteJob } from "@grounded/queue";
import { log } from "@grounded/logger";
import type { HardDeleteObjectJob } from "@grounded/shared";

// ============================================================================
// Settings Helpers
// ============================================================================

interface DeletionSettings {
  enabled: boolean;
  delayDays: number;
  checkIntervalMinutes: number;
}

const DEFAULT_SETTINGS: DeletionSettings = {
  enabled: true,
  delayDays: 30,
  checkIntervalMinutes: 60,
};

async function getDeletionSettings(): Promise<DeletionSettings> {
  try {
    const rows = await db
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(sql`${systemSettings.key} LIKE 'deletion.%'`);

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    return {
      enabled: map["deletion.hard_delete_enabled"]
        ? JSON.parse(map["deletion.hard_delete_enabled"])
        : DEFAULT_SETTINGS.enabled,
      delayDays: map["deletion.hard_delete_delay_days"]
        ? JSON.parse(map["deletion.hard_delete_delay_days"])
        : DEFAULT_SETTINGS.delayDays,
      checkIntervalMinutes: map["deletion.hard_delete_check_interval_minutes"]
        ? JSON.parse(map["deletion.hard_delete_check_interval_minutes"])
        : DEFAULT_SETTINGS.checkIntervalMinutes,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ============================================================================
// Scheduling Helper (called from delete routes)
// ============================================================================

/**
 * Schedule a hard-delete job for a soft-deleted resource.
 * Inserts a row into deletion_jobs with scheduledHardDeleteAt = now + delayDays.
 * The scheduler will pick it up when the time arrives.
 */
export async function scheduleDeletionJob(params: {
  tenantId: string | null;
  objectType: "kb" | "source" | "agent" | "tenant";
  objectId: string;
}): Promise<void> {
  try {
    const settings = await getDeletionSettings();
    if (!settings.enabled) {
      return;
    }

    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + settings.delayDays);

    await db.insert(deletionJobs).values({
      tenantId: params.tenantId,
      objectType: params.objectType,
      objectId: params.objectId,
      scheduledHardDeleteAt: scheduledAt,
      status: "pending",
    });

    log.info("api", "Scheduled hard deletion", {
      objectType: params.objectType,
      objectId: params.objectId,
      scheduledAt: scheduledAt.toISOString(),
      delayDays: settings.delayDays,
    });
  } catch (err) {
    // Non-fatal — the data is already soft-deleted
    log.error("api", "Failed to schedule hard deletion", {
      objectType: params.objectType,
      objectId: params.objectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Periodic Scanner
// ============================================================================

let schedulerInterval: NodeJS.Timeout | null = null;
let currentIntervalMs: number = DEFAULT_SETTINGS.checkIntervalMinutes * 60 * 1000;

/**
 * Scan for pending deletion jobs that are past their scheduled time
 * and enqueue them for hard-delete processing.
 */
async function scanPendingDeletions(): Promise<void> {
  try {
    const settings = await getDeletionSettings();
    if (!settings.enabled) {
      return;
    }

    // Update interval if settings changed
    const newIntervalMs = settings.checkIntervalMinutes * 60 * 1000;
    if (newIntervalMs !== currentIntervalMs && schedulerInterval) {
      clearInterval(schedulerInterval);
      currentIntervalMs = newIntervalMs;
      schedulerInterval = setInterval(scanPendingDeletions, currentIntervalMs);
      log.info("api", "Hard-delete scheduler interval updated", {
        intervalMinutes: settings.checkIntervalMinutes,
      });
    }

    const now = new Date();

    // Find pending jobs past their scheduled time
    const pendingJobs = await db
      .select()
      .from(deletionJobs)
      .where(
        and(
          eq(deletionJobs.status, "pending"),
          lte(deletionJobs.scheduledHardDeleteAt, now)
        )
      );

    if (pendingJobs.length === 0) {
      return;
    }

    log.info("api", `Found ${pendingJobs.length} pending hard-delete job(s)`);

    for (const job of pendingJobs) {
      try {
        // Enqueue the BullMQ job
        await addHardDeleteJob({
          tenantId: job.tenantId,
          objectType: job.objectType as HardDeleteObjectJob["objectType"],
          objectId: job.objectId,
        });

        // Mark as running (the hard-delete handler will update to succeeded/failed)
        await db
          .update(deletionJobs)
          .set({ status: "running", updatedAt: new Date() })
          .where(eq(deletionJobs.id, job.id));

        log.info("api", "Enqueued hard-delete job", {
          jobId: job.id,
          objectType: job.objectType,
          objectId: job.objectId,
        });
      } catch (err) {
        log.error("api", "Failed to enqueue hard-delete job", {
          jobId: job.id,
          objectType: job.objectType,
          objectId: job.objectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    log.error("api", "Hard-delete scan failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

export async function startHardDeleteScheduler(): Promise<void> {
  if (schedulerInterval) {
    return;
  }

  const settings = await getDeletionSettings();
  if (!settings.enabled) {
    log.info("api", "Hard-delete scheduler disabled by settings");
    return;
  }

  currentIntervalMs = settings.checkIntervalMinutes * 60 * 1000;

  log.info("api", "Starting hard-delete scheduler", {
    intervalMinutes: settings.checkIntervalMinutes,
    delayDays: settings.delayDays,
  });

  // Run once at startup to process any overdue jobs
  await scanPendingDeletions();

  schedulerInterval = setInterval(scanPendingDeletions, currentIntervalMs);
}

export function stopHardDeleteScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    log.info("api", "Stopped hard-delete scheduler");
  }
}
