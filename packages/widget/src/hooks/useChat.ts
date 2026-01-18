import { useState, useCallback, useRef } from 'preact/hooks';
import type { ChatMessage, Citation, ReasoningStep } from '../types';

interface UseChatOptions {
  token: string;
  apiBase: string;
  endpointType?: 'widget' | 'chat-endpoint';
}

/**
 * SSE message types received from the chat stream.
 * Advanced RAG mode adds 'reasoning' events for step-by-step visibility.
 */
interface SSEMessage {
  type: 'text' | 'done' | 'error' | 'status' | 'sources' | 'reasoning';
  content?: string;
  message?: string;
  conversationId?: string;
  citations?: Citation[];
  sources?: Array<{ id: string; title: string; url: string; snippet: string; index: number }>;
  status?: 'searching' | 'generating';
  sourcesCount?: number;
  /** Reasoning step data (only present when type is 'reasoning') */
  step?: ReasoningStep;
}

export interface ChatStatus {
  status: 'idle' | 'searching' | 'generating' | 'streaming';
  message?: string;
  sourcesCount?: number;
}

export function useChat({ token, apiBase, endpointType = 'widget' }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<ChatStatus>({ status: 'idle' });
  const conversationIdRef = useRef<string | null>(
    typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(`grounded_conv_${token}`)
      : null
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingSourcesRef = useRef<Citation[] | null>(null);
  const pendingReasoningStepsRef = useRef<Map<string, ReasoningStep>>(new Map());

  const generateId = () => Math.random().toString(36).slice(2, 11);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading || isStreaming) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };

    const assistantMessageId = generateId();

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setIsStreaming(true);
    setError(null);
    setChatStatus({ status: 'searching', message: 'Searching knowledge base...' });
    pendingSourcesRef.current = null;
    pendingReasoningStepsRef.current.clear();

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const body: Record<string, string> = { message: content.trim() };
      if (conversationIdRef.current) {
        body.conversationId = conversationIdRef.current;
      }

      // Use different endpoints for widget vs published chat
      const endpoint = endpointType === 'chat-endpoint'
        ? `${apiBase}/api/v1/c/${token}/chat/stream`
        : `${apiBase}/api/v1/widget/${token}/chat/stream`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Request failed: ${response.status}`);
      }

      // Add empty assistant message that we'll stream into
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        timestamp: Date.now(),
      }]);

      setIsLoading(false);

      // Parse SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data: SSEMessage = JSON.parse(line.slice(6));

              if (data.type === 'status') {
                // Update chat status
                const mappedStatus = data.status === 'searching' ? 'searching'
                  : data.status === 'generating' ? 'generating'
                  : 'searching';
                  
                setChatStatus({
                  status: mappedStatus,
                  message: data.message,
                  sourcesCount: data.sourcesCount,
                });
              } else if (data.type === 'sources' && data.sources) {
                // Store sources to attach to message on done
                pendingSourcesRef.current = data.sources.map(s => ({
                  index: s.index,
                  title: s.title,
                  url: s.url,
                  snippet: s.snippet,
                }));
              } else if (data.type === 'reasoning' && data.step) {
                // Collect reasoning steps (deduplicate by ID, keeping latest status)
                pendingReasoningStepsRef.current.set(data.step.id, data.step);
              } else if (data.type === 'text' && data.content) {
                // First text chunk means we're now streaming
                if (!fullContent) {
                  setChatStatus({ status: 'streaming' });
                }
                fullContent += data.content;
                // Update message with streamed content
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: fullContent }
                    : msg
                ));
              } else if (data.type === 'done') {
                // Store conversation ID
                if (data.conversationId) {
                  conversationIdRef.current = data.conversationId;
                  try {
                    sessionStorage.setItem(`grounded_conv_${token}`, data.conversationId);
                  } catch {
                    // sessionStorage not available
                  }
                }
                // Copy citations and reasoning steps before clearing refs
                const citationsToSet = pendingSourcesRef.current ? [...pendingSourcesRef.current] : [];
                pendingSourcesRef.current = null;

                // Convert reasoning steps Map to array, preserving order
                const reasoningStepsToSet = Array.from(pendingReasoningStepsRef.current.values());
                pendingReasoningStepsRef.current.clear();

                // Finalize message with citations and reasoning steps
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        content: fullContent,
                        isStreaming: false,
                        citations: citationsToSet,
                        ...(reasoningStepsToSet.length > 0 && { reasoningSteps: reasoningStepsToSet }),
                      }
                    : msg
                ));
                setChatStatus({ status: 'idle' });
              } else if (data.type === 'error') {
                throw new Error(data.message || 'Stream error');
              }
            } catch (parseError) {
              // Skip invalid JSON lines
              console.warn('[Grounded Widget] Failed to parse SSE:', line);
            }
          }
        }
      }

    } catch (err) {
      // Clear pending refs on error
      pendingReasoningStepsRef.current.clear();

      if ((err as Error).name === 'AbortError') {
        // Request was aborted, don't show error
        setChatStatus({ status: 'idle' });
        return;
      }

      setChatStatus({ status: 'idle' });
      setError(err instanceof Error ? err.message : 'An error occurred');

      // Update or add error message
      setMessages(prev => {
        const hasAssistantMsg = prev.some(m => m.id === assistantMessageId);
        if (hasAssistantMsg) {
          return prev.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, content: 'Sorry, something went wrong. Please try again.', isStreaming: false }
              : msg
          );
        }
        return [...prev, {
          id: assistantMessageId,
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
          timestamp: Date.now(),
        }];
      });
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [token, apiBase, isLoading, isStreaming]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setIsLoading(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = null;
    pendingReasoningStepsRef.current.clear();
    try {
      sessionStorage.removeItem(`grounded_conv_${token}`);
    } catch {
      // sessionStorage not available
    }
  }, [token]);

  return {
    messages,
    isLoading,
    isStreaming,
    error,
    chatStatus,
    sendMessage,
    stopStreaming,
    clearMessages,
  };
}
