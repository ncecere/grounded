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

interface AgentConfig {
  systemPrompt: string;
  modelConfigId: string | null;
  candidateK: number;      // How many chunks to retrieve from vector search
  topK: number;            // How many chunks to include in LLM prompt
  maxCitations: number;    // How many sources to show in UI
  similarityThreshold: number;
  kbIds: string[];
}

export type StreamEvent =
  | { type: "status"; status: string; message: string; sourceCount?: number }
  | { type: "text"; content: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string };

// ============================================================================
// SimpleRAGService
// ============================================================================

export class SimpleRAGService {
  private config: AgentConfig | null = null;

  constructor(
    private tenantId: string,
    private agentId: string
  ) {}

  /**
   * Main chat method - streams response and yields events
   */
  async *chat(
    message: string,
    conversationId?: string
  ): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    let promptTokens = 0;
    let completionTokens = 0;
    let retrievedChunksCount = 0;

    try {
      // 1. Load agent configuration
      await this.loadConfig();

      if (!this.config) {
        yield { type: "error", message: "Agent not found" };
        return;
      }

      // 2. Generate or use existing conversation ID
      const convId = conversationId || randomUUID();

      // 3. Get conversation history from Redis
      const history = await getConversation(this.tenantId, this.agentId, convId);

      // 4. Store user message in Redis
      await addToConversation(this.tenantId, this.agentId, convId, {
        role: "user",
        content: message,
        timestamp: Date.now(),
      });

      // 5. Search for relevant chunks
      const chunks = await this.searchKnowledge(message);
      retrievedChunksCount = chunks.length;

      // 5b. Emit status with source count
      yield {
        type: "status",
        status: "generating",
        message: chunks.length > 0
          ? `Found ${chunks.length} sources. Generating response...`
          : "No relevant sources found. Generating response...",
        sourceCount: chunks.length,
      };

      // 6. Build system prompt with context
      const systemPrompt = this.buildSystemPrompt(chunks);

      // 7. Build messages array for LLM
      const messages = this.buildMessages(history, message);

      // 8. Get the LLM model
      const registry = getAIRegistry();
      const model = await registry.getLanguageModel(
        this.config.modelConfigId || undefined
      );

      if (!model) {
        yield { type: "error", message: "No chat model configured" };
        return;
      }

      // 9. Stream the response
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

      // 10. Get token usage
      const usage = await result.usage;
      promptTokens = usage?.inputTokens || 0;
      completionTokens = usage?.outputTokens || 0;

      // 11. Store assistant response in Redis
      await addToConversation(this.tenantId, this.agentId, convId, {
        role: "assistant",
        content: fullResponse,
        timestamp: Date.now(),
      });

      // 12. Log usage for billing/analytics
      await this.logUsage({
        startTime,
        promptTokens,
        completionTokens,
        retrievedChunks: retrievedChunksCount,
        status: "ok",
      });

      // 13. Build and yield sources (limited by maxCitations for UI display)
      const allSources: Source[] = chunks.map((chunk, i) => ({
        id: chunk.id,
        title: chunk.title || "Untitled",
        url: chunk.url,
        snippet: chunk.content.slice(0, 200),
        index: i + 1,
      }));
      
      // Only show maxCitations in the UI
      const sources = allSources.slice(0, this.config!.maxCitations);

      yield { type: "sources", sources };
      yield { type: "done", conversationId: convId };
    } catch (error) {
      log.error("api", "SimpleRAG error", { error: error instanceof Error ? error.message : String(error) });

      // Log error for analytics
      await this.logUsage({
        startTime,
        promptTokens,
        completionTokens,
        retrievedChunks: retrievedChunksCount,
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
    // Get agent
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

    // Get retrieval config
    const retrievalConfig = await db.query.retrievalConfigs.findFirst({
      where: eq(retrievalConfigs.agentId, this.agentId),
    });

    // Get attached knowledge bases
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
    };
  }

  /**
   * Search knowledge bases for relevant chunks
   */
  private async searchKnowledge(query: string): Promise<RetrievedChunk[]> {
    if (!this.config || this.config.kbIds.length === 0) {
      return [];
    }

    // Generate embedding for the query
    const { embedding } = await generateEmbedding(query);

    // Search vector store
    const vectorStore = await getVectorStore();
    if (!vectorStore) {
      log.warn("api", "SimpleRAG: Vector store not configured");
      return [];
    }

    // 1. Search with candidateK to get a broader pool
    const searchResults = await vectorStore.search(embedding, {
      tenantId: this.tenantId,
      kbIds: this.config.kbIds,
      topK: this.config.candidateK,
      minScore: this.config.similarityThreshold,
    });

    if (searchResults.length === 0) {
      return [];
    }

    // 2. Take only topK results for LLM context
    const topResults = searchResults.slice(0, this.config.topK);

    // Get chunk details from database
    const chunkIds = topResults.map((r) => r.id);
    const chunks = await db.query.kbChunks.findMany({
      where: and(
        inArray(kbChunks.id, chunkIds),
        isNull(kbChunks.deletedAt)
      ),
    });

    // Create a map for easy lookup
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    // Combine search results with chunk data, maintaining score order
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

    // Build context section
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

    // Add conversation history
    for (const turn of history) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }

    // Add current user message
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
    status: "ok" | "error";
    errorCode?: string;
  }): Promise<void> {
    try {
      const latencyMs = Date.now() - data.startTime;

      await db.insert(chatEvents).values({
        tenantId: this.tenantId,
        agentId: this.agentId,
        channel: "admin_ui",
        startedAt: new Date(data.startTime),
        finishedAt: new Date(),
        status: data.status,
        latencyMs,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        retrievedChunks: data.retrievedChunks,
        rerankerUsed: false,
        errorCode: data.errorCode,
      });
    } catch (error) {
      // Don't fail the chat if logging fails
      log.error("api", "SimpleRAG: Failed to log usage", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
