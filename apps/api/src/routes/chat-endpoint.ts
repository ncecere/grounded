import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { html, raw } from "hono/html";
import { withRLSContext, type Database } from "@grounded/db";
import {
  chatEndpointTokens,
  agents,
  agentWidgetConfigs,
  tenantQuotas,
} from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { checkRateLimit } from "@grounded/queue";
import { generateId } from "@grounded/shared";
import { log } from "@grounded/logger";
import { NotFoundError, RateLimitError } from "../middleware/error-handler";
import { SimpleRAGService } from "../services/simple-rag";
import { AdvancedRAGService, type ReasoningStep } from "../services/advanced-rag";
import { chatRequestSchema } from "../modules/chat-endpoint/schema";
import {
  enforcePublicAccessPolicy,
  getClientIp,
} from "../services/public-access-policy";
import {
  hashPublicToken,
} from "../services/public-token-security";
import { streamWithHeartbeat } from "../services/sse-stream";

export const chatEndpointRoutes = new Hono();

type ChatEndpointTokenRecord = Awaited<ReturnType<Database["query"]["chatEndpointTokens"]["findFirst"]>>;
type AgentRecord = Awaited<ReturnType<Database["query"]["agents"]["findFirst"]>>;
type WidgetConfigRecord = Awaited<ReturnType<Database["query"]["agentWidgetConfigs"]["findFirst"]>>;
type TenantQuotaRecord = Awaited<ReturnType<Database["query"]["tenantQuotas"]["findFirst"]>>;

interface ChatEndpointContext {
  endpointToken: NonNullable<ChatEndpointTokenRecord>;
  agent: NonNullable<AgentRecord>;
  widgetConfig: WidgetConfigRecord;
  quotas: TenantQuotaRecord;
}

async function findChatEndpointTokenByRawToken(
  tx: Database,
  rawToken: string
): Promise<NonNullable<ChatEndpointTokenRecord>> {
  const tokenHash = hashPublicToken(rawToken);

  const endpointToken = await tx.query.chatEndpointTokens.findFirst({
    where: and(
      eq(chatEndpointTokens.tokenHash, tokenHash),
      isNull(chatEndpointTokens.revokedAt)
    ),
  });

  if (!endpointToken) {
    throw new NotFoundError("Chat endpoint");
  }

  return endpointToken;
}

