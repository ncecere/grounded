import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { db } from "@grounded/db";
import {
  widgetTokens,
  agents,
  agentKbs,
  agentWidgetConfigs,
  agentCapabilities,
  retrievalConfigs,
  kbChunks,
  chatEvents,
  tenantQuotas,
} from "@grounded/db/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { generateEmbedding } from "@grounded/embeddings";
import { generateRAGResponse, generateRAGResponseStream, type ChunkContext } from "@grounded/llm";
import { getVectorStore } from "@grounded/vector-store";
import type { Citation } from "@grounded/shared";
import { getConversation, addToConversation, checkRateLimit } from "@grounded/queue";
import { generateId } from "@grounded/shared";
import { NotFoundError, ForbiddenError, RateLimitError } from "../middleware/error-handler";
import { AgenticChatService, type ChainOfThoughtStep } from "../services/agentic-chat";

export const widgetRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const widgetChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

// ============================================================================
// Get Widget Config (Public)
// ============================================================================

widgetRoutes.get("/:token/config", async (c) => {
  const token = c.req.param("token");

  const widgetToken = await db.query.widgetTokens.findFirst({
    where: and(
      eq(widgetTokens.token, token),
      isNull(widgetTokens.revokedAt)
    ),
  });

  if (!widgetToken) {
    throw new NotFoundError("Widget");
  }

  const agent = await db.query.agents.findFirst({
    where: and(
      eq(agents.id, widgetToken.agentId),
      isNull(agents.deletedAt)
    ),
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  const widgetConfig = await db.query.agentWidgetConfigs.findFirst({
    where: eq(agentWidgetConfigs.agentId, agent.id),
  });

  // Get agent capabilities for agentic mode
  const capabilities = await db.query.agentCapabilities.findFirst({
    where: eq(agentCapabilities.agentId, agent.id),
  });

  return c.json({
    agentName: agent.name,
    description: agent.description || "Ask me anything. I'm here to assist you.",
    welcomeMessage: agent.welcomeMessage || "How can I help?",
    logoUrl: agent.logoUrl || null,
    theme: widgetConfig?.theme || {},
    isPublic: widgetConfig?.isPublic ?? true,
    // Agentic capabilities
    agenticMode: {
      enabled: capabilities?.agenticModeEnabled ?? false,
      showChainOfThought: capabilities?.showChainOfThought ?? false,
    },
  });
});

// ============================================================================
// Widget Chat (Public)
// ============================================================================

widgetRoutes.post(
  "/:token/chat",
  zValidator("json", widgetChatSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Validate token
    const widgetToken = await db.query.widgetTokens.findFirst({
      where: and(
        eq(widgetTokens.token, token),
        isNull(widgetTokens.revokedAt)
      ),
    });

    if (!widgetToken) {
      throw new NotFoundError("Widget");
    }

    // Get agent
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, widgetToken.agentId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    // Get widget config
    const widgetConfig = await db.query.agentWidgetConfigs.findFirst({
      where: eq(agentWidgetConfigs.agentId, agent.id),
    });

    // Validate domain allowlist
    const origin = c.req.header("Origin");
    const referer = c.req.header("Referer");
    const requestDomain = origin || (referer ? new URL(referer).origin : null);

    if (widgetConfig && widgetConfig.allowedDomains.length > 0 && requestDomain) {
      const domainAllowed = widgetConfig.allowedDomains.some((allowed) => {
        if (allowed.startsWith("*.")) {
          // Wildcard match
          const baseDomain = allowed.slice(2);
          return (
            requestDomain.endsWith(baseDomain) ||
            requestDomain.endsWith(`.${baseDomain}`)
          );
        }
        return requestDomain.includes(allowed);
      });

      if (!domainAllowed) {
        throw new ForbiddenError("Domain not allowed");
      }
    }

    // Check rate limit
    const quotas = await db.query.tenantQuotas.findFirst({
      where: eq(tenantQuotas.tenantId, widgetToken.tenantId),
    });

    const rateLimit = quotas?.chatRateLimitPerMinute || 60;
    const rateLimitResult = await checkRateLimit(
      `widget:${widgetToken.tenantId}`,
      rateLimit,
      60
    );

    if (!rateLimitResult.allowed) {
      c.header("X-RateLimit-Limit", rateLimit.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");
      throw new RateLimitError(60);
    }

    // Get retrieval config
    const config = await db.query.retrievalConfigs.findFirst({
      where: eq(retrievalConfigs.agentId, agent.id),
    });

    const topK = config?.topK || 8;
    const candidateK = config?.candidateK || 40;
    const rerankerEnabled = config?.rerankerEnabled ?? true;
    const maxCitations = config?.maxCitations || 3;

    // Get attached KB IDs
    const attachedKbs = await db.query.agentKbs.findMany({
      where: and(eq(agentKbs.agentId, agent.id), isNull(agentKbs.deletedAt)),
    });

    const kbIds = attachedKbs.map((ak) => ak.kbId);

    if (kbIds.length === 0) {
      return c.json({
        answer: "I'm not configured with any knowledge sources yet.",
        citations: [],
        conversationId: body.conversationId || generateId(),
      });
    }

    // Get conversation history
    const conversationId = body.conversationId || generateId();
    const history = await getConversation(
      widgetToken.tenantId,
      agent.id,
      conversationId
    );

    // Retrieve relevant chunks
    const chunks = await retrieveChunks(
      widgetToken.tenantId,
      kbIds,
      body.message,
      candidateK,
      topK,
      rerankerEnabled
    );

    // Build context for RAG
    const chunkContexts: ChunkContext[] = chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      title: chunk.title,
      url: chunk.normalizedUrl,
      heading: chunk.heading,
    }));

    // Generate response
    const conversationHistory = history.map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: turn.content,
    }));

    // Build complete system prompt including description
    const fullSystemPrompt = agent.description
      ? `${agent.systemPrompt}\n\nAgent Description: ${agent.description}`
      : agent.systemPrompt;

    const ragResponse = await generateRAGResponse(
      body.message,
      chunkContexts,
      {
        systemPrompt: fullSystemPrompt,
        conversationHistory,
        maxCitations,
      }
    );

    console.log("[Widget Chat] RAG Response:", {
      answerLength: ragResponse.answer?.length,
      answerPreview: ragResponse.answer?.slice(0, 100),
      citationsCount: ragResponse.citations?.length,
      tokens: { prompt: ragResponse.inputTokens, completion: ragResponse.outputTokens }
    });

    // Update conversation memory
    await addToConversation(widgetToken.tenantId, agent.id, conversationId, {
      role: "user",
      content: body.message,
      timestamp: Date.now(),
    });

    await addToConversation(widgetToken.tenantId, agent.id, conversationId, {
      role: "assistant",
      content: ragResponse.answer,
      timestamp: Date.now(),
    });

    // Log chat event (metadata only)
    const latencyMs = Date.now() - startTime;
    await db.insert(chatEvents).values({
      tenantId: widgetToken.tenantId,
      agentId: agent.id,
      userId: null,
      channel: "widget",
      status: "ok",
      latencyMs,
      promptTokens: ragResponse.inputTokens,
      completionTokens: ragResponse.outputTokens,
      retrievedChunks: chunks.length,
      rerankerUsed: rerankerEnabled,
    });

    // Filter citations if disabled
    const citations = agent.citationsEnabled ? ragResponse.citations : [];

    return c.json({
      answer: ragResponse.answer,
      citations,
      conversationId,
    });
  }
);

