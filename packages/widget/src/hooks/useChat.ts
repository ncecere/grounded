import { useState, useCallback, useRef } from 'preact/hooks';
import type { ChatMessage, Citation } from '../types';

interface UseChatOptions {
  token: string;
  apiBase: string;
}

interface SSEMessage {
  type: 'text' | 'done' | 'error' | 'status';
  content?: string;
  message?: string;
  conversationId?: string;
  citations?: Citation[];
  status?: 'searching' | 'generating';
  sourcesCount?: number;
}

export interface ChatStatus {
  status: 'idle' | 'searching' | 'generating' | 'streaming';
  message?: string;
  sourcesCount?: number;
}

export function useChat({ token, apiBase }: UseChatOptions) {
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

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const body: Record<string, string> = { message: content.trim() };
      if (conversationIdRef.current) {
        body.conversationId = conversationIdRef.current;
      }

      const response = await fetch(`${apiBase}/api/v1/widget/${token}/chat/stream`, {
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
      let citations: Citation[] = [];

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
                setChatStatus({
                  status: data.status || 'searching',
                  message: data.message,
                  sourcesCount: data.sourcesCount,
                });
                // When generating starts, update the assistant message
                if (data.status === 'generating') {
                  setChatStatus({
                    status: 'generating',
                    message: data.message,
                    sourcesCount: data.sourcesCount,
                  });
                }
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
                citations = data.citations || [];
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

      // Finalize the message
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? { ...msg, content: fullContent, isStreaming: false, citations }
          : msg
      ));

    } catch (err) {
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
