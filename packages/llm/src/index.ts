import { generateText, streamText, smoothStream, type CoreMessage } from "ai";
import { getAIRegistry } from "@kcb/ai-providers";
import { retry, type Citation } from "@kcb/shared";

// ============================================================================
// Types
// ============================================================================

export interface ChunkContext {
  id: string;
  content: string;
  title: string | null;
  url: string | null;
  heading: string | null;
}

export interface RAGResponse {
  answer: string;
  citations: Citation[];
  promptTokens: number;
  completionTokens: number;
}

export interface EnrichmentResult {
  summary: string;
  keywords: string[];
  tags: string[];
  entities: string[];
}

// ============================================================================
// RAG Prompt Templates
// ============================================================================

/**
 * Build the RAG system prompt with current date/time awareness
 */
function buildRAGSystemPrompt(customPrompt?: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const dateTimeContext = `Current date and time: ${dateStr}, ${timeStr}`;

  if (customPrompt) {
    return `${customPrompt}\n\n${dateTimeContext}`;
  }

  return `You are a helpful assistant that answers questions based ONLY on the provided context.

STRICT RULES:
1. Only answer questions based on the information in the CONTEXT section below
2. If the context does not contain enough information to answer the question, respond with: "I don't know based on the provided sources."
3. Be concise and direct in your answers
4. Do not make up or infer information that is not explicitly in the context
5. Do not use your general knowledge - only use the provided context
6. Do NOT include inline citations, source references, or bracketed references in your response - sources are displayed separately

Your response should be helpful, accurate, and well-structured.

${dateTimeContext}`;
}

function buildRAGUserPrompt(question: string, chunks: ChunkContext[]): string {
  const contextParts = chunks.map((chunk, i) => {
    const header = chunk.title || chunk.heading || `Source ${i + 1}`;
    const urlPart = chunk.url ? ` (${chunk.url})` : "";
    return `[${header}${urlPart}]\n${chunk.content}`;
  });

  return `CONTEXT:
${contextParts.join("\n\n---\n\n")}

QUESTION: ${question}

Please answer the question based only on the context provided above.`;
}

// ============================================================================
// LLM Functions
// ============================================================================

export interface RAGOptions {
  systemPrompt?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  modelConfigId?: string;
  maxCitations?: number;
}

/**
 * Generate a RAG response using the provided context.
 * @param question - The user's question
 * @param chunks - Context chunks to use for answering
 * @param options - Optional configuration including systemPrompt, conversationHistory, modelConfigId, maxCitations
 */
export async function generateRAGResponse(
  question: string,
  chunks: ChunkContext[],
  options?: RAGOptions
): Promise<RAGResponse>;

/**
 * @deprecated Use options object instead
 */
export async function generateRAGResponse(
  question: string,
  chunks: ChunkContext[],
  systemPrompt?: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  modelConfigId?: string
): Promise<RAGResponse>;

export async function generateRAGResponse(
  question: string,
  chunks: ChunkContext[],
  optionsOrSystemPrompt?: RAGOptions | string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  modelConfigId?: string
): Promise<RAGResponse> {
  // Handle both old and new signatures
  let options: RAGOptions;
  if (typeof optionsOrSystemPrompt === 'object' && optionsOrSystemPrompt !== null) {
    options = optionsOrSystemPrompt;
  } else {
    options = {
      systemPrompt: optionsOrSystemPrompt,
      conversationHistory,
      modelConfigId,
    };
  }

  const registry = getAIRegistry();
  const model = await registry.getLanguageModel(options.modelConfigId);

  if (!model) {
    throw new Error("No chat model configured. Please configure a chat model in AI Models.");
  }

  const messages: CoreMessage[] = [
    {
      role: "system",
      content: buildRAGSystemPrompt(options.systemPrompt),
    },
  ];

  // Add conversation history if provided
  if (options.conversationHistory) {
    for (const turn of options.conversationHistory) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }
  }

  // Add the current question with context
  messages.push({
    role: "user",
    content: buildRAGUserPrompt(question, chunks),
  });

  const maxCitations = options.maxCitations ?? 3;

  const result = await retry(
    async () => {
      const response = await generateText({
        model,
        messages,
        maxTokens: 1024,
        temperature: 0.1,
      });

      const answer = response.text;

      // Extract citations from the answer
      const citations = extractCitations(answer, chunks, maxCitations);

      return {
        answer,
        citations,
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
      };
    },
    { maxAttempts: 3, initialDelayMs: 1000 }
  );

  return result;
}

/**
 * Generate a streaming RAG response.
 * @param question - The user's question
 * @param chunks - Context chunks to use for answering
 * @param optionsOrSystemPrompt - RAGOptions object (preferred) or systemPrompt string (deprecated)
 * @param conversationHistory - Deprecated: use options.conversationHistory instead
 * @param modelConfigId - Deprecated: use options.modelConfigId instead
 */