// ============================================================================
// Widget Streaming Chat (Public)
// ============================================================================

widgetRoutes.post(
  "/:token/chat/stream",
  zValidator("json", widgetChatSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Validate token
    const widgetToken = await db.query.widgetTokens.findFirst({
      where: and(
        eq(widgetTokens.token, token),
        isNull(widgetTokens.revokedAt)
      ),
    });

    if (!widgetToken) {
      throw new NotFoundError("Widget");
    }

    // Get agent
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, widgetToken.agentId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    // Get widget config
    const widgetConfig = await db.query.agentWidgetConfigs.findFirst({
      where: eq(agentWidgetConfigs.agentId, agent.id),
    });

    // Validate domain allowlist
    const origin = c.req.header("Origin");
    const referer = c.req.header("Referer");
    const requestDomain = origin || (referer ? new URL(referer).origin : null);

    if (widgetConfig && widgetConfig.allowedDomains.length > 0 && requestDomain) {
      const domainAllowed = widgetConfig.allowedDomains.some((allowed) => {
        if (allowed.startsWith("*.")) {
          const baseDomain = allowed.slice(2);
          return (
            requestDomain.endsWith(baseDomain) ||
            requestDomain.endsWith(`.${baseDomain}`)
          );
        }
        return requestDomain.includes(allowed);
      });

      if (!domainAllowed) {
        throw new ForbiddenError("Domain not allowed");
      }
    }

    // Check rate limit
    const quotas = await db.query.tenantQuotas.findFirst({
      where: eq(tenantQuotas.tenantId, widgetToken.tenantId),
    });

    const rateLimit = quotas?.chatRateLimitPerMinute || 60;
    const rateLimitResult = await checkRateLimit(
      `widget:${widgetToken.tenantId}`,
      rateLimit,
      60
    );

    if (!rateLimitResult.allowed) {
      c.header("X-RateLimit-Limit", rateLimit.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");
      throw new RateLimitError(60);
    }

    // Get retrieval config
    const config = await db.query.retrievalConfigs.findFirst({
      where: eq(retrievalConfigs.agentId, agent.id),
    });

    const topK = config?.topK || 8;
    const candidateK = config?.candidateK || 40;
    const rerankerEnabled = config?.rerankerEnabled ?? true;
    const maxCitations = config?.maxCitations || 3;

    // Get attached KB IDs
    const attachedKbs = await db.query.agentKbs.findMany({
      where: and(eq(agentKbs.agentId, agent.id), isNull(agentKbs.deletedAt)),
    });

    const kbIds = attachedKbs.map((ak) => ak.kbId);
    const conversationId = body.conversationId || generateId();

    if (kbIds.length === 0) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "text",
            content: "I'm not configured with any knowledge sources yet.",
          }),
        });
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            conversationId,
            citations: [],
          }),
        });
      });
    }

    // Build complete system prompt including description
    const fullSystemPrompt = agent.description
      ? `${agent.systemPrompt}\n\nAgent Description: ${agent.description}`
      : agent.systemPrompt;

    // Headers for SSE streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Connection", "keep-alive");

    return streamSSE(c, async (stream) => {
      let fullAnswer = "";
      let finalResponse: { answer: string; citations: Citation[]; inputTokens: number; outputTokens: number } | null = null;
      let chunks: any[] = [];
      let aborted = false;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      // Handle client disconnect
      stream.onAbort(() => {
        console.log("[Widget Stream] Client disconnected");
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
        // Send status: searching
        await stream.writeSSE({
          data: JSON.stringify({
            type: "status",
            status: "searching",
            message: "Searching knowledge base...",
          }),
        });

        // Get conversation history
        const history = await getConversation(
          widgetToken.tenantId,
          agent.id,
          conversationId
        );

        // Retrieve relevant chunks
        chunks = await retrieveChunks(
          widgetToken.tenantId,
          kbIds,
          body.message,
          candidateK,
          topK,
          rerankerEnabled
        );

        // Send status: generating with sources count
        await stream.writeSSE({
          data: JSON.stringify({
            type: "status",
            status: "generating",
            message: chunks.length > 0
              ? `Found ${chunks.length} relevant sources. Generating response...`
              : "Generating response...",
            sourcesCount: chunks.length,
          }),
        });

        // Build context for RAG
        const chunkContexts: ChunkContext[] = chunks.map((chunk) => ({
          id: chunk.id,
          content: chunk.content,
          title: chunk.title,
          url: chunk.normalizedUrl,
          heading: chunk.heading,
        }));

        const conversationHistory = history.map((turn) => ({
          role: turn.role as "user" | "assistant",
          content: turn.content,
        }));

        // Store user message first
        await addToConversation(widgetToken.tenantId, agent.id, conversationId, {
          role: "user",
          content: body.message,
          timestamp: Date.now(),
        });

        const generator = generateRAGResponseStream(
          body.message,
          chunkContexts,
          {
            systemPrompt: fullSystemPrompt,
            conversationHistory,
            maxCitations,
          }
        );

        // Stream text chunks
        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            finalResponse = value;
            break;
          }
          fullAnswer += value;
          await stream.writeSSE({
            data: JSON.stringify({ type: "text", content: value }),
          });
        }

        // Store assistant message
        await addToConversation(widgetToken.tenantId, agent.id, conversationId, {
          role: "assistant",
          content: fullAnswer,
          timestamp: Date.now(),
        });

        // Log chat event
        const latencyMs = Date.now() - startTime;
        await db.insert(chatEvents).values({
          tenantId: widgetToken.tenantId,
          agentId: agent.id,
          userId: null,
          channel: "widget",
          status: "ok",
          latencyMs,
          promptTokens: finalResponse?.inputTokens || 0,
          completionTokens: finalResponse?.outputTokens || 0,
          retrievedChunks: chunks.length,
          rerankerUsed: rerankerEnabled,
        });

        // Send final message with citations
        const citations = agent.citationsEnabled ? (finalResponse?.citations || []) : [];
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            conversationId,
            citations,
          }),
        });

        // Clear heartbeat and close stream
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        await stream.close();
      } catch (error) {
        console.error("[Widget Stream] Error:", error);
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: "An error occurred while generating the response.",
          }),
        });
        await stream.close();
      }
    });
  }
);

