import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { db } from "@grounded/db";
import {
  agents,
  agentKbs,
  retrievalConfigs,
  kbChunks,
  agentCapabilities,
  agentTools,
  toolDefinitions,
  knowledgeBases,
  type ToolDefinition,
  type ApiToolConfig,
  type BuiltinToolConfig,
} from "@grounded/db/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { generateEmbedding } from "@grounded/embeddings";
import { getVectorStore } from "@grounded/vector-store";
import { getAIRegistry } from "@grounded/ai-providers";
import type { Citation } from "@grounded/shared";

// ============================================================================
// Types
// ============================================================================

export interface AgenticChatOptions {
  tenantId: string;
  agentId: string;
  message: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  modelConfigId?: string;
}

export interface ChainOfThoughtStep {
  type: "thinking" | "searching" | "tool_call" | "tool_result" | "answering";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  kbId?: string;
  kbName?: string;
  timestamp: number;
}

export interface AgenticChatResult {
  answer: string;
  citations: Citation[];
  chainOfThought: ChainOfThoughtStep[];
  inputTokens: number;
  outputTokens: number;
  toolCallsCount: number;
}

export interface StreamCallbacks {
  onChainOfThought?: (step: ChainOfThoughtStep) => void | Promise<void>;
  onText?: (text: string) => void | Promise<void>;
}

// ============================================================================
// Agentic Chat Service
// ============================================================================

export class AgenticChatService {
  private tenantId: string;
  private agentId: string;

  // Output rules to prevent LLMs from exposing internal reasoning (always appended to system prompts)
  private static readonly OUTPUT_RULES = `

OUTPUT RULES (CRITICAL - ALWAYS FOLLOW):
- Start your response directly with the answer content
- NEVER expose internal reasoning, planning, or thought process
- NEVER include meta-commentary like "We need to answer...", "I should...", "Let me think..."
- NEVER include XML-like tags such as <thinking>, <system-reminder>, <plan>, etc.
- Be conversational and helpful, not robotic`;

