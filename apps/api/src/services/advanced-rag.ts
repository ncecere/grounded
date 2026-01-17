import { streamText } from "ai";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@grounded/db";
import {
  agents,
  agentKbs,
  retrievalConfigs,
  kbChunks,
  chatEvents,
} from "@grounded/db/schema";
import { generateEmbedding } from "@grounded/embeddings";
import { getVectorStore } from "@grounded/vector-store";
import { getAIRegistry } from "@grounded/ai-providers";
import { log } from "@grounded/logger";
import {
  getConversation,
  addToConversation,
  type ConversationTurn,
} from "@grounded/queue";

// ============================================================================
// Types
// ============================================================================

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Source {
  id: string;
  title: string;
  url?: string;
  snippet: string;
  index: number;
}

interface RetrievedChunk {
  id: string;
  content: string;
  title?: string;
  url?: string;
  score: number;
}

interface AdvancedAgentConfig {
  systemPrompt: string;
  modelConfigId: string | null;
  candidateK: number;
  topK: number;
  maxCitations: number;
  similarityThreshold: number;
  kbIds: string[];
  historyTurns: number;
  advancedMaxSubqueries: number;
}

/**
 * Represents a single step in the reasoning process
 */
export interface ReasoningStep {
  id: string;
  type: "rewrite" | "plan" | "search" | "merge" | "generate";
  title: string;
  summary: string;
  status: "pending" | "in_progress" | "completed" | "error";
  details?: Record<string, unknown>;
}

/**
 * A sub-query generated from the multi-step plan
 */
export interface SubQuery {
  id: string;
  query: string;
  purpose: string;
}

/**
 * Stream events for AdvancedRAGService
 */
export type AdvancedStreamEvent =
  | { type: "status"; status: string; message: string; sourceCount?: number }
  | { type: "reasoning"; step: ReasoningStep }
  | { type: "text"; content: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string };

// ============================================================================
// AdvancedRAGService
// ============================================================================

/**
 * Advanced RAG service implementing multi-step query processing:
 * 1. Query rewriting with conversation history context
 * 2. Multi-step plan generation (sub-queries)
 * 3. Parallel sub-query retrieval
 * 4. Result merging and deduplication
 * 5. Final answer generation with citations
 */
export class AdvancedRAGService {
  private config: AdvancedAgentConfig | null = null;

  constructor(
    private tenantId: string,
    private agentId: string,
    private channel: "admin_ui" | "widget" | "api" | "chat_endpoint" = "admin_ui"
  ) {}