// ============================================================================
// Widget Agentic Streaming Chat (Public)
// ============================================================================

widgetRoutes.post(
  "/:token/chat/agentic",
  zValidator("json", widgetChatSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Validate token
    const widgetToken = await db.query.widgetTokens.findFirst({
      where: and(
        eq(widgetTokens.token, token),
        isNull(widgetTokens.revokedAt)
      ),
    });

    if (!widgetToken) {
      throw new NotFoundError("Widget");
    }

    // Get agent
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, widgetToken.agentId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    // Get agent capabilities
    const capabilities = await db.query.agentCapabilities.findFirst({
      where: eq(agentCapabilities.agentId, agent.id),
    });

    // Get widget config
    const widgetConfig = await db.query.agentWidgetConfigs.findFirst({
      where: eq(agentWidgetConfigs.agentId, agent.id),
    });

    // Validate domain allowlist
    const origin = c.req.header("Origin");
    const referer = c.req.header("Referer");
    const requestDomain = origin || (referer ? new URL(referer).origin : null);

    if (widgetConfig && widgetConfig.allowedDomains.length > 0 && requestDomain) {
      const domainAllowed = widgetConfig.allowedDomains.some((allowed) => {
        if (allowed.startsWith("*.")) {
          const baseDomain = allowed.slice(2);
          return (
            requestDomain.endsWith(baseDomain) ||
            requestDomain.endsWith(`.${baseDomain}`)
          );
        }
        return requestDomain.includes(allowed);
      });

      if (!domainAllowed) {
        throw new ForbiddenError("Domain not allowed");
      }
    }

    // Check rate limit
    const quotas = await db.query.tenantQuotas.findFirst({
      where: eq(tenantQuotas.tenantId, widgetToken.tenantId),
    });

    const rateLimit = quotas?.chatRateLimitPerMinute || 60;
    const rateLimitResult = await checkRateLimit(
      `widget:${widgetToken.tenantId}`,
      rateLimit,
      60
    );

    if (!rateLimitResult.allowed) {
      c.header("X-RateLimit-Limit", rateLimit.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");
      throw new RateLimitError(60);
    }

    // Get attached KB IDs
    const attachedKbs = await db.query.agentKbs.findMany({
      where: and(eq(agentKbs.agentId, agent.id), isNull(agentKbs.deletedAt)),
    });

    const kbIds = attachedKbs.map((ak) => ak.kbId);
    const conversationId = body.conversationId || generateId();

    // Check if agentic mode is enabled
    const isAgenticMode = capabilities?.agenticModeEnabled ?? false;
    const showChainOfThought = capabilities?.showChainOfThought ?? false;

    if (kbIds.length === 0) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "text",
            content: "I'm not configured with any knowledge sources yet.",
          }),
        });
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            conversationId,
            citations: [],
          }),
        });
      });
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
        console.log("[Widget Agentic Stream] Client disconnected");
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
        // Get conversation history
        const history = await getConversation(
          widgetToken.tenantId,
          agent.id,
          conversationId
        );

        const conversationHistory = history.map((turn) => ({
          role: turn.role as "user" | "assistant",
          content: turn.content,
        }));

        // Store user message first
        await addToConversation(widgetToken.tenantId, agent.id, conversationId, {
          role: "user",
          content: body.message,
          timestamp: Date.now(),
        });

        // Use AgenticChatService for streaming
        const agenticService = new AgenticChatService(widgetToken.tenantId, agent.id);

        let fullAnswer = "";
        const chainOfThought: ChainOfThoughtStep[] = [];

        const generator = agenticService.generateResponseStream(
          {
            tenantId: widgetToken.tenantId,
            agentId: agent.id,
            message: body.message,
            conversationHistory,
            modelConfigId: agent.llmModelConfigId || undefined,
          },
          {
            onChainOfThought: async (step) => {
              chainOfThought.push(step);
              
              // Send status update based on step type
              if (step.type === "searching") {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: "searching",
                    message: step.kbName ? `Searching "${step.kbName}"...` : "Searching knowledge base...",
                  }),
                });
              } else if (step.type === "tool_call") {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: "tool_call",
                    message: step.toolName ? `Using ${step.toolName}...` : "Executing tool...",
                    toolName: step.toolName,
                  }),
                });
              } else if (step.type === "answering") {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: "generating",
                    message: "Generating response...",
                  }),
                });
              }

              // Send chain of thought step if enabled
              if (showChainOfThought) {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "chain_of_thought",
                    step,
                  }),
                });
              }
            },
            onText: async (text) => {
              fullAnswer += text;
              await stream.writeSSE({
                data: JSON.stringify({ type: "text", content: text }),
              });
            },
          }
        );

        // Consume the generator
        let result;
        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            result = value;
            break;
          }
          // Text chunks are handled by onText callback
        }

        // Store assistant message
        await addToConversation(widgetToken.tenantId, agent.id, conversationId, {
          role: "assistant",
          content: fullAnswer,
          timestamp: Date.now(),
        });

        // Log chat event
        const latencyMs = Date.now() - startTime;
        await db.insert(chatEvents).values({
          tenantId: widgetToken.tenantId,
          agentId: agent.id,
          userId: null,
          channel: "widget",
          status: "ok",
          latencyMs,
          promptTokens: result?.inputTokens || 0,
          completionTokens: result?.outputTokens || 0,
          retrievedChunks: chainOfThought.filter(s => s.type === "searching").length,
          rerankerUsed: true,
        });

        // Send final message with citations
        const citations = agent.citationsEnabled ? (result?.citations || []) : [];
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            conversationId,
            citations,
            chainOfThought: showChainOfThought ? chainOfThought : undefined,
            toolCallsCount: result?.toolCallsCount || 0,
          }),
        });

        // Clear heartbeat and close stream
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        await stream.close();
      } catch (error) {
        console.error("[Widget Agentic Stream] Error:", error);
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: "An error occurred while generating the response.",
          }),
        });
        await stream.close();
      }
    });
  }
);

