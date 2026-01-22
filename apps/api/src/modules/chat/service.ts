import type { Database } from "@grounded/db";
import { tryLoadAgentForTenant } from "../../services/agent-helpers";

export type ChatRagType = "simple" | "advanced";

export async function getChatAgentRagType(
  tx: Database,
  {
    agentId,
    tenantId,
  }: {
    agentId: string;
    tenantId: string;
  }
): Promise<ChatRagType | null> {
  const agent = await tryLoadAgentForTenant(tx, agentId, tenantId);
  return agent?.ragType ?? null;
}
