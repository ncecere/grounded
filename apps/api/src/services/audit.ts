import { db } from "@grounded/db";
import {
  auditLogs,
  type AuditAction,
  type AuditResourceType,
  type AuditMetadata,
  type NewAuditLog,
} from "@grounded/db/schema";
import { desc, eq, and, gte, lte, or, ilike, sql } from "drizzle-orm";
import { log } from "@grounded/logger";

// ============================================================================
// Types
// ============================================================================

export interface AuditLogEntry {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  metadata?: AuditMetadata;
  success?: boolean;
  errorMessage?: string;
}

export interface AuditContext {
  actorId?: string;
  tenantId?: string;
  ipAddress?: string;
}

export interface AuditQueryOptions {
  tenantId?: string;
  actorId?: string;
  action?: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  logs: Array<{
    id: string;
    timestamp: Date;
    actorId: string | null;
    tenantId: string | null;
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId: string | null;
    metadata: AuditMetadata;
    ipAddress: string | null;
    success: boolean;
    errorMessage: string | null;
  }>;
  total: number;
  hasMore: boolean;
}

// ============================================================================
// Audit Service
// ============================================================================

class AuditService {
  /**
   * Log an auditable event
   */
  async log(entry: AuditLogEntry, context: AuditContext): Promise<void> {
    try {
      const logEntry: NewAuditLog = {
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata || {},
        success: entry.success ?? true,
        errorMessage: entry.errorMessage,
        actorId: context.actorId,
        tenantId: context.tenantId,
        ipAddress: context.ipAddress,
      };

      await db.insert(auditLogs).values(logEntry);
    } catch (error) {
      // Log but don't throw - audit logging should never break the app
      log.error("api", "AuditService failed to write audit log", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Log a successful action
   */
  async logSuccess(
    action: AuditAction,
    resourceType: AuditResourceType,
    context: AuditContext,
    options?: {
      resourceId?: string;
      resourceName?: string;
      changes?: Record<string, { from: unknown; to: unknown }>;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.log(
      {
        action,
        resourceType,
        resourceId: options?.resourceId,
        metadata: {
          resourceName: options?.resourceName,
          changes: options?.changes,
          ...options?.metadata,
        },
        success: true,
      },
      context
    );
  }

  /**
   * Log a failed action
   */
  async logFailure(
    action: AuditAction,
    resourceType: AuditResourceType,
    context: AuditContext,
    errorMessage: string,
    options?: {
      resourceId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.log(
      {
        action,
        resourceType,
        resourceId: options?.resourceId,
        metadata: options?.metadata,
        success: false,
        errorMessage,
      },
      context
    );
  }

  /**
   * Query audit logs with filtering and pagination
   */
  async query(options: AuditQueryOptions): Promise<AuditQueryResult> {
    const {
      tenantId,
      actorId,
      action,
      resourceType,
      resourceId,
      startDate,
      endDate,
      search,
      limit = 50,
      offset = 0,
    } = options;

    // Build where conditions
    const conditions = [];

    if (tenantId) {
      conditions.push(eq(auditLogs.tenantId, tenantId));
    }

    if (actorId) {
      conditions.push(eq(auditLogs.actorId, actorId));
    }

    if (action) {
      conditions.push(eq(auditLogs.action, action));
    }

    if (resourceType) {
      conditions.push(eq(auditLogs.resourceType, resourceType));
    }

    if (resourceId) {
      conditions.push(eq(auditLogs.resourceId, resourceId));
    }

    if (startDate) {
      conditions.push(gte(auditLogs.timestamp, startDate));
    }

    if (endDate) {
      conditions.push(lte(auditLogs.timestamp, endDate));
    }

    if (search) {
      // Search in action, resource type, or metadata
      conditions.push(
        or(
          ilike(auditLogs.action, `%${search}%`),
          ilike(auditLogs.resourceType, `%${search}%`),
          sql`${auditLogs.metadata}::text ILIKE ${'%' + search + '%'}`
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(whereClause);

    const total = Number(countResult[0]?.count || 0);

    // Get paginated logs
    const logs = await db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset);

    return {
      logs: logs as AuditQueryResult["logs"],
      total,
      hasMore: offset + logs.length < total,
    };
  }

  /**
   * Get audit log by ID
   */
  async getById(id: string): Promise<AuditQueryResult["logs"][0] | null> {
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, id))
      .limit(1);

    if (!log) return null;

    return log as AuditQueryResult["logs"][0];
  }

  /**
   * Get recent activity for a specific resource
   */
  async getResourceHistory(
    resourceType: AuditResourceType,
    resourceId: string,
    limit = 20
  ): Promise<AuditQueryResult["logs"]> {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, resourceType),
          eq(auditLogs.resourceId, resourceId)
        )
      )
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);

    return logs as AuditQueryResult["logs"];
  }

  /**
   * Get activity summary for a tenant
   */
  async getTenantSummary(
    tenantId: string,
    days = 30
  ): Promise<{
    totalEvents: number;
    byAction: Record<string, number>;
    byResourceType: Record<string, number>;
    failureCount: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await db
      .select({
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        success: auditLogs.success,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          gte(auditLogs.timestamp, startDate)
        )
      );

    const byAction: Record<string, number> = {};
    const byResourceType: Record<string, number> = {};
    let failureCount = 0;

    for (const log of logs) {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      byResourceType[log.resourceType] = (byResourceType[log.resourceType] || 0) + 1;
      if (!log.success) {
        failureCount++;
      }
    }

    return {
      totalEvents: logs.length,
      byAction,
      byResourceType,
      failureCount,
    };
  }
}

// Export singleton instance
export const auditService = new AuditService();

// ============================================================================
// Helper functions for common audit patterns
// ============================================================================

/**
 * Calculate changes between old and new objects for audit metadata
 */
export function calculateChanges(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  sensitiveFields: string[] = ["password", "passwordHash", "token", "secret", "apiKey"]
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    // Skip if values are equal
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) {
      continue;
    }

    // Mask sensitive fields
    if (sensitiveFields.includes(key)) {
      changes[key] = { from: "[REDACTED]", to: "[REDACTED]" };
    } else {
      changes[key] = { from: oldVal, to: newVal };
    }
  }

  return changes;
}

/**
 * Extract IP address from request headers
 */
export function extractIpAddress(headers: Headers): string | undefined {
  // Check common proxy headers
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return undefined;
}