async function loadChatEndpointContext(
  tx: Database,
  rawToken: string
): Promise<ChatEndpointContext> {
  const endpointToken = await findChatEndpointTokenByRawToken(tx, rawToken);

  const agent = await tx.query.agents.findFirst({
    where: and(
      eq(agents.id, endpointToken.agentId),
      isNull(agents.deletedAt)
    ),
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  const widgetConfig = await tx.query.agentWidgetConfigs.findFirst({
    where: eq(agentWidgetConfigs.agentId, endpointToken.agentId),
  });

  const quotas = await tx.query.tenantQuotas.findFirst({
    where: eq(tenantQuotas.tenantId, endpointToken.tenantId),
  });

  return { endpointToken, agent, widgetConfig, quotas };
}

function serializeInlineConfig(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function checkChatEndpointRateLimit(options: {
  endpointToken: NonNullable<ChatEndpointTokenRecord>;
  quotas: TenantQuotaRecord;
  clientIp: string;
}) {
  const tenantLimit = options.quotas?.chatRateLimitPerMinute || 60;
  const tokenLimit = Math.max(20, Math.floor(tenantLimit / 2));
  const ipLimit = Math.max(30, tenantLimit);

  const [tenantResult, tokenResult, ipResult] = await Promise.all([
    checkRateLimit(`chat_endpoint:tenant:${options.endpointToken.tenantId}`, tenantLimit, 60),
    checkRateLimit(`chat_endpoint:token:${options.endpointToken.id}`, tokenLimit, 60),
    checkRateLimit(`chat_endpoint:ip:${options.clientIp}`, ipLimit, 60),
  ]);

  const blocked = [tenantResult, tokenResult, ipResult].find((r) => !r.allowed);
  if (blocked) {
    throw new RateLimitError(Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 1000)));
  }
}

// ============================================================================
// Get Chat Endpoint Config (Public - for hosted UI)
// ============================================================================

chatEndpointRoutes.get("/:token/config", async (c) => {
  const token = c.req.param("token");

  const result = await withRLSContext({ isSystemAdmin: true }, async (tx) => {
    return loadChatEndpointContext(tx, token);
  });

  const accessDenied = await enforcePublicAccessPolicy(c, {
    isPublic: result.widgetConfig?.isPublic ?? true,
    allowedDomains: result.widgetConfig?.allowedDomains ?? [],
    oidcRequired: result.widgetConfig?.oidcRequired ?? false,
    requiredTenantId: result.endpointToken.tenantId,
  });
  if (accessDenied) return accessDenied;

  return c.json({
    agentName: result.agent.name,
    description: result.agent.description || "Ask me anything. I'm here to assist you.",
    welcomeMessage: result.agent.welcomeMessage || "How can I help?",
    logoUrl: result.agent.logoUrl || null,
    endpointType: result.endpointToken.endpointType,
    ragType: result.agent.ragType,
    showReasoningSteps: result.agent.showReasoningSteps,
  });
});

// ============================================================================
// Hosted Chat Page (Public)
// ============================================================================

chatEndpointRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");

  const context = await withRLSContext({ isSystemAdmin: true }, async (tx) => {
    return loadChatEndpointContext(tx, token);
  }).catch((error) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  });

  if (!context) {
    return c.html(html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chat Not Found</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
          .container { text-align: center; padding: 2rem; }
          h1 { color: #111827; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Chat Not Found</h1>
          <p>This chat endpoint doesn't exist or has been revoked.</p>
        </div>
      </body>
      </html>
    `, 404);
  }

  const accessDenied = await enforcePublicAccessPolicy(c, {
    isPublic: context.widgetConfig?.isPublic ?? true,
    allowedDomains: context.widgetConfig?.allowedDomains ?? [],
    oidcRequired: context.widgetConfig?.oidcRequired ?? false,
    requiredTenantId: context.endpointToken.tenantId,
  });
  if (accessDenied) return accessDenied;

  // Only hosted endpoints should render the page
  if (context.endpointToken.endpointType !== "hosted") {
    return c.html(html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>API Endpoint</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
          .container { text-align: center; padding: 2rem; max-width: 600px; }
          h1 { color: #111827; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
          code { background: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>API Endpoint</h1>
          <p>This is an API endpoint. Use it programmatically:</p>
          <p><code>POST /api/v1/c/${token}/chat</code></p>
        </div>
      </body>
      </html>
    `, 400);
  }

  const agentName = context.agent.name;
  const welcomeMessage = context.agent.welcomeMessage || "How can I help you today?";
  const logoUrl = context.agent.logoUrl || null;
  const ragType = context.agent.ragType;
  const showReasoningSteps = context.agent.showReasoningSteps ?? true;

  const nonce = globalThis.crypto.randomUUID().replace(/-/g, "");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'nonce-" + nonce + "'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");

  const inlineConfig = serializeInlineConfig({
    token,
    apiBase: "",
    agentName,
    welcomeMessage,
    logoUrl,
    ragType,
    showReasoningSteps,
  });

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${agentName}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; }
        body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
      </style>
    </head>
    <body>
      <div id="grounded-chat-root"></div>
      <script src="/published-chat.js?v=${Date.now()}"></script>
      <script nonce="${nonce}">
        const chatConfig = ${raw(inlineConfig)};
        groundedChat('init', chatConfig);
      </script>
    </body>
    </html>
  `);
});

// ============================================================================
// Chat Endpoint - Non-streaming (Public)
// ============================================================================

chatEndpointRoutes.post(
  "/:token/chat",
  zValidator("json", chatRequestSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");
    const clientIp = getClientIp(c);

    // Validate token, policy, and rate limits
    const { endpointToken, agent, widgetConfig } = await withRLSContext(
      { isSystemAdmin: true },
      async (tx) => {
        const result = await loadChatEndpointContext(tx, token);
        await checkChatEndpointRateLimit({
          endpointToken: result.endpointToken,
          quotas: result.quotas,
          clientIp,
        });
        return result;
      }
    );

    const accessDenied = await enforcePublicAccessPolicy(c, {
      isPublic: widgetConfig?.isPublic ?? true,
      allowedDomains: widgetConfig?.allowedDomains ?? [],
      oidcRequired: widgetConfig?.oidcRequired ?? false,
      requiredTenantId: endpointToken.tenantId,
    });
    if (accessDenied) return accessDenied;

    // Collect all events into a single response
    let answer = "";
    let conversationId = body.conversationId || generateId();
    let citations: Array<{ title: string; url?: string; snippet: string; index: number }> = [];
    let reasoningSteps: ReasoningStep[] = [];

    // Route to the appropriate RAG service based on agent configuration
    if (agent.ragType === "advanced") {
      const ragService = new AdvancedRAGService(endpointToken.tenantId, endpointToken.agentId, "chat_endpoint");

      for await (const event of ragService.chat(body.message, body.conversationId)) {
        switch (event.type) {
          case "text":
            answer += event.content;
            break;
          case "sources":
            citations = event.sources.map((s) => ({
              title: s.title,
              url: s.url,
              snippet: s.snippet,
              index: s.index,
            }));
            break;
          case "reasoning":
            // Collect completed reasoning steps
            if (event.step.status === "completed") {
              reasoningSteps.push(event.step);
            }
            break;
          case "done":
            conversationId = event.conversationId;
            break;
          case "error":
            return c.json({ error: event.message }, 500);
        }
      }
    } else {
      const ragService = new SimpleRAGService(endpointToken.tenantId, endpointToken.agentId);

      for await (const event of ragService.chat(body.message, body.conversationId)) {
        switch (event.type) {
          case "text":
            answer += event.content;
            break;
          case "sources":
            citations = event.sources.map((s) => ({
              title: s.title,
              url: s.url,
              snippet: s.snippet,
              index: s.index,
            }));
            break;
          case "done":
            conversationId = event.conversationId;
            break;
          case "error":
            return c.json({ error: event.message }, 500);
        }
      }
    }

    // Filter citations if disabled on agent
    const finalCitations = agent.citationsEnabled ? citations : [];

    // Build response - include reasoning steps only for advanced mode
    const response: {
      answer: string;
      citations: typeof finalCitations;
      conversationId: string;
      reasoningSteps?: ReasoningStep[];
    } = {
      answer,
      citations: finalCitations,
      conversationId,
    };

    if (agent.ragType === "advanced" && reasoningSteps.length > 0) {
      response.reasoningSteps = reasoningSteps;
    }

    return c.json(response);
  }
);

// ============================================================================
// Chat Endpoint - Streaming (Public)
// ============================================================================

chatEndpointRoutes.post(
  "/:token/chat/stream",
  zValidator("json", chatRequestSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");
    const clientIp = getClientIp(c);

    // Validate token, policy, and rate limits
    const { endpointToken, agent, widgetConfig } = await withRLSContext(
      { isSystemAdmin: true },
      async (tx) => {
        const result = await loadChatEndpointContext(tx, token);
        await checkChatEndpointRateLimit({
          endpointToken: result.endpointToken,
          quotas: result.quotas,
          clientIp,
        });
        return result;
      }
    );

    const accessDenied = await enforcePublicAccessPolicy(c, {
      isPublic: widgetConfig?.isPublic ?? true,
      allowedDomains: widgetConfig?.allowedDomains ?? [],
      oidcRequired: widgetConfig?.oidcRequired ?? false,
      requiredTenantId: endpointToken.tenantId,
    });
    if (accessDenied) return accessDenied;

    return streamWithHeartbeat(c, {
      onAbort: () => {
        log.debug("api", "Chat endpoint stream client disconnected");
      },
      onStream: async ({ isAborted, writeJson }) => {
        try {
        // Route to the appropriate RAG service based on agent configuration
        if (agent.ragType === "advanced") {
          // Advanced RAG mode - emits reasoning events
          const ragService = new AdvancedRAGService(endpointToken.tenantId, endpointToken.agentId, "chat_endpoint");

          for await (const event of ragService.chat(body.message, body.conversationId)) {
            if (isAborted()) break;

            switch (event.type) {
              case "status":
                await writeJson({
                  type: "status",
                  status: event.status,
                  message: event.message,
                  sourceCount: event.sourceCount,
                });
                break;

              case "reasoning":
                // Pass through reasoning events for advanced mode
                await writeJson({
                  type: "reasoning",
                  step: event.step,
                });
                break;

              case "text":
                await writeJson({ type: "text", content: event.content });
                break;

              case "sources":
                // Send sources event if citations are enabled
                if (agent.citationsEnabled) {
                  await writeJson({
                    type: "sources",
                    sources: event.sources,
                  });
                }
                break;

              case "done":
                await writeJson({
                  type: "done",
                  conversationId: event.conversationId,
                });
                break;

              case "error":
                await writeJson({
                  type: "error",
                  message: event.message,
                });
                break;
            }
          }
        } else {
          // Simple RAG mode
          // Send initial status
          await writeJson({
            type: "status",
            status: "searching",
            message: "Searching knowledge base...",
          });

          const ragService = new SimpleRAGService(endpointToken.tenantId, endpointToken.agentId);
          let statusSent = false;

          for await (const event of ragService.chat(body.message, body.conversationId)) {
            if (isAborted()) break;

            switch (event.type) {
              case "text":
                // Send generating status once before first text
                if (!statusSent) {
                  await writeJson({
                    type: "status",
                    status: "generating",
                    message: "Generating response...",
                  });
                  statusSent = true;
                }
                await writeJson({ type: "text", content: event.content });
                break;

              case "sources":
                // Send sources event if citations are enabled
                if (agent.citationsEnabled) {
                  await writeJson({
                    type: "sources",
                    sources: event.sources,
                  });
                }
                break;

              case "done":
                await writeJson({
                  type: "done",
                  conversationId: event.conversationId,
                });
                break;

              case "error":
                await writeJson({
                  type: "error",
                  message: event.message,
                });
                break;
            }
          }
        }
      } catch (error) {
        log.error("api", "Chat endpoint stream error", { error: error instanceof Error ? error.message : String(error) });
        if (!isAborted()) {
          await writeJson({
            type: "error",
            message: "An error occurred while generating the response.",
          });
        }
      }
    },
    });
  }
);
