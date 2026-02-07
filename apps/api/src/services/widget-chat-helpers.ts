import type { Context } from "hono";
import { withRLSContext, type Database } from "@grounded/db";
import {
  widgetTokens,
  agents,
  agentWidgetConfigs,
  tenantQuotas,
} from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { checkRateLimit } from "@grounded/queue";
import { log } from "@grounded/logger";
import { NotFoundError, RateLimitError } from "../middleware/error-handler";
import { SimpleRAGService } from "./simple-rag";
import { AdvancedRAGService } from "./advanced-rag";
import type { InferSelectModel } from "drizzle-orm";
import type { WidgetChatInput } from "../modules/widget/schema";
import {
  hashPublicToken,
} from "./public-token-security";
import {
  enforcePublicAccessPolicy,
  getClientIp,
} from "./public-access-policy";
import { streamWithHeartbeat } from "./sse-stream";

export { widgetChatSchema } from "../modules/widget/schema";
export type { WidgetChatInput } from "../modules/widget/schema";

// ============================================================================
// Types
// ============================================================================

type WidgetToken = InferSelectModel<typeof widgetTokens>;
type Agent = InferSelectModel<typeof agents>;
type AgentWidgetConfig = InferSelectModel<typeof agentWidgetConfigs>;

export interface WidgetTokenValidation {
  widgetToken: WidgetToken;
  agent: Agent;
  widgetConfig: AgentWidgetConfig | null;
}

// ============================================================================
// Helper: Validate Widget Token
// ============================================================================

export async function validateWidgetToken(
  tx: Database,
  token: string
): Promise<WidgetTokenValidation> {
  const tokenHash = hashPublicToken(token);

  const widgetToken = await tx.query.widgetTokens.findFirst({
    where: and(
      eq(widgetTokens.tokenHash, tokenHash),
      isNull(widgetTokens.revokedAt)
    ),
  });

  if (!widgetToken) {
    throw new NotFoundError("Widget");
  }

  const agent = await tx.query.agents.findFirst({
    where: and(
      eq(agents.id, widgetToken.agentId),
      isNull(agents.deletedAt)
    ),
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  const widgetConfig = await tx.query.agentWidgetConfigs.findFirst({
    where: eq(agentWidgetConfigs.agentId, agent.id),
  });

  return { widgetToken, agent, widgetConfig: widgetConfig ?? null };
}

// ============================================================================
// Helper: Check Rate Limit
// ============================================================================

export async function checkWidgetRateLimit(
  tx: Database,
  {
    tenantId,
    tokenId,
    clientIp,
  }: {
    tenantId: string;
    tokenId: string;
    clientIp: string;
  }
): Promise<void> {
  const quota = await tx.query.tenantQuotas.findFirst({
    where: eq(tenantQuotas.tenantId, tenantId),
  });

  const tenantLimit = quota?.chatRateLimitPerMinute || 60;
  const tokenLimit = Math.max(20, Math.floor(tenantLimit / 2));
  const ipLimit = Math.max(30, tenantLimit);

  const [tenantResult, tokenResult, ipResult] = await Promise.all([
    checkRateLimit(`widget:chat:tenant:${tenantId}`, tenantLimit, 60),
    checkRateLimit(`widget:chat:token:${tokenId}`, tokenLimit, 60),
    checkRateLimit(`widget:chat:ip:${clientIp}`, ipLimit, 60),
  ]);

  const blocked = [tenantResult, tokenResult, ipResult].find((r) => !r.allowed);
  if (blocked) {
    const retryAfter = Math.ceil((blocked.resetAt - Date.now()) / 1000);
    throw new RateLimitError(retryAfter > 0 ? retryAfter : 60);
  }
}

// ============================================================================
// Shared Streaming Chat Handler
// ============================================================================

export async function handleWidgetChatStream(
  c: Context,
  token: string,
  body: WidgetChatInput
): Promise<Response> {
  const clientIp = getClientIp(c);

  // Validate token and check rate limit within RLS context
  const { widgetToken, agent, widgetConfig } = await withRLSContext(
    { isSystemAdmin: true },
    async (tx) => {
      const result = await validateWidgetToken(tx, token);
      await checkWidgetRateLimit(tx, {
        tenantId: result.widgetToken.tenantId,
        tokenId: result.widgetToken.id,
        clientIp,
      });
      return result;
    }
  );

  const accessDenied = await enforcePublicAccessPolicy(c, {
    isPublic: widgetConfig?.isPublic ?? true,
    allowedDomains: widgetConfig?.allowedDomains ?? [],
    oidcRequired: widgetConfig?.oidcRequired ?? false,
    requiredTenantId: widgetToken.tenantId,
  });

  if (accessDenied) {
    return accessDenied;
  }

  return streamWithHeartbeat(c, {
    onStream: async (controller) => {
      try {
        // Route to the appropriate RAG service based on agent configuration
        if (agent.ragType === "advanced") {
          const service = new AdvancedRAGService(widgetToken.tenantId, agent.id, "widget");
          for await (const event of service.chat(body.message, body.conversationId)) {
            if (controller.isAborted()) break;
            await controller.writeJson(event);
          }
        } else {
          const service = new SimpleRAGService(widgetToken.tenantId, agent.id);
          for await (const event of service.chat(body.message, body.conversationId)) {
            if (controller.isAborted()) break;
            await controller.writeJson(event);
          }
        }
      } catch (error) {
        log.error("api", "Widget chat stream error", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!controller.isAborted()) {
          await controller.writeJson({
            type: "error",
            message: "An error occurred while generating the response.",
          });
        }
      }
    },
  });
}
