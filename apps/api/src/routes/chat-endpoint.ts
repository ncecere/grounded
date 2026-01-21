import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { html } from "hono/html";
import { withRLSContext, type Database } from "@grounded/db";
import {
  chatEndpointTokens,
  agents,
  tenantQuotas,
} from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { checkRateLimit } from "@grounded/queue";
import { generateId } from "@grounded/shared";
import { log } from "@grounded/logger";
import { NotFoundError, RateLimitError } from "../middleware/error-handler";
import { SimpleRAGService, type StreamEvent } from "../services/simple-rag";
import { AdvancedRAGService, type ReasoningStep } from "../services/advanced-rag";
import { chatRequestSchema } from "../modules/chat-endpoint/schema";

export const chatEndpointRoutes = new Hono();

// ============================================================================
// Get Chat Endpoint Config (Public - for hosted UI)
// ============================================================================

chatEndpointRoutes.get("/:token/config", async (c) => {
  const token = c.req.param("token");

  const result = await withRLSContext({ isSystemAdmin: true }, async (tx) => {
    const endpointToken = await tx.query.chatEndpointTokens.findFirst({
      where: and(
        eq(chatEndpointTokens.token, token),
        isNull(chatEndpointTokens.revokedAt)
      ),
    });

    if (!endpointToken) {
      throw new NotFoundError("Chat endpoint");
    }

    const agent = await tx.query.agents.findFirst({
      where: and(
        eq(agents.id, endpointToken.agentId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    return { endpointToken, agent };
  });

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

  const endpointToken = await withRLSContext({ isSystemAdmin: true }, async (tx) => {
    return tx.query.chatEndpointTokens.findFirst({
      where: and(
        eq(chatEndpointTokens.token, token),
        isNull(chatEndpointTokens.revokedAt)
      ),
    });
  });

  if (!endpointToken) {
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

  // Only hosted endpoints should render the page
  if (endpointToken.endpointType !== "hosted") {
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

  const agent = await withRLSContext({ isSystemAdmin: true }, async (tx) => {
    return tx.query.agents.findFirst({
      where: and(
        eq(agents.id, endpointToken.agentId),
        isNull(agents.deletedAt)
      ),
    });
  });

  if (!agent) {
    return c.html(html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Agent Not Found</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
          .container { text-align: center; padding: 2rem; }
          h1 { color: #111827; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Agent Not Found</h1>
          <p>The agent for this chat has been removed.</p>
        </div>
      </body>
      </html>
    `, 404);
  }

  const agentName = agent.name;
  const welcomeMessage = agent.welcomeMessage || "How can I help you today?";
  const logoUrl = agent.logoUrl || null;
  const ragType = agent.ragType;
  const showReasoningSteps = agent.showReasoningSteps ?? true;

  // Get the base URL for loading static assets
  const baseUrl = new URL(c.req.url).origin;

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
      <script>
        groundedChat('init', {
          token: '${token}',
          apiBase: '',
          agentName: '${agentName}',
          welcomeMessage: '${welcomeMessage}',
          logoUrl: ${logoUrl ? `'${logoUrl}'` : 'null'},
          ragType: '${ragType}',
          showReasoningSteps: ${showReasoningSteps ? 'true' : 'false'}
        });
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

    // Validate token and get context
    const { endpointToken, agent, quotas } = await withRLSContext({ isSystemAdmin: true }, async (tx) => {
      const endpointToken = await tx.query.chatEndpointTokens.findFirst({
        where: and(
          eq(chatEndpointTokens.token, token),
          isNull(chatEndpointTokens.revokedAt)
        ),
      });

      if (!endpointToken) {
        throw new NotFoundError("Chat endpoint");
      }

      // Get agent (just to verify it exists)
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, endpointToken.agentId),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      // Check rate limit
      const quotas = await tx.query.tenantQuotas.findFirst({
        where: eq(tenantQuotas.tenantId, endpointToken.tenantId),
      });

      return { endpointToken, agent, quotas };
    });

    const rateLimit = quotas?.chatRateLimitPerMinute || 60;
    const rateLimitResult = await checkRateLimit(
      `chat_endpoint:${endpointToken.tenantId}`,
      rateLimit,
      60
    );

    if (!rateLimitResult.allowed) {
      c.header("X-RateLimit-Limit", rateLimit.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");
      throw new RateLimitError(60);
    }

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

    // Validate token and get context
    const { endpointToken, agent, quotas } = await withRLSContext({ isSystemAdmin: true }, async (tx) => {
      const endpointToken = await tx.query.chatEndpointTokens.findFirst({
        where: and(
          eq(chatEndpointTokens.token, token),
          isNull(chatEndpointTokens.revokedAt)
        ),
      });

      if (!endpointToken) {
        throw new NotFoundError("Chat endpoint");
      }

      // Get agent
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, endpointToken.agentId),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      // Check rate limit
      const quotas = await tx.query.tenantQuotas.findFirst({
        where: eq(tenantQuotas.tenantId, endpointToken.tenantId),
      });

      return { endpointToken, agent, quotas };
    });

    const rateLimit = quotas?.chatRateLimitPerMinute || 60;
    const rateLimitResult = await checkRateLimit(
      `chat_endpoint:${endpointToken.tenantId}`,
      rateLimit,
      60
    );

    if (!rateLimitResult.allowed) {
      c.header("X-RateLimit-Limit", rateLimit.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");
      throw new RateLimitError(60);
    }

    // Headers for SSE streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Connection", "keep-alive");

    return streamSSE(c, async (stream) => {
      let aborted = false;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      // Handle client disconnect
      stream.onAbort(() => {
        log.debug("api", "Chat endpoint stream client disconnected");
        aborted = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      });

      // Heartbeat to keep connection alive
      heartbeatInterval = setInterval(async () => {
        if (!aborted) {
          try {
            await stream.writeSSE({ data: JSON.stringify({ type: "ping" }) });
          } catch {
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              heartbeatInterval = null;
            }
          }
        }
      }, 2000);

      try {
        // Route to the appropriate RAG service based on agent configuration
        if (agent.ragType === "advanced") {
          // Advanced RAG mode - emits reasoning events
          const ragService = new AdvancedRAGService(endpointToken.tenantId, endpointToken.agentId, "chat_endpoint");

          for await (const event of ragService.chat(body.message, body.conversationId)) {
            if (aborted) break;

            switch (event.type) {
              case "status":
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: event.status,
                    message: event.message,
                    sourceCount: event.sourceCount,
                  }),
                });
                break;

              case "reasoning":
                // Pass through reasoning events for advanced mode
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "reasoning",
                    step: event.step,
                  }),
                });
                break;

              case "text":
                await stream.writeSSE({
                  data: JSON.stringify({ type: "text", content: event.content }),
                });
                break;

              case "sources":
                // Send sources event if citations are enabled
                if (agent.citationsEnabled) {
                  await stream.writeSSE({
                    data: JSON.stringify({
                      type: "sources",
                      sources: event.sources,
                    }),
                  });
                }
                break;

              case "done":
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "done",
                    conversationId: event.conversationId,
                  }),
                });
                break;

              case "error":
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "error",
                    message: event.message,
                  }),
                });
                break;
            }
          }
        } else {
          // Simple RAG mode
          // Send initial status
          await stream.writeSSE({
            data: JSON.stringify({
              type: "status",
              status: "searching",
              message: "Searching knowledge base...",
            }),
          });

          const ragService = new SimpleRAGService(endpointToken.tenantId, endpointToken.agentId);
          let statusSent = false;

          for await (const event of ragService.chat(body.message, body.conversationId)) {
            if (aborted) break;

            switch (event.type) {
              case "text":
                // Send generating status once before first text
                if (!statusSent) {
                  await stream.writeSSE({
                    data: JSON.stringify({
                      type: "status",
                      status: "generating",
                      message: "Generating response...",
                    }),
                  });
                  statusSent = true;
                }
                await stream.writeSSE({
                  data: JSON.stringify({ type: "text", content: event.content }),
                });
                break;

              case "sources":
                // Send sources event if citations are enabled
                if (agent.citationsEnabled) {
                  await stream.writeSSE({
                    data: JSON.stringify({
                      type: "sources",
                      sources: event.sources,
                    }),
                  });
                }
                break;

              case "done":
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "done",
                    conversationId: event.conversationId,
                  }),
                });
                break;

              case "error":
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "error",
                    message: event.message,
                  }),
                });
                break;
            }
          }
        }
      } catch (error) {
        log.error("api", "Chat endpoint stream error", { error: error instanceof Error ? error.message : String(error) });
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: "An error occurred while generating the response.",
          }),
        });
      } finally {
        // Cleanup heartbeat
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        // Close the stream
        await stream.close();
      }
    });
  }
);
