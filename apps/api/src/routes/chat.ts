import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { db } from "@grounded/db";
import {
  agents,
  agentKbs,
  retrievalConfigs,
  kbChunks,
  chatEvents,
  agentCapabilities,
} from "@grounded/db/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { generateEmbedding } from "@grounded/embeddings";
import { generateRAGResponse, generateRAGResponseStream, type ChunkContext } from "@grounded/llm";
import { getVectorStore } from "@grounded/vector-store";
import {
  getConversation,
  addToConversation,
  checkRateLimit,
} from "@grounded/queue";
import { generateId, type Citation } from "@grounded/shared";
import { auth, requireTenant } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { NotFoundError, ForbiddenError } from "../middleware/error-handler";
import { AgenticChatService } from "../services/agentic-chat";
import { SimpleRAGService } from "../services/simple-rag";

export const chatRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

// ============================================================================
// Chat Endpoint
// ============================================================================

chatRoutes.post(
  "/:agentId",
  auth(),
  requireTenant(),
  rateLimit({ keyPrefix: "chat", limit: 60, windowSeconds: 60 }),
  zValidator("json", chatSchema),
  async (c) => {
    const authContext = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Verify agent access
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
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
        answer: "I don't have any knowledge bases attached. Please configure the agent with knowledge sources.",
        citations: [],
        conversationId: body.conversationId || generateId(),
      });
    }

    // Get conversation history
    const conversationId = body.conversationId || generateId();
    const history = await getConversation(
      authContext.tenantId!,
      agent.id,
      conversationId
    );

    // Retrieve relevant chunks
    const chunks = await retrieveChunks(
      authContext.tenantId!,
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

    // Update conversation memory
    await addToConversation(authContext.tenantId!, agent.id, conversationId, {
      role: "user",
      content: body.message,
      timestamp: Date.now(),
    });

    await addToConversation(authContext.tenantId!, agent.id, conversationId, {
      role: "assistant",
      content: ragResponse.answer,
      timestamp: Date.now(),
    });

    // Log chat event (metadata only)
    const latencyMs = Date.now() - startTime;
    await db.insert(chatEvents).values({
      tenantId: authContext.tenantId!,
      agentId: agent.id,
      userId: authContext.user.id,
      channel: authContext.apiKeyId ? "api" : "admin_ui",
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
      response: ragResponse.answer,
      citations,
      conversationId,
    });
  }
);

// ============================================================================
// Simple RAG Streaming Chat Endpoint
// ============================================================================

chatRoutes.post(
  "/simple/:agentId",
  auth(),
  requireTenant(),
  rateLimit({ keyPrefix: "chat", limit: 60, windowSeconds: 60 }),
  zValidator("json", chatSchema),
  async (c) => {
    const authContext = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = c.req.valid("json");

    // Headers for SSE streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Connection", "keep-alive");

    return streamSSE(c, async (stream) => {
      const service = new SimpleRAGService(authContext.tenantId!, agentId);

      for await (const event of service.chat(body.message, body.conversationId)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });
      }
    });
  }
);

// ============================================================================
// Streaming Chat Endpoint (Legacy)
// ============================================================================

