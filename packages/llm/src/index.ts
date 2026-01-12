import { generateText, streamText, smoothStream, type ModelMessage } from "ai";
import { getAIRegistry } from "@grounded/ai-providers";
import { retry, type Citation } from "@grounded/shared";

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
  inputTokens: number;
  outputTokens: number;
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

  const citationInstructions = `
CITATION RULES:
- When you use information from a source, add an inline citation using the source number in brackets, like [1], [2], [3]
- Place citations at the end of the sentence or phrase that uses that source's information
- You can cite multiple sources for the same information: [1][2]
- Only cite sources that you actually use in your answer
- If combining information from multiple sources, cite each one where relevant`;

  if (customPrompt) {
    return `${customPrompt}\n\n${citationInstructions}\n\n${dateTimeContext}`;
  }

  return `You are a helpful assistant that answers questions based ONLY on the provided context.

STRICT RULES:
1. Only answer questions based on the information in the CONTEXT section below
2. If the context does not contain enough information to answer the question, respond with: "I don't know based on the provided sources."
3. Be concise and direct in your answers
4. Do not make up or infer information that is not explicitly in the context
5. Do not use your general knowledge - only use the provided context
${citationInstructions}

Your response should be helpful, accurate, and well-structured.

${dateTimeContext}`;
}

function buildRAGUserPrompt(question: string, chunks: ChunkContext[]): string {
  const contextParts = chunks.map((chunk, i) => {
    const sourceNum = i + 1;
    const header = chunk.title || chunk.heading || "Untitled";
    const urlPart = chunk.url ? `\nURL: ${chunk.url}` : "";
    return `[Source ${sourceNum}] ${header}${urlPart}\n${chunk.content}`;
  });

  return `CONTEXT (${chunks.length} sources):
${contextParts.join("\n\n---\n\n")}

QUESTION: ${question}

Answer the question using the sources above. Remember to cite sources using [1], [2], etc.`;
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

  const messages: ModelMessage[] = [
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
        maxOutputTokens: 1024,
        temperature: 0.1,
      });

      const answer = response.text;

      // Extract citations from the answer
      const citations = extractCitations(answer, chunks, maxCitations);

      return {
        answer,
        citations,
        inputTokens: response.usage?.inputTokens || 0,
        outputTokens: response.usage?.outputTokens || 0,
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

  const messages: ModelMessage[] = [
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
    maxOutputTokens: 1024,
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
    inputTokens: finalUsage?.inputTokens || 0,
    outputTokens: finalUsage?.outputTokens || 0,
  };
}

/**
 * Extract citations from the response by parsing inline [1], [2], etc. markers.
 * @param answer - The generated answer text with inline citation markers
 * @param chunks - Context chunks that were used (ordered by source number)
 * @param maxCitations - Maximum number of citations to return (default: 3)
 */
function extractCitations(answer: string, chunks: ChunkContext[], maxCitations: number = 3): Citation[] {
  const citations: Citation[] = [];
  const citedIndices = new Set<number>();

  // Parse inline citation markers like [1], [2], [3]
  const citationPattern = /\[(\d+)\]/g;
  let match;

  while ((match = citationPattern.exec(answer)) !== null) {
    const index = parseInt(match[1], 10);
    // Only add if it's a valid source index (1-based)
    if (index >= 1 && index <= chunks.length) {
      citedIndices.add(index);
    }
  }

  // Build citations array from ALL cited indices (don't limit here)
  // The LLM may reference more sources than maxCitations in the text,
  // and we need all of them for proper inline citation rendering
  const sortedIndices = Array.from(citedIndices).sort((a, b) => a - b);

  for (const index of sortedIndices) {
    const chunk = chunks[index - 1]; // Convert 1-based to 0-based
    if (chunk) {
      citations.push({
        index,
        title: chunk.title,
        url: chunk.url,
        snippet: chunk.content.slice(0, 200),
        chunkId: chunk.id,
      });
    }
  }

  // If no inline citations found, fall back to including top chunks
  if (citations.length === 0 && chunks.length > 0) {
    const topChunks = chunks.slice(0, maxCitations);
    for (let i = 0; i < topChunks.length; i++) {
      const chunk = topChunks[i];
      citations.push({
        index: i + 1,
        title: chunk.title,
        url: chunk.url,
        snippet: chunk.content.slice(0, 200),
        chunkId: chunk.id,
      });
    }
  }

  return citations;
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
        maxOutputTokens: 1024,
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
