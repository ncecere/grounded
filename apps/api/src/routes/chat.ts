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
      promptTokens: ragResponse.promptTokens,
      completionTokens: ragResponse.completionTokens,
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
// Streaming Chat Endpoint
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

    // Disable proxy buffering for smooth streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache");

    return streamSSE(c, async (stream) => {
      let fullAnswer = "";
      let finalResponse: { answer: string; citations: Citation[]; promptTokens: number; completionTokens: number } | null = null;
      let chunks: Array<typeof kbChunks.$inferSelect & { score: number }> = [];

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
          promptTokens: finalResponse?.promptTokens || 0,
          completionTokens: finalResponse?.completionTokens || 0,
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
  // Get vector store
  const vectorStore = getVectorStore();
  if (!vectorStore) {
    console.warn("[Chat] Vector store not configured, falling back to keyword search only");
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
  // Format kbIds as PostgreSQL array literal string
  // Include both tenant-owned chunks AND global KB chunks (tenant_id IS NULL)
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
    WHERE (c.tenant_id = ${tenantId} OR c.tenant_id IS NULL)
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
    // Heuristic reranking
    chunks = heuristicRerank(chunks, query);
  } else {
    // Sort by vector score only
    chunks.sort((a, b) => b.vectorScore - a.vectorScore);
  }

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
