import { db } from "@kcb/db";
import {
  tenants,
  chatEvents,
  tenantUsage,
  tenantQuotas,
  knowledgeBases,
  agents,
  tenantMemberships,
  tenantAlertSettings,
  users,
} from "@kcb/db/schema";
import { sql, isNull, and, gte, eq, inArray } from "drizzle-orm";
import { emailService, getAlertSettings } from "./email";

// ============================================================================
// Types
// ============================================================================

interface TenantHealthData {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  flags: string[];
  healthScore: number;
  errorRate: number;
  totalQueries: number;
}

// ============================================================================
// Health Check Alert Service
// ============================================================================

let checkInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckTime: Date | null = null;

/**
 * Start the health check alert scheduler
 */
export async function startHealthAlertScheduler(): Promise<void> {
  // Stop any existing interval
  stopHealthAlertScheduler();

  const settings = await getAlertSettings();

  if (!settings.enabled) {
    console.log("[HealthAlerts] Alerts disabled, not starting scheduler");
    return;
  }

  if (settings.recipientEmails.length === 0) {
    console.log("[HealthAlerts] No recipient emails configured, not starting scheduler");
    return;
  }

  const isEmailConfigured = await emailService.isConfigured();
  if (!isEmailConfigured) {
    console.log("[HealthAlerts] Email not configured, not starting scheduler");
    return;
  }

  const intervalMs = settings.checkIntervalMinutes * 60 * 1000;
  console.log(`[HealthAlerts] Starting scheduler with ${settings.checkIntervalMinutes} minute interval`);

  // Run immediately on start
  runHealthCheck().catch((err) => console.error("[HealthAlerts] Check failed:", err));

  // Then run on interval
  checkInterval = setInterval(() => {
    runHealthCheck().catch((err) => console.error("[HealthAlerts] Check failed:", err));
  }, intervalMs);
}

/**
 * Stop the health check alert scheduler
 */
export function stopHealthAlertScheduler(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log("[HealthAlerts] Scheduler stopped");
  }
}

/**
 * Run a health check and send alerts if needed
 */