chatRoutes.post(
  "/stream/:agentId",
  auth(),
  requireTenant(),
  rateLimit({ keyPrefix: "chat", limit: 60, windowSeconds: 60 }),
  zValidator("json", chatSchema),
  async (c) => {
    const authContext = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Verify agent access
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
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
            content: "I don't have any knowledge bases attached. Please configure the agent with knowledge sources.",
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
      let chunks: Array<typeof kbChunks.$inferSelect & { score: number }> = [];
      let aborted = false;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      // Handle client disconnect
      stream.onAbort(() => {
        console.log("[Chat Stream] Client disconnected");
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
          authContext.tenantId!,
          agent.id,
          conversationId
        );

        // Retrieve relevant chunks
        chunks = await retrieveChunks(
          authContext.tenantId!,
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
        await addToConversation(authContext.tenantId!, agent.id, conversationId, {
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
        await addToConversation(authContext.tenantId!, agent.id, conversationId, {
          role: "assistant",
          content: fullAnswer,
          timestamp: Date.now(),
        });

        // Log chat event
        const latencyMs = Date.now() - startTime;
        await db.insert(chatEvents).values({
          tenantId: authContext.tenantId!,
          agentId: agent.id,
          userId: authContext.user.id,
          channel: authContext.apiKeyId ? "api" : "admin_ui",
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
      } catch (error) {
        console.error("[Chat Stream] Error:", error);
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

// ============================================================================
// Agentic Streaming Chat Endpoint
// ============================================================================

chatRoutes.post(
  "/agentic/:agentId",
  auth(),
  requireTenant(),
  rateLimit({ keyPrefix: "chat", limit: 60, windowSeconds: 60 }),
  zValidator("json", chatSchema),
  async (c) => {
    const authContext = c.get("auth");
    const agentId = c.req.param("agentId");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Verify agent access
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, agentId),
        eq(agents.tenantId, authContext.tenantId!),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    const conversationId = body.conversationId || generateId();

    // Get capabilities to check if agent has agentic mode enabled
    const capabilities = await db.query.agentCapabilities.findFirst({
      where: eq(agentCapabilities.agentId, agentId),
    });

    // Headers for SSE streaming - disable all buffering
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Connection", "keep-alive");
    c.header("Content-Type", "text/event-stream");

    console.log("[Agentic Chat] Starting stream for agent:", agentId);
    
    return streamSSE(c, async (stream) => {
      let fullAnswer = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let toolCallsCount = 0;
      let aborted = false;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      console.log("[Agentic Chat] Inside streamSSE callback");

      // Handle client disconnect
      stream.onAbort(() => {
        console.log("[Agentic Chat] Client disconnected, aborting stream");
        aborted = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      });

      // Start heartbeat to keep connection alive during long AI operations
      // Send a ping every 2 seconds to prevent browser timeout
      heartbeatInterval = setInterval(async () => {
        if (!aborted) {
          try {
            await stream.writeSSE({ 
              data: JSON.stringify({ type: "ping", timestamp: Date.now() }),
            });
          } catch {
            // Stream may have closed
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
          authContext.tenantId!,
          agent.id,
          conversationId
        );

        // Store user message first
        await addToConversation(authContext.tenantId!, agent.id, conversationId, {
          role: "user",
          content: body.message,
          timestamp: Date.now(),
        });

        // Create agentic chat service
        console.log("[Agentic Chat] Creating AgenticChatService");
        const agenticService = new AgenticChatService(
          authContext.tenantId!,
          agentId
        );

        // Send initial status immediately to establish the stream
        await stream.writeSSE({
          data: JSON.stringify({
            type: "status",
            status: "thinking",
            message: "Analyzing your question...",
          }),
        });

        // Generate streaming response
        console.log("[Agentic Chat] Calling generateResponseStream");
        const generator = agenticService.generateResponseStream(
          {
            tenantId: authContext.tenantId!,
            agentId,
            message: body.message,
            conversationHistory: history.map((turn) => ({
              role: turn.role as "user" | "assistant",
              content: turn.content,
            })),
          },
          {
            onChainOfThought: async (step) => {
              // Stream chain of thought if enabled
              if (capabilities?.showChainOfThought ?? true) {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "chain_of_thought",
                    step,
                  }),
                });
              }

              // Also send status updates for key steps
              if (step.type === "searching") {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: "searching",
                    message: step.content,
                  }),
                });
              } else if (step.type === "tool_call") {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: "tool_call",
                    message: step.content,
                    toolName: step.toolName,
                  }),
                });
              } else if (step.type === "answering") {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: "generating",
                    message: step.content,
                  }),
                });
              }
            },
          }
        );

        // Stream text chunks
        console.log("[Agentic Chat] Starting to consume generator");
        while (true) {
          if (aborted) {
            console.log("[Agentic Chat] Aborted, breaking loop");
            break;
          }
          const { value, done } = await generator.next();
          console.log("[Agentic Chat] Generator yielded:", { done, valueType: typeof value, valueLength: typeof value === 'string' ? value.length : 'N/A' });
          if (done) {
            // Final result
            console.log("[Agentic Chat] Generator completed with result");
            const result = value;
            fullAnswer = result.answer;
            inputTokens = result.inputTokens;
            outputTokens = result.outputTokens;
            toolCallsCount = result.toolCallsCount;

            // Store assistant message
            console.log("[Agentic Chat] Storing conversation message");
            await addToConversation(authContext.tenantId!, agent.id, conversationId, {
              role: "assistant",
              content: fullAnswer,
              timestamp: Date.now(),
            });

            // Log chat event
            console.log("[Agentic Chat] Logging chat event");
            const latencyMs = Date.now() - startTime;
            await db.insert(chatEvents).values({
              tenantId: authContext.tenantId!,
              agentId: agent.id,
              userId: authContext.user.id,
              channel: authContext.apiKeyId ? "api" : "admin_ui",
              status: "ok",
              latencyMs,
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              retrievedChunks: 0, // Not tracked in agentic mode
              rerankerUsed: false,
            });

            // Send final message with citations
            console.log("[Agentic Chat] Sending done message");
            const citations = agent.citationsEnabled ? result.citations : [];
            await stream.writeSSE({
              data: JSON.stringify({
                type: "done",
                conversationId,
                citations,
                chainOfThought: capabilities?.showChainOfThought ? result.chainOfThought : undefined,
                toolCallsCount,
              }),
            });
            console.log("[Agentic Chat] Done message sent, breaking loop");
            break;
          }

          // Stream text chunk
          fullAnswer += value;
          await stream.writeSSE({
            data: JSON.stringify({ type: "text", content: value }),
          });
        }
        
        // Clear heartbeat interval
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        
        // Explicitly close the stream to signal end of response
        console.log("[Agentic Chat] Closing stream");
        await stream.close();
      } catch (error) {
        console.error("[Agentic Chat Stream] Error:", error);
        
        // Clear heartbeat interval
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "An error occurred while generating the response.",
          }),
        });
        await stream.close();
      }
    });
  }
);