  /**
   * Main chat method - streams response and yields events including reasoning steps
   */
  async *chat(
    message: string,
    conversationId?: string
  ): AsyncGenerator<AdvancedStreamEvent> {
    const startTime = Date.now();
    let promptTokens = 0;
    let completionTokens = 0;
    let retrievedChunksCount = 0;
    let reasoningStepsCount = 0;

    try {
      // 1. Load agent configuration
      await this.loadConfig();

      if (!this.config) {
        yield { type: "error", message: "Agent not found" };
        return;
      }

      // 2. Generate or use existing conversation ID
      const convId = conversationId || randomUUID();

      // 3. Get conversation history from Redis (limited by historyTurns)
      const fullHistory = await getConversation(this.tenantId, this.agentId, convId);
      const history = fullHistory.slice(-this.config.historyTurns * 2); // Each turn is user + assistant

      // 4. Store user message in Redis
      await addToConversation(this.tenantId, this.agentId, convId, {
        role: "user",
        content: message,
        timestamp: Date.now(),
      });

      // 5. Query rewriting step
      const rewriteStep: ReasoningStep = {
        id: randomUUID(),
        type: "rewrite",
        title: "Query Rewriting",
        summary: "Analyzing conversation context to reformulate query...",
        status: "in_progress",
      };
      yield { type: "reasoning", step: rewriteStep };
      reasoningStepsCount++;

      const rewrittenQuery = await this.rewriteQuery(message, history);

      rewriteStep.status = "completed";
      rewriteStep.summary = rewrittenQuery !== message
        ? `Reformulated query: "${rewrittenQuery.slice(0, 100)}${rewrittenQuery.length > 100 ? '...' : ''}"`
        : "Query used as-is (no reformulation needed)";
      yield { type: "reasoning", step: rewriteStep };

      // 6. Multi-step plan generation
      const planStep: ReasoningStep = {
        id: randomUUID(),
        type: "plan",
        title: "Query Planning",
        summary: "Generating sub-queries for comprehensive search...",
        status: "in_progress",
      };
      yield { type: "reasoning", step: planStep };
      reasoningStepsCount++;

      const subQueries = await this.generateSubQueries(rewrittenQuery);

      planStep.status = "completed";
      planStep.summary = `Generated ${subQueries.length} sub-quer${subQueries.length === 1 ? 'y' : 'ies'} for retrieval`;
      planStep.details = { subQueries: subQueries.map(sq => sq.query) };
      yield { type: "reasoning", step: planStep };

      // 7. Sub-query retrieval
      const searchStep: ReasoningStep = {
        id: randomUUID(),
        type: "search",
        title: "Knowledge Search",
        summary: `Searching knowledge bases with ${subQueries.length} quer${subQueries.length === 1 ? 'y' : 'ies'}...`,
        status: "in_progress",
      };
      yield { type: "reasoning", step: searchStep };
      reasoningStepsCount++;

      const allChunks = await this.executeSubQueries(subQueries);

      searchStep.status = "completed";
      searchStep.summary = `Found ${allChunks.length} relevant chunks`;
      yield { type: "reasoning", step: searchStep };

      // 8. Merge and deduplicate results
      const mergeStep: ReasoningStep = {
        id: randomUUID(),
        type: "merge",
        title: "Result Merging",
        summary: "Deduplicating and ranking results...",
        status: "in_progress",
      };
      yield { type: "reasoning", step: mergeStep };
      reasoningStepsCount++;

      const mergedChunks = this.mergeAndDeduplicateChunks(allChunks);
      retrievedChunksCount = mergedChunks.length;

      mergeStep.status = "completed";
      mergeStep.summary = `Merged to ${mergedChunks.length} unique chunks`;
      yield { type: "reasoning", step: mergeStep };

      // 9. Emit status with source count
      yield {
        type: "status",
        status: "generating",
        message: mergedChunks.length > 0
          ? `Found ${mergedChunks.length} sources. Generating response...`
          : "No relevant sources found. Generating response...",
        sourceCount: mergedChunks.length,
      };

      // 10. Generate final answer
      const generateStep: ReasoningStep = {
        id: randomUUID(),
        type: "generate",
        title: "Answer Generation",
        summary: "Generating comprehensive answer with citations...",
        status: "in_progress",
      };
      yield { type: "reasoning", step: generateStep };
      reasoningStepsCount++;

      // 11. Build system prompt with context
      const systemPrompt = this.buildSystemPrompt(mergedChunks);

      // 12. Build messages array for LLM
      const messages = this.buildMessages(history, message);

      // 13. Get the LLM model
      const registry = getAIRegistry();
      const model = await registry.getLanguageModel(
        this.config.modelConfigId || undefined
      );

      if (!model) {
        yield { type: "error", message: "No chat model configured" };
        return;
      }

      // 14. Stream the response
      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        providerOptions: {
          openai: {
            reasoningEffort: "low",
          },
        },
      });