export async function runHealthCheck(): Promise<{
  checked: boolean;
  tenantsWithIssues: number;
  alertSent: boolean;
  error?: string;
}> {
  console.log("[HealthAlerts] Running health check...");
  lastCheckTime = new Date();

  try {
    const settings = await getAlertSettings();

    if (!settings.enabled) {
      return { checked: false, tenantsWithIssues: 0, alertSent: false, error: "Alerts disabled" };
    }

    if (settings.recipientEmails.length === 0) {
      return { checked: false, tenantsWithIssues: 0, alertSent: false, error: "No recipients" };
    }

    // Get all tenants with health data
    const tenantsWithHealth = await getTenantHealthData(settings);

    // Filter to only those with issues
    const tenantsWithIssues = tenantsWithHealth.filter((t) => t.flags.length > 0);

    const summary = {
      total: tenantsWithHealth.length,
      healthy: tenantsWithHealth.filter((t) => t.flags.length === 0).length,
      withWarnings: tenantsWithIssues.length,
    };

    console.log(`[HealthAlerts] Found ${tenantsWithIssues.length} tenants with issues out of ${tenantsWithHealth.length}`);

    let systemAlertSent = false;
    let tenantAlertsSent = 0;

    // Send system-wide alert to admin recipients
    if (settings.recipientEmails.length > 0 && (tenantsWithIssues.length > 0 || settings.includeHealthySummary)) {
      const result = await emailService.sendHealthAlert(
        settings.recipientEmails,
        tenantsWithIssues,
        summary
      );

      if (result.success) {
        console.log("[HealthAlerts] System alert email sent successfully");
        systemAlertSent = true;
      } else {
        console.error("[HealthAlerts] Failed to send system alert:", result.error);
      }
    }

    // Send per-tenant alerts to owners/admins
    if (tenantsWithIssues.length > 0) {
      tenantAlertsSent = await sendPerTenantAlerts(tenantsWithIssues, settings);
    }

    console.log(`[HealthAlerts] Complete. System alert: ${systemAlertSent}, Tenant alerts: ${tenantAlertsSent}`);

    return {
      checked: true,
      tenantsWithIssues: tenantsWithIssues.length,
      alertSent: systemAlertSent || tenantAlertsSent > 0,
    };
  } catch (error) {
    console.error("[HealthAlerts] Error during health check:", error);
    return {
      checked: false,
      tenantsWithIssues: 0,
      alertSent: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get health data for all tenants
 */
async function getTenantHealthData(settings: {
  errorRateThreshold: number;
  quotaWarningThreshold: number;
  inactivityDays: number;
}): Promise<TenantHealthData[]> {
  // Get all tenants
  const allTenants = await db.query.tenants.findMany({
    where: isNull(tenants.deletedAt),
  });

  // Get quotas and usage
  const allQuotas = await db.query.tenantQuotas.findMany();
  const quotaMap = new Map(allQuotas.map((q) => [q.tenantId, q]));

  const currentMonth = new Date().toISOString().slice(0, 7);
  const allUsage = await db.query.tenantUsage.findMany({
    where: eq(tenantUsage.month, currentMonth),
  });
  const usageMap = new Map(allUsage.map((u) => [u.tenantId, u]));

  // Get chat stats for last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const chatStats = await db
    .select({
      tenantId: chatEvents.tenantId,
      totalQueries: sql<number>`count(*)::int`,
      errorQueries: sql<number>`count(*) filter (where status = 'error')::int`,
      rateLimitedQueries: sql<number>`count(*) filter (where status = 'rate_limited')::int`,
      lastQueryAt: sql<string>`max(started_at)`,
    })
    .from(chatEvents)
    .where(gte(chatEvents.startedAt, oneDayAgo))
    .groupBy(chatEvents.tenantId);
  const statsMap = new Map(chatStats.map((s) => [s.tenantId, s]));

  // Get resource counts
  const kbCounts = await db
    .select({
      tenantId: knowledgeBases.tenantId,
      count: sql<number>`count(*)::int`,
    })
    .from(knowledgeBases)
    .where(isNull(knowledgeBases.deletedAt))
    .groupBy(knowledgeBases.tenantId);
  const kbCountMap = new Map(kbCounts.map((k) => [k.tenantId!, k.count]));

  const agentCounts = await db
    .select({
      tenantId: agents.tenantId,
      count: sql<number>`count(*)::int`,
    })
    .from(agents)
    .where(isNull(agents.deletedAt))
    .groupBy(agents.tenantId);
  const agentCountMap = new Map(agentCounts.map((a) => [a.tenantId, a.count]));

  // Build health data for each tenant
  return allTenants.map((tenant) => {
    const quota = quotaMap.get(tenant.id);
    const usage = usageMap.get(tenant.id);
    const stats = statsMap.get(tenant.id);
    const kbCount = kbCountMap.get(tenant.id) || 0;
    const agentCount = agentCountMap.get(tenant.id) || 0;

    const flags: string[] = [];
    const errorThreshold = settings.errorRateThreshold;
    const quotaThreshold = settings.quotaWarningThreshold;

    // High error rate
    if (stats && stats.totalQueries > 10) {
      const errorRate = (stats.errorQueries / stats.totalQueries) * 100;
      if (errorRate > errorThreshold) {
        flags.push("high_error_rate");
      }
    }

    // KB quota warning
    if (quota && kbCount > 0) {
      const kbUsagePercent = (kbCount / quota.maxKbs) * 100;
      if (kbUsagePercent >= quotaThreshold) {
        flags.push("kb_quota_warning");
      }
    }

    // Agent quota warning
    if (quota && agentCount > 0) {
      const agentUsagePercent = (agentCount / quota.maxAgents) * 100;
      if (agentUsagePercent >= quotaThreshold) {
        flags.push("agent_quota_warning");
      }
    }

    // Upload quota warning
    if (quota && usage) {
      const uploadUsagePercent = (usage.uploadedDocs / quota.maxUploadedDocsPerMonth) * 100;
      if (uploadUsagePercent >= quotaThreshold) {
        flags.push("upload_quota_warning");
      }
    }

    // Scrape quota warning
    if (quota && usage) {
      const scrapeUsagePercent = (usage.scrapedPages / quota.maxScrapedPagesPerMonth) * 100;
      if (scrapeUsagePercent >= quotaThreshold) {
        flags.push("scrape_quota_warning");
      }
    }

    // High rate limiting
    if (stats && stats.totalQueries > 10) {
      const rateLimitPercent = (stats.rateLimitedQueries / stats.totalQueries) * 100;
      if (rateLimitPercent > 5) {
        flags.push("high_rate_limiting");
      }
    }

    // Low activity
    if (settings.inactivityDays > 0 && agentCount > 0) {
      const lastQuery = stats?.lastQueryAt ? new Date(stats.lastQueryAt) : null;
      const inactivityThreshold = new Date(Date.now() - settings.inactivityDays * 24 * 60 * 60 * 1000);
      if (!lastQuery || lastQuery < inactivityThreshold) {
        flags.push("low_activity");
      }
    }

    // Calculate health score
    const healthScore = calculateHealthScore(flags);

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      flags,
      healthScore,
      errorRate: stats && stats.totalQueries > 0
        ? (stats.errorQueries / stats.totalQueries) * 100
        : 0,
      totalQueries: stats?.totalQueries || 0,
    };
  });
}

/**
 * Send per-tenant alerts to owners and admins
 */
async function sendPerTenantAlerts(
  tenantsWithIssues: TenantHealthData[],
  systemSettings: {
    errorRateThreshold: number;
    quotaWarningThreshold: number;
    inactivityDays: number;
  }
): Promise<number> {
  let alertsSent = 0;
  const tenantIds = tenantsWithIssues.map((t) => t.tenantId);

  // Get alert settings for all tenants with issues
  const allAlertSettings = await db.query.tenantAlertSettings.findMany({
    where: inArray(tenantAlertSettings.tenantId, tenantIds),
  });
  const alertSettingsMap = new Map(allAlertSettings.map((s) => [s.tenantId, s]));

  // Get memberships for all tenants (owners and admins)
  const memberships = await db
    .select({
      tenantId: tenantMemberships.tenantId,
      userId: tenantMemberships.userId,
      role: tenantMemberships.role,
      email: users.primaryEmail,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(
      and(
        inArray(tenantMemberships.tenantId, tenantIds),
        inArray(tenantMemberships.role, ["owner", "admin"]),
        isNull(tenantMemberships.deletedAt)
      )
    );

  // Group memberships by tenant
  const membershipsByTenant = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const existing = membershipsByTenant.get(m.tenantId) || [];
    existing.push(m);
    membershipsByTenant.set(m.tenantId, existing);
  }

  // Send alerts for each tenant
  for (const tenant of tenantsWithIssues) {
    const settings = alertSettingsMap.get(tenant.tenantId);

    // Default to enabled with notifyOwners=true if no settings exist
    const enabled = settings?.enabled ?? true;
    const notifyOwners = settings?.notifyOwners ?? true;
    const notifyAdmins = settings?.notifyAdmins ?? false;
    const additionalEmails = settings?.additionalEmails;

    if (!enabled) {
      console.log(`[HealthAlerts] Alerts disabled for tenant ${tenant.tenantSlug}, skipping`);
      continue;
    }

    // Build recipient list
    const recipients: string[] = [];

    const tenantMembers = membershipsByTenant.get(tenant.tenantId) || [];

    if (notifyOwners) {
      const ownerEmails = tenantMembers
        .filter((m) => m.role === "owner")
        .map((m) => m.email);
      recipients.push(...ownerEmails);
    }

    if (notifyAdmins) {
      const adminEmails = tenantMembers
        .filter((m) => m.role === "admin")
        .map((m) => m.email);
      recipients.push(...adminEmails);
    }

    if (additionalEmails) {
      const extras = additionalEmails.split(",").map((e) => e.trim()).filter(Boolean);
      recipients.push(...extras);
    }

    // Deduplicate
    const uniqueRecipients = [...new Set(recipients)];

    if (uniqueRecipients.length === 0) {
      console.log(`[HealthAlerts] No recipients for tenant ${tenant.tenantSlug}, skipping`);
      continue;
    }

    // Use tenant-specific thresholds if set, otherwise system defaults
    const thresholds = {
      errorRateThreshold: settings?.errorRateThreshold ?? systemSettings.errorRateThreshold,
      quotaWarningThreshold: settings?.quotaWarningThreshold ?? systemSettings.quotaWarningThreshold,
      inactivityDays: settings?.inactivityDays ?? systemSettings.inactivityDays,
    };

    const result = await emailService.sendTenantHealthAlert(uniqueRecipients, tenant, thresholds);

    if (result.success) {
      alertsSent++;
      console.log(`[HealthAlerts] Sent alert for tenant ${tenant.tenantSlug} to ${uniqueRecipients.length} recipients`);
    } else {
      console.error(`[HealthAlerts] Failed to send alert for tenant ${tenant.tenantSlug}:`, result.error);
    }
  }

  return alertsSent;
}

/**
 * Calculate health score from flags
 */
function calculateHealthScore(flags: string[]): number {
  const flagPenalties: Record<string, number> = {
    high_error_rate: 25,
    kb_quota_warning: 10,
    agent_quota_warning: 10,
    upload_quota_warning: 15,
    scrape_quota_warning: 15,
    high_rate_limiting: 20,
    low_activity: 5,
  };

  let score = 100;
  for (const flag of flags) {
    score -= flagPenalties[flag] || 0;
  }
  return Math.max(0, score);
}

/**
 * Get the last check time
 */
export function getLastCheckTime(): Date | null {
  return lastCheckTime;
}

/**
 * Check if the scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return checkInterval !== null;
}
