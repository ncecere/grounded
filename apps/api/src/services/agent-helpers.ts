import { eq, and, isNull } from "drizzle-orm";
import { agents } from "@grounded/db/schema";
import type { Database } from "@grounded/db";
import type { InferSelectModel } from "drizzle-orm";
import { NotFoundError } from "../middleware/error-handler";

// ============================================================================
// Types
// ============================================================================

export type Agent = InferSelectModel<typeof agents>;

export interface AgentOwnershipResult {
  agent: Agent;
}

// ============================================================================
// Agent Ownership Loader
// ============================================================================

/**
 * Load an agent and verify it belongs to the specified tenant.
 * Throws NotFoundError if the agent doesn't exist or doesn't belong to the tenant.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param agentId - The agent ID to load
 * @param tenantId - The tenant ID to verify ownership against
 * @returns The loaded agent
 * @throws NotFoundError if agent not found or not owned by tenant
 *
 * @example
 * ```ts
 * const { agent } = await withRequestRLS(c, async (tx) => {
 *   return loadAgentForTenant(tx, agentId, authContext.tenantId!);
 * });
 * ```
 */
export async function loadAgentForTenant(
  tx: Database,
  agentId: string,
  tenantId: string
): Promise<AgentOwnershipResult> {
  const agent = await tx.query.agents.findFirst({
    where: and(
      eq(agents.id, agentId),
      eq(agents.tenantId, tenantId),
      isNull(agents.deletedAt)
    ),
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  return { agent };
}

/**
 * Load an agent and verify it belongs to the specified tenant.
 * Returns null instead of throwing if the agent doesn't exist.
 * Useful when you need to check existence before performing operations.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param agentId - The agent ID to load
 * @param tenantId - The tenant ID to verify ownership against
 * @returns The loaded agent or null
 *
 * @example
 * ```ts
 * const agent = await withRequestRLS(c, async (tx) => {
 *   return tryLoadAgentForTenant(tx, agentId, authContext.tenantId!);
 * });
 * if (!agent) {
 *   throw new NotFoundError("Agent");
 * }
 * ```
 */
export async function tryLoadAgentForTenant(
  tx: Database,
  agentId: string,
  tenantId: string
): Promise<Agent | null> {
  const agent = await tx.query.agents.findFirst({
    where: and(
      eq(agents.id, agentId),
      eq(agents.tenantId, tenantId),
      isNull(agents.deletedAt)
    ),
  });

  return agent ?? null;
}