// ============================================================================
// Retrieval Functions (duplicated from chat.ts - could be extracted to shared)
// ============================================================================

async function retrieveChunks(
  tenantId: string,
  kbIds: string[],
  query: string,
  candidateK: number,
  topK: number,
  rerankerEnabled: boolean
): Promise<any[]> {
  // Get vector store
  const vectorStore = getVectorStore();
  if (!vectorStore) {
    console.warn("[Widget] Vector store not configured, falling back to keyword search only");
    return retrieveChunksKeywordOnly(tenantId, kbIds, query, topK);
  }

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Vector similarity search using vector store
  const vectorResults = await vectorStore.search(queryEmbedding.embedding, {
    tenantId,
    kbIds,
    topK: candidateK,
  });

  // Get chunk IDs from vector results
  const vectorChunkIds = vectorResults.map((r) => r.id);

  // Fetch chunk details from app DB
  let vectorChunks: Array<typeof kbChunks.$inferSelect> = [];
  if (vectorChunkIds.length > 0) {
    vectorChunks = await db.query.kbChunks.findMany({
      where: and(
        inArray(kbChunks.id, vectorChunkIds),
        isNull(kbChunks.deletedAt)
      ),
    });
  }

  // Create a map of chunk details with vector scores
  const chunkMap = new Map<string, any>();
  for (const chunk of vectorChunks) {
    const vectorResult = vectorResults.find((r) => r.id === chunk.id);
    chunkMap.set(chunk.id, {
      ...chunk,
      vectorScore: vectorResult?.score || 0,
      keywordScore: 0,
    });
  }

  // Full-text search
  const kbIdsArrayLiteral = `{${kbIds.join(",")}}`;
  const keywordResults = await db.execute(sql`
    SELECT
      c.id,
      c.content,
      c.title,
      c.normalized_url as "normalizedUrl",
      c.heading,
      c.section_path,
      c.tags,
      c.keywords,
      ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) as rank
    FROM kb_chunks c
    WHERE c.tenant_id = ${tenantId}
      AND c.kb_id = ANY(${kbIdsArrayLiteral}::uuid[])
      AND c.deleted_at IS NULL
      AND c.tsv @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC
    LIMIT ${candidateK}
  `);

  // Merge keyword results
  const keywordRows = Array.isArray(keywordResults) ? keywordResults : (keywordResults as any).rows || [];
  for (const row of keywordRows as any[]) {
    const existing = chunkMap.get(row.id);
    if (existing) {
      existing.keywordScore = parseFloat(row.rank) || 0;
    } else {
      chunkMap.set(row.id, {
        ...row,
        vectorScore: 0,
        keywordScore: parseFloat(row.rank) || 0,
      });
    }
  }

  let chunks = Array.from(chunkMap.values());

  if (rerankerEnabled) {
    chunks = heuristicRerank(chunks, query);
  } else {
    chunks.sort((a, b) => b.vectorScore - a.vectorScore);
  }

  return chunks.slice(0, topK);
}