  /**
   * Filter out any leaked thinking/reasoning text from LLM output
   */
  private static filterThinkingText(text: string): string {
    let filtered = text;
    
    // Step 1: Remove ALL XML-like tags (including incomplete ones at end of stream)
    // Use greedy matching to catch everything between tags
    filtered = filtered
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
      .replace(/<plan>[\s\S]*?<\/plan>/gi, '')
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
      .replace(/<internal>[\s\S]*?<\/internal>/gi, '')
      // Also remove incomplete tags at the end (streaming)
      .replace(/<system-reminder>[^<]*$/gi, '')
      .replace(/<thinking>[^<]*$/gi, '')
      .replace(/<plan>[^<]*$/gi, '')
      // Remove any standalone opening tags that might appear
      .replace(/<system-reminder>/gi, '')
      .replace(/<\/system-reminder>/gi, '');
    
    // Step 2: Remove "We need to answer:" planning blocks at the START
    // Find where the actual answer begins (usually marked by ### or **)
    if (filtered.match(/^We need to answer:/i)) {
      // Look for markdown heading which typically starts the real answer
      const headingMatch = filtered.match(/\n?(#{1,3}\s+[A-Z])/);
      if (headingMatch && headingMatch.index !== undefined) {
        filtered = filtered.slice(headingMatch.index).trim();
      } else {
        // Look for bold text which often marks the start of the real answer
        const boldMatch = filtered.match(/\*\*[A-Z][^*]+\*\*/);
        if (boldMatch && boldMatch.index !== undefined) {
          filtered = filtered.slice(boldMatch.index);
        }
      }
    }
    
    // Step 3: Remove other thinking prefixes that might appear at the start
    const thinkingPrefixes = [
      /^I need to [^.]*\.\s*/i,
      /^Let me think[^.]*\.\s*/i,
      /^I should [^.]*\.\s*/i,
      /^The question[^.]*\.\s*/i,
      /^The context[^.]*\.\s*/i,
      /^Likely referring to[^.]*\.\s*/i,
      /^Provide explanation:[^.]*\.\s*/i,
    ];
    
    for (const pattern of thinkingPrefixes) {
      filtered = filtered.replace(pattern, '');
    }
    
    // Step 4: Detect repetitive loops (model bug) and truncate
    const repetitiveMatch = filtered.match(/(Provide [^.]{10,50}\.)\s*\1/i);
    if (repetitiveMatch && repetitiveMatch.index !== undefined) {
      filtered = filtered.slice(0, repetitiveMatch.index).trim();
    }
    
    // Step 5: If STILL starts with thinking-like text, be more aggressive
    if (filtered.match(/^(We need to|I need to|Let me|I should|The question|The context|Likely|Provide explanation)/i)) {
      // Find the first heading (###) or bold (**) which marks real content
      const contentMarkers = [
        filtered.search(/#{1,3}\s+[A-Z]/),
        filtered.search(/\*\*[A-Z]/),
      ].filter(i => i > 0);
      
      if (contentMarkers.length > 0) {
        const firstContent = Math.min(...contentMarkers);
        filtered = filtered.slice(firstContent);
      }
    }
    
    return filtered.trim();
  }

  constructor(tenantId: string, agentId: string) {
    this.tenantId = tenantId;
    this.agentId = agentId;
  }

  /**
   * Load agent configuration including capabilities and tools
   */
  async loadAgentConfig() {
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, this.agentId),
        eq(agents.tenantId, this.tenantId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new Error("Agent not found");
    }

    // Get retrieval config
    const retrievalConfig = await db.query.retrievalConfigs.findFirst({
      where: eq(retrievalConfigs.agentId, this.agentId),
    });

    // Get capabilities
    const capabilities = await db.query.agentCapabilities.findFirst({
      where: eq(agentCapabilities.agentId, this.agentId),
    });

    // Get attached KB IDs
    const attachedKbs = await db.query.agentKbs.findMany({
      where: and(eq(agentKbs.agentId, this.agentId), isNull(agentKbs.deletedAt)),
    });
    const kbIds = attachedKbs.map((ak) => ak.kbId);

    // Get KB details for multi-KB routing
    let kbDetails: Array<{ id: string; name: string; description: string | null }> = [];
    if (kbIds.length > 0) {
      kbDetails = await db.query.knowledgeBases.findMany({
        where: inArray(knowledgeBases.id, kbIds),
        columns: { id: true, name: true, description: true },
      });
    }

    // Get attached tools if tool calling is enabled
    let tools: ToolDefinition[] = [];
    if (capabilities?.toolCallingEnabled) {
      const attachedTools = await db
        .select({
          tool: toolDefinitions,
        })
        .from(agentTools)
        .innerJoin(toolDefinitions, eq(toolDefinitions.id, agentTools.toolId))
        .where(
          and(
            eq(agentTools.agentId, this.agentId),
            eq(agentTools.isEnabled, true),
            isNull(agentTools.deletedAt),
            eq(toolDefinitions.isEnabled, true),
            isNull(toolDefinitions.deletedAt)
          )
        );
      tools = attachedTools.map((t) => t.tool);
    }

    return {
      agent,
      retrievalConfig: {
        topK: retrievalConfig?.topK || 8,
        candidateK: retrievalConfig?.candidateK || 40,
        rerankerEnabled: retrievalConfig?.rerankerEnabled ?? true,
        maxCitations: retrievalConfig?.maxCitations || 3,
      },
      capabilities: capabilities || {
        agenticModeEnabled: false,
        multiKbRoutingEnabled: false,
        toolCallingEnabled: false,
        maxToolCallsPerTurn: 5,
        multiStepReasoningEnabled: false,
        maxReasoningSteps: 3,
        showChainOfThought: true,
      },
      kbIds,
      kbDetails,
      tools,
    };
  }

  /**
   * Generate an agentic response with tool calling and multi-step reasoning
   */
  async generateResponse(options: AgenticChatOptions): Promise<AgenticChatResult> {
    const config = await this.loadAgentConfig();
    const chainOfThought: ChainOfThoughtStep[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsCount = 0;

    // If agentic mode is disabled, fall back to simple RAG
    if (!config.capabilities.agenticModeEnabled) {
      return this.generateSimpleRAGResponse(options, config);
    }

    const registry = getAIRegistry();
    const model = await registry.getLanguageModel(options.modelConfigId || config.agent.llmModelConfigId || undefined);

    if (!model) {
      throw new Error("No chat model configured");
    }

    // Build the system prompt with agentic capabilities
    const systemPrompt = this.buildAgenticSystemPrompt(config);

    // Build tools for the AI
    const aiTools = this.buildAITools(config);

    // Build messages
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    // Add conversation history
    for (const turn of options.conversationHistory) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }

    // Add current message
    messages.push({
      role: "user",
      content: options.message,
    });

    chainOfThought.push({
      type: "thinking",
      content: "Analyzing query and determining best approach...",
      timestamp: Date.now(),
    });

    // Generate with tools - use stopWhen for multi-step tool calling
    const maxToolCalls = config.capabilities.maxToolCallsPerTurn || 5;
    const result = await generateText({
      model,
      messages,
      tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
      stopWhen: Object.keys(aiTools).length > 0 ? stepCountIs(maxToolCalls) : undefined,
      maxOutputTokens: 2048,
      temperature: 0.1,
    });

    totalInputTokens += result.usage?.inputTokens || 0;
    totalOutputTokens += result.usage?.outputTokens || 0;

    // Process tool calls from steps
    const citations: Citation[] = [];
    
    if (result.steps) {
      for (const step of result.steps) {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const toolCall of step.toolCalls) {
            toolCallsCount++;
            // Cast to any to access dynamic properties
            const tc = toolCall as unknown as { toolName: string; args?: Record<string, unknown>; input?: Record<string, unknown> };
            
            chainOfThought.push({
              type: "tool_call",
              content: `Calling tool: ${tc.toolName}`,
              toolName: tc.toolName,
              toolArgs: tc.args || tc.input || {},
              timestamp: Date.now(),
            });
          }
        }
        
        if (step.toolResults && step.toolResults.length > 0) {
          for (const toolResult of step.toolResults) {
            // Cast to any to access dynamic properties
            const tr = toolResult as unknown as { toolName: string; result?: unknown; output?: unknown };
            const resultValue = tr.result ?? tr.output;
            
            chainOfThought.push({
              type: "tool_result",
              content: `Tool ${tr.toolName} completed`,
              toolName: tr.toolName,
              toolResult: resultValue,
              timestamp: Date.now(),
            });

            // Extract citations from search results
            if (tr.toolName === "search_knowledge_base" && resultValue) {
              const searchResult = resultValue as { sources?: Array<{ id: string; title: string; url: string; snippet: string }> };
              if (searchResult.sources) {
                for (const source of searchResult.sources) {
                  citations.push({
                    index: citations.length + 1,
                    title: source.title,
                    url: source.url,
                    snippet: source.snippet,
                    chunkId: source.id,
                  });
                }
              }
            }
          }
        }
      }
    }

    chainOfThought.push({
      type: "answering",
      content: "Generating final response",
      timestamp: Date.now(),
    });

    // De-duplicate citations
    const uniqueCitations = this.deduplicateCitations(citations, config.retrievalConfig.maxCitations);

    return {
      answer: result.text || "I was unable to generate a response. Please try again.",
      citations: uniqueCitations,
      chainOfThought,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      toolCallsCount,
    };
  }