      let fullResponse = "";

      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        yield { type: "text", content: chunk };
      }

      // 15. Mark generation complete
      generateStep.status = "completed";
      generateStep.summary = "Response generated successfully";
      yield { type: "reasoning", step: generateStep };

      // 16. Get token usage
      const usage = await result.usage;
      promptTokens = usage?.inputTokens || 0;
      completionTokens = usage?.outputTokens || 0;

      // 17. Store assistant response in Redis
      await addToConversation(this.tenantId, this.agentId, convId, {
        role: "assistant",
        content: fullResponse,
        timestamp: Date.now(),
      });

      // 18. Log usage for billing/analytics
      await this.logUsage({
        startTime,
        promptTokens,
        completionTokens,
        retrievedChunks: retrievedChunksCount,
        reasoningSteps: reasoningStepsCount,
        status: "ok",
      });

      // 19. Build and yield sources
      const allSources: Source[] = mergedChunks.map((chunk, i) => ({
        id: chunk.id,
        title: chunk.title || "Untitled",
        url: chunk.url,
        snippet: chunk.content.slice(0, 200),
        index: i + 1,
      }));

      const sources = allSources.slice(0, this.config!.maxCitations);

      yield { type: "sources", sources };
      yield { type: "done", conversationId: convId };
    } catch (error) {
      log.error("api", "AdvancedRAG error", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Log error for analytics
      await this.logUsage({
        startTime,
        promptTokens,
        completionTokens,
        retrievedChunks: retrievedChunksCount,
        reasoningSteps: reasoningStepsCount,
        status: "error",
        errorCode: error instanceof Error ? error.message : "unknown",
      });

      yield {
        type: "error",
        message: error instanceof Error ? error.message : "An error occurred",
      };
    }
  }

  /**
   * Load agent configuration from database
   */
  private async loadConfig(): Promise<void> {
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, this.agentId),
        eq(agents.tenantId, this.tenantId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      this.config = null;
      return;
    }

    const retrievalConfig = await db.query.retrievalConfigs.findFirst({
      where: eq(retrievalConfigs.agentId, this.agentId),
    });

    const attachedKbs = await db.query.agentKbs.findMany({
      where: and(
        eq(agentKbs.agentId, this.agentId),
        isNull(agentKbs.deletedAt)
      ),
    });

    this.config = {
      systemPrompt: agent.systemPrompt,
      modelConfigId: agent.llmModelConfigId,
      candidateK: retrievalConfig?.candidateK || 40,
      topK: retrievalConfig?.topK || 8,
      maxCitations: retrievalConfig?.maxCitations || 3,
      similarityThreshold: retrievalConfig?.similarityThreshold || 0.5,
      kbIds: attachedKbs.map((kb) => kb.kbId),
      historyTurns: retrievalConfig?.historyTurns || 5,
      advancedMaxSubqueries: retrievalConfig?.advancedMaxSubqueries || 3,
    };
  }

  /**
   * Rewrite the user query using conversation history for context
   */
  private async rewriteQuery(
    query: string,
    history: ConversationTurn[]
  ): Promise<string> {
    // If no history, return the query as-is
    if (history.length === 0) {
      return query;
    }

    try {
      const registry = getAIRegistry();
      const model = await registry.getLanguageModel(
        this.config?.modelConfigId || undefined
      );

      if (!model) {
        return query;
      }

      const historyContext = history
        .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
        .join("\n");

      const result = await streamText({
        model,
        system: `You are a query rewriting assistant. Your task is to reformulate the user's latest query to be self-contained and specific, incorporating relevant context from the conversation history.

Rules:
1. If the query references previous context (e.g., "it", "that", "this", pronouns), expand it to be explicit
2. If the query is already self-contained, return it unchanged
3. Keep the rewritten query concise and focused
4. Return ONLY the rewritten query, nothing else
5. Do not add explanations or preamble`,
        messages: [
          {
            role: "user",
            content: `Conversation history:
${historyContext}

Latest query to rewrite: "${query}"

Rewritten query:`,
          },
        ],
      });

      let rewritten = "";
      for await (const chunk of result.textStream) {
        rewritten += chunk;
      }

      return rewritten.trim() || query;
    } catch (error) {
      log.warn("api", "AdvancedRAG: Query rewrite failed, using original", {
        error: error instanceof Error ? error.message : String(error),
      });
      return query;
    }
  }

  /**
   * Generate sub-queries for multi-step retrieval
   */
  private async generateSubQueries(query: string): Promise<SubQuery[]> {
    if (!this.config) {
      return [{ id: randomUUID(), query, purpose: "Original query" }];
    }

    try {
      const registry = getAIRegistry();
      const model = await registry.getLanguageModel(
        this.config.modelConfigId || undefined
      );

      if (!model) {
        return [{ id: randomUUID(), query, purpose: "Original query" }];
      }

      const maxSubqueries = this.config.advancedMaxSubqueries;

      const result = await streamText({
        model,
        system: `You are a search query planner. Given a user query, generate up to ${maxSubqueries} focused sub-queries that together will retrieve comprehensive information to answer the original query.

Rules:
1. Each sub-query should target a specific aspect of the original query
2. Sub-queries should be complementary, not redundant
3. If the original query is simple and focused, return just 1 sub-query (the original)
4. Return queries in JSON format: [{"query": "...", "purpose": "..."}]
5. Keep queries concise and search-optimized
6. Return ONLY the JSON array, no other text`,
        messages: [
          {
            role: "user",
            content: `Original query: "${query}"

Generate sub-queries (max ${maxSubqueries}):`,
          },
        ],
      });

      let response = "";
      for await (const chunk of result.textStream) {
        response += chunk;
      }

      // Parse the JSON response
      const parsed = JSON.parse(response.trim());
      if (Array.isArray(parsed)) {
        return parsed.slice(0, maxSubqueries).map((item) => ({
          id: randomUUID(),
          query: item.query || query,
          purpose: item.purpose || "Sub-query",
        }));
      }
    } catch (error) {
      log.warn("api", "AdvancedRAG: Sub-query generation failed, using original", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to original query
    return [{ id: randomUUID(), query, purpose: "Original query" }];
  }

  /**
   * Execute all sub-queries in parallel and collect results
   */
  private async executeSubQueries(
    subQueries: SubQuery[]
  ): Promise<RetrievedChunk[]> {
    const allChunks: RetrievedChunk[] = [];

    // Execute sub-queries in parallel
    const results = await Promise.all(
      subQueries.map((sq) => this.searchKnowledge(sq.query))
    );

    for (const chunks of results) {
      allChunks.push(...chunks);
    }

    return allChunks;
  }

  /**
   * Merge and deduplicate chunks from multiple sub-queries
   */
  private mergeAndDeduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    if (!this.config) {
      return chunks;
    }

    // Use a Map to deduplicate by chunk ID, keeping the highest score
    const chunkMap = new Map<string, RetrievedChunk>();

    for (const chunk of chunks) {
      const existing = chunkMap.get(chunk.id);
      if (!existing || chunk.score > existing.score) {
        chunkMap.set(chunk.id, chunk);
      }
    }

    // Sort by score descending and limit to topK
    return Array.from(chunkMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.topK);
  }

  /**
   * Search knowledge bases for relevant chunks
   */
  private async searchKnowledge(query: string): Promise<RetrievedChunk[]> {
    if (!this.config || this.config.kbIds.length === 0) {
      return [];
    }

    const { embedding } = await generateEmbedding(query);

    const vectorStore = await getVectorStore();
    if (!vectorStore) {
      log.warn("api", "AdvancedRAG: Vector store not configured");
      return [];
    }

    const searchResults = await vectorStore.search(embedding, {
      tenantId: this.tenantId,
      kbIds: this.config.kbIds,
      topK: this.config.candidateK,
      minScore: this.config.similarityThreshold,
    });

    if (searchResults.length === 0) {
      return [];
    }

    // Take topK results per sub-query
    const topResults = searchResults.slice(0, this.config.topK);

    const chunkIds = topResults.map((r) => r.id);
    const dbChunks = await db.query.kbChunks.findMany({
      where: and(
        inArray(kbChunks.id, chunkIds),
        isNull(kbChunks.deletedAt)
      ),
    });

    const chunkMap = new Map(dbChunks.map((c) => [c.id, c]));

    const retrieved: RetrievedChunk[] = [];
    for (const result of topResults) {
      const chunk = chunkMap.get(result.id);
      if (chunk) {
        retrieved.push({
          id: chunk.id,
          content: chunk.content,
          title: chunk.title || chunk.heading || undefined,
          url: chunk.normalizedUrl || undefined,
          score: result.score,
        });
      }
    }

    return retrieved;
  }

  /**
   * Build system prompt with retrieved context
   */
  private buildSystemPrompt(chunks: RetrievedChunk[]): string {
    const basePrompt = this.config?.systemPrompt || "You are a helpful assistant.";

    if (chunks.length === 0) {
      return basePrompt;
    }

    const contextParts = chunks.map((chunk, i) => {
      const titlePart = chunk.title ? `Title: ${chunk.title}\n` : "";
      return `[${i + 1}] ${titlePart}${chunk.content}`;
    });

    return `${basePrompt}

CONTEXT:
${contextParts.join("\n\n")}`;
  }

  /**
   * Build messages array from conversation history
   */
  private buildMessages(
    history: ConversationTurn[],
    currentMessage: string
  ): Message[] {
    const messages: Message[] = [];

    for (const turn of history) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }

    messages.push({
      role: "user",
      content: currentMessage,
    });

    return messages;
  }

  /**
   * Log usage to chat_events for analytics/billing
   */
  private async logUsage(data: {
    startTime: number;
    promptTokens: number;
    completionTokens: number;
    retrievedChunks: number;
    reasoningSteps: number;
    status: "ok" | "error";
    errorCode?: string;
  }): Promise<void> {
    try {
      const latencyMs = Date.now() - data.startTime;

      await db.insert(chatEvents).values({
        tenantId: this.tenantId,
        agentId: this.agentId,
        channel: this.channel,
        startedAt: new Date(data.startTime),
        finishedAt: new Date(),
        status: data.status,
        latencyMs,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        retrievedChunks: data.retrievedChunks,
        rerankerUsed: false, // Advanced RAG doesn't use reranker
        errorCode: data.errorCode,
      });
    } catch (error) {
      log.error("api", "AdvancedRAG: Failed to log usage", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