// ============================================================================
// Retrieval Functions
// ============================================================================

async function retrieveChunks(
  tenantId: string,
  kbIds: string[],
  query: string,
  candidateK: number,
  topK: number,
  rerankerEnabled: boolean
): Promise<Array<typeof kbChunks.$inferSelect & { score: number }>> {
  const startTime = Date.now();
  
  // Get vector store
  const vectorStore = getVectorStore();
  if (!vectorStore) {
    console.warn("[Chat] Vector store not configured, falling back to keyword search only");
    return retrieveChunksKeywordOnly(tenantId, kbIds, query, topK);
  }

  // Generate query embedding
  const embeddingStart = Date.now();
  const queryEmbedding = await generateEmbedding(query);
  console.log(`[Chat Perf] Embedding generation: ${Date.now() - embeddingStart}ms`);

  // Run vector search and keyword search in PARALLEL
  const kbIdsArrayLiteral = `{${kbIds.join(",")}}`;
  const parallelStart = Date.now();
  
  const [vectorResults, keywordResults] = await Promise.all([
    // Vector similarity search
    vectorStore.search(queryEmbedding.embedding, {
      tenantId,
      kbIds,
      topK: candidateK,
    }),
    // Full-text keyword search
    db.execute(sql`
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
      WHERE (c.tenant_id = ${tenantId} OR c.tenant_id IS NULL)
        AND c.kb_id = ANY(${kbIdsArrayLiteral}::uuid[])
        AND c.deleted_at IS NULL
        AND c.tsv @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${candidateK}
    `),
  ]);
  console.log(`[Chat Perf] Parallel search (vector + keyword): ${Date.now() - parallelStart}ms`);

  // Get chunk IDs from vector results
  const vectorChunkIds = vectorResults.map((r) => r.id);

  // Fetch chunk details from app DB
  const chunkFetchStart = Date.now();
  let vectorChunks: Array<typeof kbChunks.$inferSelect> = [];
  if (vectorChunkIds.length > 0) {
    vectorChunks = await db.query.kbChunks.findMany({
      where: and(
        inArray(kbChunks.id, vectorChunkIds),
        isNull(kbChunks.deletedAt)
      ),
    });
  }
  console.log(`[Chat Perf] Chunk details fetch: ${Date.now() - chunkFetchStart}ms`);

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
    // Heuristic reranking
    chunks = heuristicRerank(chunks, query);
  } else {
    // Sort by vector score only
    chunks.sort((a, b) => b.vectorScore - a.vectorScore);
  }

  console.log(`[Chat Perf] Total retrieval: ${Date.now() - startTime}ms, found ${chunks.length} chunks`);

  // Take top K
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
): Promise<Array<typeof kbChunks.$inferSelect & { score: number }>> {
  // Include both tenant-owned chunks AND global KB chunks (tenant_id IS NULL)
  const kbIdsArrayLiteral = `{${kbIds.join(",")}}`;

  const keywordResults = await db.execute(sql`
    SELECT
      c.*,
      ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) as rank
    FROM kb_chunks c
    WHERE (c.tenant_id = ${tenantId} OR c.tenant_id IS NULL)
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

function heuristicRerank(
  chunks: any[],
  query: string
): any[] {
  const queryTerms = query.toLowerCase().split(/\s+/);

  for (const chunk of chunks) {
    // Normalize scores
    const vectorWeight = 0.6;
    const keywordWeight = 0.3;
    const titleMatchWeight = 0.1;

    // Calculate title/heading match bonus
    let titleBonus = 0;
    const titleLower = (chunk.title || "").toLowerCase();
    const headingLower = (chunk.heading || "").toLowerCase();

    for (const term of queryTerms) {
      if (titleLower.includes(term)) titleBonus += 0.5;
      if (headingLower.includes(term)) titleBonus += 0.3;
    }
    titleBonus = Math.min(titleBonus, 1);

    // Normalize keyword score (ts_rank_cd typically returns small values)
    const normalizedKeywordScore = Math.min(chunk.keywordScore * 10, 1);

    // Combined score
    chunk.score =
      chunk.vectorScore * vectorWeight +
      normalizedKeywordScore * keywordWeight +
      titleBonus * titleMatchWeight;
  }

  // Sort by combined score
  chunks.sort((a, b) => b.score - a.score);

  return chunks;
}