  /**
   * Generate a streaming agentic response
   */
  async *generateResponseStream(
    options: AgenticChatOptions,
    callbacks?: StreamCallbacks
  ): AsyncGenerator<string, AgenticChatResult> {
    console.log("[AgenticChatService] Starting generateResponseStream");
    
    const config = await this.loadAgentConfig();
    console.log("[AgenticChatService] Config loaded:", {
      agentId: config.agent.id,
      agenticModeEnabled: config.capabilities.agenticModeEnabled,
      kbCount: config.kbIds.length,
      toolCount: config.tools.length,
    });
    
    const chainOfThought: ChainOfThoughtStep[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsCount = 0;
    const citations: Citation[] = [];

    // If agentic mode is disabled, fall back to simple RAG streaming
    if (!config.capabilities.agenticModeEnabled) {
      console.log("[AgenticChatService] Agentic mode disabled, falling back to simple RAG");
      const result = yield* this.generateSimpleRAGResponseStream(options, config, callbacks);
      return result;
    }

    const registry = getAIRegistry();
    const model = await registry.getLanguageModel(options.modelConfigId || config.agent.llmModelConfigId || undefined);

    if (!model) {
      console.error("[AgenticChatService] No chat model configured");
      throw new Error("No chat model configured");
    }
    
    console.log("[AgenticChatService] Model loaded successfully");

    // Build the system prompt with agentic capabilities
    const systemPrompt = this.buildAgenticSystemPrompt(config);

    // Build tools for the AI
    const aiTools = this.buildAITools(config);

    // Build messages
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    for (const turn of options.conversationHistory) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }

    messages.push({
      role: "user",
      content: options.message,
    });

    const hasTools = Object.keys(aiTools).length > 0;
    console.log("[AgenticChatService] Has tools:", hasTools, "Tool names:", Object.keys(aiTools));

    if (hasTools) {
      // Use streamText with fullStream for real-time streaming of tool calls and text
      console.log("[AgenticChatService] Starting streaming tool execution phase");
      const thinkingStep: ChainOfThoughtStep = {
        type: "thinking",
        content: "Analyzing query and determining best approach...",
        timestamp: Date.now(),
      };
      chainOfThought.push(thinkingStep);
      if (callbacks?.onChainOfThought) {
        await callbacks.onChainOfThought(thinkingStep);
      }

      const maxToolCalls = config.capabilities.maxToolCallsPerTurn || 5;
      console.log("[AgenticChatService] Calling streamText with maxToolCalls:", maxToolCalls);
      
      const result = streamText({
        model,
        messages,
        tools: aiTools,
        stopWhen: stepCountIs(maxToolCalls),
        maxOutputTokens: 2048,
        temperature: 0.1,
        // Removed smoothStream to eliminate artificial delays
        // Text will stream as fast as the model produces it
      });

      let fullText = "";
      let hasStartedGenerating = false;
      let yieldedLength = 0;
      let hasStartedYielding = false;

      // Process the stream in real-time
      for await (const part of result.fullStream) {
        if (part.type === "tool-call") {
          toolCallsCount++;
          // Use 'input' property (AI SDK 5+/6+)
          const toolInput = (part as unknown as { input?: unknown }).input;
          const callStep: ChainOfThoughtStep = {
            type: "tool_call",
            content: `Calling tool: ${part.toolName}`,
            toolName: part.toolName,
            toolArgs: toolInput as Record<string, unknown>,
            timestamp: Date.now(),
          };
          chainOfThought.push(callStep);
          if (callbacks?.onChainOfThought) {
            await callbacks.onChainOfThought(callStep);
          }
          console.log("[AgenticChatService] Tool call:", part.toolName);
        } else if (part.type === "tool-result") {
          // Use 'output' property (AI SDK 5+/6+)
          const toolOutput = (part as unknown as { output?: unknown }).output;
          const resultStep: ChainOfThoughtStep = {
            type: "tool_result",
            content: `Tool ${part.toolName} completed`,
            toolName: part.toolName,
            toolResult: toolOutput,
            timestamp: Date.now(),
          };
          chainOfThought.push(resultStep);
          if (callbacks?.onChainOfThought) {
            await callbacks.onChainOfThought(resultStep);
          }
          console.log("[AgenticChatService] Tool result:", part.toolName);

          // Extract citations from search results
          if (part.toolName === "search_knowledge_base" && toolOutput) {
            const searchResult = toolOutput as { sources?: Array<{ id: string; title: string; url: string; snippet: string }> };
            if (searchResult.sources) {
              for (const source of searchResult.sources) {
                citations.push({
                  index: citations.length + 1,
                  title: source.title,
                  url: source.url,
                  snippet: source.snippet,
                  chunkId: source.id,
                });
              }
            }
          }
        } else if (part.type === "text-delta") {
          // First text chunk - send "answering" step
          if (!hasStartedGenerating) {
            hasStartedGenerating = true;
            const answerStep: ChainOfThoughtStep = {
              type: "answering",
              content: "Generating response...",
              timestamp: Date.now(),
            };
            chainOfThought.push(answerStep);
            if (callbacks?.onChainOfThought) {
              await callbacks.onChainOfThought(answerStep);
            }
          }
          
          // Use 'text' property (AI SDK 6+)
          const textChunk = (part as unknown as { text?: string }).text || "";
          fullText += textChunk;
          
          // Apply filter to accumulated text
          const filteredText = AgenticChatService.filterThinkingText(fullText);
          
          // Only start yielding once we have meaningful content
          // Must NOT start with thinking patterns AND must look like real content
          if (!hasStartedYielding) {
            const startsWithThinking = filteredText.match(/^(We need to|I need to|Let me|I should|The question|The context|Likely|Provide explanation)/i);
            const matchesAnswerPattern = filteredText.match(/^(#{1,3}\s|###|\*\*[A-Z]|To |You can |Here|The |Install|First|1\.|-)/);
            const looksLikeAnswer = filteredText.length > 0 && !startsWithThinking && (
              matchesAnswerPattern ||
              filteredText.length >= 300
            );
            
            // Debug logging
            if (fullText.length > 100 && fullText.length % 200 < 50) {
              console.log('[Filter Debug] fullText len:', fullText.length, 'filteredText len:', filteredText.length);
              console.log('[Filter Debug] filteredText start:', filteredText.substring(0, 80));
              console.log('[Filter Debug] startsWithThinking:', !!startsWithThinking, 'matchesPattern:', !!matchesAnswerPattern, 'looksLikeAnswer:', looksLikeAnswer);
            }
            if (!looksLikeAnswer) {
              continue;
            }
            hasStartedYielding = true;
          }
          
          // Yield only the new portion since last yield
          const newContent = filteredText.slice(yieldedLength);
          if (newContent) {
            yield newContent;
            if (callbacks?.onText) {
              await callbacks.onText(newContent);
            }
            yieldedLength = filteredText.length;
          }
        }
      }
      
      // Yield any remaining content after stream ends
      const finalFilteredText = AgenticChatService.filterThinkingText(fullText);
      const remainingText = finalFilteredText.slice(yieldedLength);
      if (remainingText) {
        yield remainingText;
        if (callbacks?.onText) {
          await callbacks.onText(remainingText);
        }
      }

      // Get final usage stats
      const usage = await result.usage;
      totalInputTokens += usage?.inputTokens || 0;
      totalOutputTokens += usage?.outputTokens || 0;

      console.log("[AgenticChatService] streamText completed:", {
        textLength: fullText.length,
        toolCallsCount,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });

      if (fullText) {
        const uniqueCitations = this.deduplicateCitations(citations, config.retrievalConfig.maxCitations);

        return {
          answer: AgenticChatService.filterThinkingText(fullText),
          citations: uniqueCitations,
          chainOfThought,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          toolCallsCount,
        };
      }
    }

    // No tools or tools didn't produce output - do streaming RAG
    const searchStep: ChainOfThoughtStep = {
      type: "searching",
      content: "Searching knowledge base...",
      timestamp: Date.now(),
    };
    chainOfThought.push(searchStep);
    if (callbacks?.onChainOfThought) {
      await callbacks.onChainOfThought(searchStep);
    }

    // Retrieve chunks
    const chunks = await this.retrieveChunks(
      config.kbIds,
      options.message,
      config.retrievalConfig.candidateK,
      config.retrievalConfig.topK,
      config.retrievalConfig.rerankerEnabled
    );

    // Build citations from chunks
    const chunkCitations = chunks.slice(0, config.retrievalConfig.maxCitations).map((chunk, i) => ({
      index: i + 1,
      title: chunk.title,
      url: chunk.normalizedUrl,
      snippet: chunk.content.slice(0, 200),
      chunkId: chunk.id,
    }));

    const answerStep: ChainOfThoughtStep = {
      type: "answering",
      content: `Found ${chunks.length} relevant sources. Generating response...`,
      timestamp: Date.now(),
    };
    chainOfThought.push(answerStep);
    if (callbacks?.onChainOfThought) {
      await callbacks.onChainOfThought(answerStep);
    }

    // Build RAG prompt
    const ragPrompt = this.buildRAGPrompt(options.message, chunks);
    const ragMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: this.buildSimpleRAGSystemPrompt(config.agent.systemPrompt) },
      ...options.conversationHistory.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      })),
      { role: "user", content: ragPrompt },
    ];

    // Stream the response
    const { textStream, usage } = streamText({
      model,
      messages: ragMessages,
      maxOutputTokens: 2048,
      temperature: 0.1,
      // Removed smoothStream to eliminate artificial delays
    });

    let fullAnswer = "";
    let yieldedLength = 0;
    let hasStartedYielding = false;
    
    for await (const chunk of textStream) {
      fullAnswer += chunk;
      
      // Apply filter to accumulated text
      const filteredAnswer = AgenticChatService.filterThinkingText(fullAnswer);
      
      // Only start yielding once we have meaningful content (not thinking text)
      if (!hasStartedYielding) {
        const startsWithThinking = filteredAnswer.match(/^(We need to|I need to|Let me|I should|The question|The context|Likely|Provide explanation)/i);
        const looksLikeAnswer = filteredAnswer.length > 0 && !startsWithThinking && (
          filteredAnswer.match(/^(#{1,3}\s|###|\*\*[A-Z]|To |You can |Here|The |Install|First|1\.|-)/) ||
          filteredAnswer.length >= 300
        );
        if (!looksLikeAnswer) {
          continue;
        }
        hasStartedYielding = true;
      }
      
      // Yield only the new portion since last yield
      const newContent = filteredAnswer.slice(yieldedLength);
      if (newContent) {
        yield newContent;
        if (callbacks?.onText) {
          await callbacks.onText(newContent);
        }
        yieldedLength = filteredAnswer.length;
      }
    }
    
    // Yield any remaining content after stream ends
    const finalFiltered = AgenticChatService.filterThinkingText(fullAnswer);
    const remaining = finalFiltered.slice(yieldedLength);
    if (remaining) {
      yield remaining;
      if (callbacks?.onText) {
        await callbacks.onText(remaining);
      }
    }

    const finalUsage = await usage;
    totalInputTokens += finalUsage?.inputTokens || 0;
    totalOutputTokens += finalUsage?.outputTokens || 0;

    return {
      answer: AgenticChatService.filterThinkingText(fullAnswer),
      citations: chunkCitations,
      chainOfThought,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      toolCallsCount,
    };
  }

  /**
   * Simple RAG response (non-agentic)
   */
  private async generateSimpleRAGResponse(
    options: AgenticChatOptions,
    config: Awaited<ReturnType<typeof this.loadAgentConfig>>
  ): Promise<AgenticChatResult> {
    const chainOfThought: ChainOfThoughtStep[] = [];

    chainOfThought.push({
      type: "searching",
      content: "Searching knowledge base...",
      timestamp: Date.now(),
    });

    // Retrieve chunks
    const chunks = await this.retrieveChunks(
      config.kbIds,
      options.message,
      config.retrievalConfig.candidateK,
      config.retrievalConfig.topK,
      config.retrievalConfig.rerankerEnabled
    );

    chainOfThought.push({
      type: "answering",
      content: `Found ${chunks.length} relevant sources. Generating response...`,
      timestamp: Date.now(),
    });

    const registry = getAIRegistry();
    const model = await registry.getLanguageModel(options.modelConfigId || config.agent.llmModelConfigId || undefined);

    if (!model) {
      throw new Error("No chat model configured");
    }

    // Build RAG prompt
    const ragPrompt = this.buildRAGPrompt(options.message, chunks);
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: this.buildSimpleRAGSystemPrompt(config.agent.systemPrompt) },
      ...options.conversationHistory.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      })),
      { role: "user", content: ragPrompt },
    ];

    const result = await generateText({
      model,
      messages,
      maxOutputTokens: 2048,
      temperature: 0.1,
    });

    // Build citations
    const citations = chunks.slice(0, config.retrievalConfig.maxCitations).map((chunk, i) => ({
      index: i + 1,
      title: chunk.title,
      url: chunk.normalizedUrl,
      snippet: chunk.content.slice(0, 200),
      chunkId: chunk.id,
    }));

    return {
      answer: AgenticChatService.filterThinkingText(result.text),
      citations,
      chainOfThought,
      inputTokens: result.usage?.inputTokens || 0,
      outputTokens: result.usage?.outputTokens || 0,
      toolCallsCount: 0,
    };
  }

  /**
   * Simple RAG streaming response (non-agentic)
   */
  private async *generateSimpleRAGResponseStream(
    options: AgenticChatOptions,
    config: Awaited<ReturnType<typeof this.loadAgentConfig>>,
    callbacks?: StreamCallbacks
  ): AsyncGenerator<string, AgenticChatResult> {
    const chainOfThought: ChainOfThoughtStep[] = [];

    const searchStep: ChainOfThoughtStep = {
      type: "searching",
      content: "Searching knowledge base...",
      timestamp: Date.now(),
    };
    chainOfThought.push(searchStep);
    if (callbacks?.onChainOfThought) {
      await callbacks.onChainOfThought(searchStep);
    }

    // Retrieve chunks
    const chunks = await this.retrieveChunks(
      config.kbIds,
      options.message,
      config.retrievalConfig.candidateK,
      config.retrievalConfig.topK,
      config.retrievalConfig.rerankerEnabled
    );

    const answerStep: ChainOfThoughtStep = {
      type: "answering",
      content: `Found ${chunks.length} relevant sources. Generating response...`,
      timestamp: Date.now(),
    };
    chainOfThought.push(answerStep);
    if (callbacks?.onChainOfThought) {
      await callbacks.onChainOfThought(answerStep);
    }

    const registry = getAIRegistry();
    const model = await registry.getLanguageModel(options.modelConfigId || config.agent.llmModelConfigId || undefined);

    if (!model) {
      throw new Error("No chat model configured");
    }

    // Build RAG prompt
    const ragPrompt = this.buildRAGPrompt(options.message, chunks);
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: this.buildSimpleRAGSystemPrompt(config.agent.systemPrompt) },
      ...options.conversationHistory.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      })),
      { role: "user", content: ragPrompt },
    ];

    const { textStream, usage } = streamText({
      model,
      messages,
      maxOutputTokens: 2048,
      temperature: 0.1,
      // Removed smoothStream to eliminate artificial delays
    });

    let fullAnswer = "";
    let yieldedLength = 0;
    let hasStartedYielding = false;
    
    for await (const chunk of textStream) {
      fullAnswer += chunk;
      
      // Apply filter to accumulated text
      const filteredAnswer = AgenticChatService.filterThinkingText(fullAnswer);
      
      // Only start yielding once we have meaningful content (not thinking text)
      if (!hasStartedYielding) {
        const startsWithThinking = filteredAnswer.match(/^(We need to|I need to|Let me|I should|The question|The context|Likely|Provide explanation)/i);
        const looksLikeAnswer = filteredAnswer.length > 0 && !startsWithThinking && (
          filteredAnswer.match(/^(#{1,3}\s|###|\*\*[A-Z]|To |You can |Here|The |Install|First|1\.|-)/) ||
          filteredAnswer.length >= 300
        );
        if (!looksLikeAnswer) {
          continue;
        }
        hasStartedYielding = true;
      }
      
      // Yield only the new portion since last yield
      const newContent = filteredAnswer.slice(yieldedLength);
      if (newContent) {
        yield newContent;
        yieldedLength = filteredAnswer.length;
      }
    }
    
    // Yield any remaining content after stream ends
    const finalFiltered = AgenticChatService.filterThinkingText(fullAnswer);
    const remaining = finalFiltered.slice(yieldedLength);
    if (remaining) {
      yield remaining;
    }

    const finalUsage = await usage;

    // Build citations
    const citations = chunks.slice(0, config.retrievalConfig.maxCitations).map((chunk, i) => ({
      index: i + 1,
      title: chunk.title,
      url: chunk.normalizedUrl,
      snippet: chunk.content.slice(0, 200),
      chunkId: chunk.id,
    }));

    return {
      answer: AgenticChatService.filterThinkingText(fullAnswer),
      citations,
      chainOfThought,
      inputTokens: finalUsage?.inputTokens || 0,
      outputTokens: finalUsage?.outputTokens || 0,
      toolCallsCount: 0,
    };
  }

  /**
   * Build the agentic system prompt
   */
  private buildAgenticSystemPrompt(config: Awaited<ReturnType<typeof this.loadAgentConfig>>): string {
    const basePrompt = config.agent.systemPrompt || "You are a helpful assistant.";
    const description = config.agent.description ? `\n\nAgent Description: ${config.agent.description}` : "";

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    let capabilitiesPrompt = "";

    if (config.capabilities.multiKbRoutingEnabled && config.kbDetails.length > 1) {
      capabilitiesPrompt += `\n\nYou have access to multiple knowledge bases. When answering questions, use the search_knowledge_base tool to find relevant information. Available knowledge bases:\n`;
      for (const kb of config.kbDetails) {
        capabilitiesPrompt += `- ${kb.name}: ${kb.description || "No description"}\n`;
      }
      capabilitiesPrompt += `\nChoose the most appropriate knowledge base(s) based on the user's question.`;
    }

    if (config.capabilities.toolCallingEnabled && config.tools.length > 0) {
      capabilitiesPrompt += `\n\nYou have access to external tools. Use them when appropriate to provide better answers.`;
    }

    if (config.capabilities.multiStepReasoningEnabled) {
      capabilitiesPrompt += `\n\nFor complex questions, break down your reasoning into steps. Think through the problem carefully before providing your final answer.`;
    }

    const citationInstructions = `\n\nCITATION RULES:
- When you use information from a source, add an inline citation using the source number in brackets, like [1], [2], [3]
- Place citations at the end of the sentence or phrase that uses that source's information
- Only cite sources that you actually use in your answer`;

    return `${basePrompt}${description}\n\nCurrent date and time: ${dateStr}, ${timeStr}${capabilitiesPrompt}${citationInstructions}${AgenticChatService.OUTPUT_RULES}`;
  }

  /**
   * Build the simple RAG system prompt
   */
  private buildSimpleRAGSystemPrompt(customPrompt?: string): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    const citationInstructions = `
CITATION RULES:
- When you use information from a source, add an inline citation using the source number in brackets, like [1], [2], [3]
- Place citations at the end of the sentence or phrase that uses that source's information
- Only cite sources that you actually use in your answer`;

    if (customPrompt) {
      return `${customPrompt}\n\n${citationInstructions}${AgenticChatService.OUTPUT_RULES}\n\nCurrent date and time: ${dateStr}, ${timeStr}`;
    }

    return `You are a helpful assistant that answers questions based ONLY on the provided context.

STRICT RULES:
1. Only answer questions based on the information in the CONTEXT section below
2. If the context does not contain enough information to answer the question, respond with: "I don't know based on the provided sources."
3. Be concise and direct in your answers
4. Do not make up or infer information that is not explicitly in the context
${citationInstructions}${AgenticChatService.OUTPUT_RULES}

Current date and time: ${dateStr}, ${timeStr}`;
  }

  /**
   * Build the RAG prompt with context
   */
  private buildRAGPrompt(question: string, chunks: Array<typeof kbChunks.$inferSelect & { score: number }>): string {
    const contextParts = chunks.map((chunk, i) => {
      const sourceNum = i + 1;
      const header = chunk.title || chunk.heading || "Untitled";
      const urlPart = chunk.normalizedUrl ? `\nURL: ${chunk.normalizedUrl}` : "";
      return `[Source ${sourceNum}] ${header}${urlPart}\n${chunk.content}`;
    });

    return `CONTEXT (${chunks.length} sources):
${contextParts.join("\n\n---\n\n")}

QUESTION: ${question}

Answer the question using the sources above. Remember to cite sources using [1], [2], etc.`;
  }

  /**
   * Build AI tools based on agent configuration
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildAITools(config: Awaited<ReturnType<typeof this.loadAgentConfig>>): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};
    const service = this;

    // Add search_knowledge_base tool if we have KBs
    if (config.kbIds.length > 0) {
      tools.search_knowledge_base = tool({
        description: "Search the knowledge base for relevant information. Use this to find facts, documentation, or answers from the knowledge sources.",
        inputSchema: z.object({
          query: z.string().describe("The search query to find relevant information"),
          kb_id: z.string().optional().describe("Optional: specific knowledge base ID to search. If not provided, searches all available knowledge bases."),
        }),
        execute: async ({ query, kb_id }: { query: string; kb_id?: string }) => {
          const kbsToSearch = kb_id ? [kb_id] : config.kbIds;
          const chunks = await service.retrieveChunks(
            kbsToSearch,
            query,
            config.retrievalConfig.candidateK,
            config.retrievalConfig.topK,
            config.retrievalConfig.rerankerEnabled
          );

          return {
            sources: chunks.map((chunk, i) => ({
              id: chunk.id,
              index: i + 1,
              title: chunk.title || chunk.heading || "Untitled",
              url: chunk.normalizedUrl,
              snippet: chunk.content.slice(0, 500),
              score: chunk.score,
            })),
            totalFound: chunks.length,
          };
        },
      });
    }

    // Add builtin tools
    for (const toolDef of config.tools) {
      if (toolDef.type === "builtin") {
        const builtinConfig = toolDef.config as BuiltinToolConfig;
        const toolName = toolDef.name.toLowerCase().replace(/\s+/g, "_");
        
        switch (builtinConfig.toolType) {
          case "calculator":
            tools[toolName] = tool({
              description: toolDef.description || "Perform mathematical calculations",
              inputSchema: z.object({
                expression: z.string().describe("The mathematical expression to evaluate (e.g., '2 + 2', '10 * 5', 'sqrt(16)')"),
              }),
              execute: async ({ expression }: { expression: string }) => {
                try {
                  // Safe math evaluation (basic operations only)
                  const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
                  const result = Function(`"use strict"; return (${sanitized})`)();
                  return { result, expression: sanitized };
                } catch {
                  return { error: "Invalid expression", expression };
                }
              },
            });
            break;

          case "date_time":
            tools[toolName] = tool({
              description: toolDef.description || "Get current date and time information",
              inputSchema: z.object({
                format: z.enum(["full", "date", "time", "iso"]).optional().describe("Output format"),
                timezone: z.string().optional().describe("Timezone (e.g., 'America/New_York')"),
              }),
              execute: async ({ format = "full", timezone }: { format?: "full" | "date" | "time" | "iso"; timezone?: string }) => {
                const now = new Date();
                const options: Intl.DateTimeFormatOptions = {
                  timeZone: timezone || "UTC",
                };

                switch (format) {
                  case "date":
                    return {
                      date: now.toLocaleDateString("en-US", { ...options, dateStyle: "full" }),
                    };
                  case "time":
                    return {
                      time: now.toLocaleTimeString("en-US", { ...options, timeStyle: "long" }),
                    };
                  case "iso":
                    return { iso: now.toISOString() };
                  default:
                    return {
                      date: now.toLocaleDateString("en-US", { ...options, dateStyle: "full" }),
                      time: now.toLocaleTimeString("en-US", { ...options, timeStyle: "long" }),
                      iso: now.toISOString(),
                      timestamp: now.getTime(),
                    };
                }
              },
            });
            break;

          case "multi_kb_router":
            // This is handled by the search_knowledge_base tool with kb_id parameter
            break;

          case "web_search":
            // Web search would require external API integration
            break;
        }
      } else if (toolDef.type === "api") {
        // Add API tool
        const apiConfig = toolDef.config as ApiToolConfig;
        const toolName = toolDef.name.toLowerCase().replace(/\s+/g, "_");
        
        // Build zod schema from parameters
        const schemaShape: Record<string, z.ZodTypeAny> = {};
        for (const param of toolDef.parameters) {
          let paramSchema: z.ZodTypeAny;
          switch (param.type) {
            case "number":
              paramSchema = z.number();
              break;
            case "boolean":
              paramSchema = z.boolean();
              break;
            case "array":
              paramSchema = z.array(z.unknown());
              break;
            case "object":
              paramSchema = z.record(z.string(), z.unknown());
              break;
            default:
              paramSchema = z.string();
          }

          if (param.description) {
            paramSchema = paramSchema.describe(param.description);
          }

          if (!param.required) {
            paramSchema = paramSchema.optional();
          }

          schemaShape[param.name] = paramSchema;
        }

        tools[toolName] = tool({
          description: toolDef.description,
          inputSchema: z.object(schemaShape),
          execute: async (args: Record<string, unknown>) => {
            try {
              // Build URL with path parameters
              let url = `${apiConfig.baseUrl}${apiConfig.path}`;
              for (const [key, value] of Object.entries(args)) {
                url = url.replace(`{${key}}`, String(value));
              }

              // Build headers
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
                ...apiConfig.headers,
              };

              // Add authentication
              switch (apiConfig.auth.type) {
                case "bearer":
                  if (apiConfig.auth.secret) {
                    headers["Authorization"] = `Bearer ${apiConfig.auth.secret}`;
                  }
                  break;
                case "api_key":
                  if (apiConfig.auth.headerName && apiConfig.auth.secret) {
                    headers[apiConfig.auth.headerName] = apiConfig.auth.secret;
                  }
                  break;
                case "basic":
                  if (apiConfig.auth.username && apiConfig.auth.secret) {
                    const credentials = Buffer.from(
                      `${apiConfig.auth.username}:${apiConfig.auth.secret}`
                    ).toString("base64");
                    headers["Authorization"] = `Basic ${credentials}`;
                  }
                  break;
                case "custom_header":
                  if (apiConfig.auth.headerName && apiConfig.auth.secret) {
                    headers[apiConfig.auth.headerName] = apiConfig.auth.secret;
                  }
                  break;
              }

              // Build request body
              let body: string | undefined;
              if (["POST", "PUT", "PATCH"].includes(apiConfig.method)) {
                if (apiConfig.bodyTemplate) {
                  body = apiConfig.bodyTemplate;
                  for (const [key, value] of Object.entries(args)) {
                    body = body.replace(`{{${key}}}`, JSON.stringify(value));
                  }
                } else {
                  body = JSON.stringify(args);
                }
              }

              const response = await fetch(url, {
                method: apiConfig.method,
                headers,
                body,
                signal: AbortSignal.timeout(apiConfig.timeoutMs || 30000),
              });

              if (!response.ok) {
                return {
                  error: `API call failed with status ${response.status}`,
                  status: response.status,
                };
              }

              if (apiConfig.responseFormat === "text") {
                return { result: await response.text() };
              }

              return { result: await response.json() };
            } catch (error) {
              return {
                error: error instanceof Error ? error.message : "API call failed",
              };
            }
          },
        });
      }
    }

    return tools;
  }

  /**
   * Retrieve relevant chunks from knowledge bases
   */
  private async retrieveChunks(
    kbIds: string[],
    query: string,
    candidateK: number,
    topK: number,
    rerankerEnabled: boolean
  ): Promise<Array<typeof kbChunks.$inferSelect & { score: number }>> {
    if (kbIds.length === 0) {
      return [];
    }

    const vectorStore = getVectorStore();

    if (!vectorStore) {
      // Fallback to keyword search
      return this.retrieveChunksKeywordOnly(kbIds, query, topK);
    }

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Vector similarity search
    const vectorResults = await vectorStore.search(queryEmbedding.embedding, {
      tenantId: this.tenantId,
      kbIds,
      topK: candidateK,
    });

    const vectorChunkIds = vectorResults.map((r) => r.id);

    // Fetch chunk details
    let vectorChunks: Array<typeof kbChunks.$inferSelect> = [];
    if (vectorChunkIds.length > 0) {
      vectorChunks = await db.query.kbChunks.findMany({
        where: and(
          inArray(kbChunks.id, vectorChunkIds),
          isNull(kbChunks.deletedAt)
        ),
      });
    }

    // Create chunk map with scores
    const chunkMap = new Map<string, typeof kbChunks.$inferSelect & { vectorScore: number; keywordScore: number; score: number }>();
    for (const chunk of vectorChunks) {
      const vectorResult = vectorResults.find((r) => r.id === chunk.id);
      chunkMap.set(chunk.id, {
        ...chunk,
        vectorScore: vectorResult?.score || 0,
        keywordScore: 0,
        score: 0,
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
        ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) as rank
      FROM kb_chunks c
      WHERE (c.tenant_id = ${this.tenantId} OR c.tenant_id IS NULL)
        AND c.kb_id = ANY(${kbIdsArrayLiteral}::uuid[])
        AND c.deleted_at IS NULL
        AND c.tsv @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${candidateK}
    `);

    // Merge keyword results
    const keywordRows = Array.isArray(keywordResults)
      ? keywordResults
      : (keywordResults as { rows?: unknown[] }).rows || [];
    for (const row of keywordRows as Array<Record<string, unknown>>) {
      const existing = chunkMap.get(row.id as string);
      if (existing) {
        existing.keywordScore = parseFloat(String(row.rank)) || 0;
      } else {
        chunkMap.set(row.id as string, {
          ...row,
          vectorScore: 0,
          keywordScore: parseFloat(String(row.rank)) || 0,
          score: 0,
        } as typeof kbChunks.$inferSelect & { vectorScore: number; keywordScore: number; score: number });
      }
    }

    let chunks = Array.from(chunkMap.values());

    if (rerankerEnabled) {
      chunks = this.heuristicRerank(chunks, query);
    } else {
      chunks.sort((a, b) => b.vectorScore - a.vectorScore);
    }

    return chunks.slice(0, topK);
  }

  /**
   * Keyword-only search fallback
   */
  private async retrieveChunksKeywordOnly(
    kbIds: string[],
    query: string,
    topK: number
  ): Promise<Array<typeof kbChunks.$inferSelect & { score: number }>> {
    const kbIdsArrayLiteral = `{${kbIds.join(",")}}`;

    const keywordResults = await db.execute(sql`
      SELECT
        c.*,
        ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) as rank
      FROM kb_chunks c
      WHERE (c.tenant_id = ${this.tenantId} OR c.tenant_id IS NULL)
        AND c.kb_id = ANY(${kbIdsArrayLiteral}::uuid[])
        AND c.deleted_at IS NULL
        AND c.tsv @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${topK}
    `);

    const rows = Array.isArray(keywordResults)
      ? keywordResults
      : (keywordResults as { rows?: unknown[] }).rows || [];
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      score: parseFloat(String(row.rank)) || 0,
    })) as Array<typeof kbChunks.$inferSelect & { score: number }>;
  }

  /**
   * Heuristic reranking
   */
  private heuristicRerank(
    chunks: Array<typeof kbChunks.$inferSelect & { vectorScore: number; keywordScore: number; score: number }>,
    query: string
  ): Array<typeof kbChunks.$inferSelect & { vectorScore: number; keywordScore: number; score: number }> {
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

  /**
   * Deduplicate citations
   */
  private deduplicateCitations(citations: Citation[], maxCitations: number): Citation[] {
    const seen = new Set<string>();
    const unique: Citation[] = [];

    for (const citation of citations) {
      const key = citation.chunkId || `${citation.title}-${citation.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({
          ...citation,
          index: unique.length + 1,
        });
      }
    }

    return unique.slice(0, maxCitations);
  }
}