/**
 * Fallback to keyword-only search when vector store is not available
 */
async function retrieveChunksKeywordOnly(
  tenantId: string,
  kbIds: string[],
  query: string,
  topK: number
): Promise<any[]> {
  const kbIdsArrayLiteral = `{${kbIds.join(",")}}`;

  const keywordResults = await db.execute(sql`
    SELECT
      c.*,
      ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) as rank
    FROM kb_chunks c
    WHERE c.tenant_id = ${tenantId}
      AND c.kb_id = ANY(${kbIdsArrayLiteral}::uuid[])
      AND c.deleted_at IS NULL
      AND c.tsv @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC
    LIMIT ${topK}
  `);

  const rows = Array.isArray(keywordResults) ? keywordResults : (keywordResults as any).rows || [];
  return rows.map((row: any) => ({
    ...row,
    score: parseFloat(row.rank) || 0,
  }));
}

function heuristicRerank(chunks: any[], query: string): any[] {
  const queryTerms = query.toLowerCase().split(/\s+/);

  for (const chunk of chunks) {
    const vectorWeight = 0.6;
    const keywordWeight = 0.3;
    const titleMatchWeight = 0.1;

    let titleBonus = 0;
    const titleLower = (chunk.title || "").toLowerCase();
    const headingLower = (chunk.heading || "").toLowerCase();

    for (const term of queryTerms) {
      if (titleLower.includes(term)) titleBonus += 0.5;
      if (headingLower.includes(term)) titleBonus += 0.3;
    }
    titleBonus = Math.min(titleBonus, 1);

    const normalizedKeywordScore = Math.min(chunk.keywordScore * 10, 1);

    chunk.score =
      chunk.vectorScore * vectorWeight +
      normalizedKeywordScore * keywordWeight +
      titleBonus * titleMatchWeight;
  }

  chunks.sort((a, b) => b.score - a.score);
  return chunks;
}