export async function* generateRAGResponseStream(
  question: string,
  chunks: ChunkContext[],
  optionsOrSystemPrompt?: RAGOptions | string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  modelConfigId?: string
): AsyncGenerator<string, RAGResponse> {
  // Handle both old and new signatures
  let options: RAGOptions;
  if (typeof optionsOrSystemPrompt === 'object' && optionsOrSystemPrompt !== null) {
    options = optionsOrSystemPrompt;
  } else {
    options = {
      systemPrompt: optionsOrSystemPrompt,
      conversationHistory,
      modelConfigId,
    };
  }

  const registry = getAIRegistry();
  const model = await registry.getLanguageModel(options.modelConfigId);

  if (!model) {
    throw new Error("No chat model configured. Please configure a chat model in AI Models.");
  }

  const messages: CoreMessage[] = [
    {
      role: "system",
      content: buildRAGSystemPrompt(options.systemPrompt),
    },
  ];

  if (options.conversationHistory) {
    for (const turn of options.conversationHistory) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }
  }

  messages.push({
    role: "user",
    content: buildRAGUserPrompt(question, chunks),
  });

  const { textStream, usage } = streamText({
    model,
    messages,
    maxTokens: 1024,
    temperature: 0.1,
    experimental_transform: smoothStream({
      delayInMs: 15,
      chunking: 'word',
    }),
  });

  let fullAnswer = "";

  for await (const chunk of textStream) {
    fullAnswer += chunk;
    yield chunk;
  }

  const maxCitations = options.maxCitations ?? 3;
  const finalUsage = await usage;
  const citations = extractCitations(fullAnswer, chunks, maxCitations);

  return {
    answer: fullAnswer,
    citations,
    promptTokens: finalUsage?.promptTokens || 0,
    completionTokens: finalUsage?.completionTokens || 0,
  };
}

/**
 * Extract citations from the response by matching with provided chunks.
 * @param answer - The generated answer text
 * @param chunks - Context chunks that were used
 * @param maxCitations - Maximum number of citations to return (default: 3)
 */
function extractCitations(answer: string, chunks: ChunkContext[], maxCitations: number = 3): Citation[] {
  const citations: Citation[] = [];
  const citedChunkIds = new Set<string>();

  // Find references to sources in the answer
  for (const chunk of chunks) {
    // Check if chunk content or title is referenced
    const titleLower = chunk.title?.toLowerCase() || "";
    const answerLower = answer.toLowerCase();

    // Simple heuristic: if chunk title appears in answer, count as citation
    if (titleLower && answerLower.includes(titleLower)) {
      if (!citedChunkIds.has(chunk.id)) {
        citedChunkIds.add(chunk.id);
        citations.push({
          title: chunk.title,
          url: chunk.url,
          snippet: chunk.content.slice(0, 200),
          chunkId: chunk.id,
        });
      }
    }

    // Also check for URL references
    if (chunk.url && answer.includes(chunk.url)) {
      if (!citedChunkIds.has(chunk.id)) {
        citedChunkIds.add(chunk.id);
        citations.push({
          title: chunk.title,
          url: chunk.url,
          snippet: chunk.content.slice(0, 200),
          chunkId: chunk.id,
        });
      }
    }
  }

  // If no explicit citations found, include top chunks used in context
  if (citations.length === 0 && chunks.length > 0) {
    const topChunks = chunks.slice(0, maxCitations);
    for (const chunk of topChunks) {
      citations.push({
        title: chunk.title,
        url: chunk.url,
        snippet: chunk.content.slice(0, 200),
        chunkId: chunk.id,
      });
    }
  }

  // Limit to maxCitations even if explicit citations were found
  return citations.slice(0, maxCitations);
}

/**
 * Generate enrichment data for a document/page.
 * @param text - Document text to analyze
 * @param title - Optional document title
 * @param modelConfigId - Optional specific model to use (defaults to configured default)
 */
export async function generateEnrichment(
  text: string,
  title?: string,
  modelConfigId?: string
): Promise<EnrichmentResult> {
  const registry = getAIRegistry();
  const model = await registry.getLanguageModel(modelConfigId);

  if (!model) {
    throw new Error("No chat model configured. Please configure a chat model in AI Models.");
  }

  const prompt = `Analyze the following document and extract:
1. A brief summary (2-3 sentences)
2. 5-10 relevant keywords
3. 3-5 category tags (e.g., "documentation", "tutorial", "api-reference", "faq")
4. Named entities (products, technologies, people, companies mentioned)

Document Title: ${title || "Untitled"}

Document Content:
${text.slice(0, 8000)}

Respond in JSON format:
{
  "summary": "...",
  "keywords": ["..."],
  "tags": ["..."],
  "entities": ["..."]
}`;

  const result = await retry(
    async () => {
      const response = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        maxTokens: 1024,
        temperature: 0.1,
      });

      const content = response.text;

      // Try to parse JSON from the response
      try {
        // Handle potential markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                          content.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
        return JSON.parse(jsonStr) as EnrichmentResult;
      } catch {
        // Return default structure if parsing fails
        return {
          summary: content.slice(0, 500),
          keywords: [],
          tags: [],
          entities: [],
        };
      }
    },
    { maxAttempts: 3, initialDelayMs: 1000 }
  );

  return result;
}
