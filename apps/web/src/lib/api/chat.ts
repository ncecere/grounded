import { API_BASE, request, getToken, getCurrentTenantId } from "./client";
import type { ChatMessage, ReasoningStep } from "./types/chat";

export const chatApi = {
  chat: async (
    agentId: string,
    message: string,
    conversationId?: string
  ): Promise<{ response: string; conversationId: string; citations: ChatMessage["citations"] }> => {
    return request(`/chat/${agentId}`, {
      method: "POST",
      body: JSON.stringify({ message, conversationId }),
    });
  },

  // Simple RAG Streaming Chat
  simpleChatStream: async (
    agentId: string,
    message: string,
    conversationId: string | undefined,
    onChunk: (text: string) => void,
    onSources: (sources: Array<{ id: string; title: string; url?: string; snippet: string; index: number }>) => void,
    onDone: (conversationId: string) => void,
    onError: (error: string) => void,
    onStatus?: (status: { status: string; message: string; sourceCount?: number }) => void
  ): Promise<void> => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    try {
      const response = await fetch(`${API_BASE}/chat/simple/${agentId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, conversationId }),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data) {
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "status" && onStatus) {
                  onStatus({
                    status: parsed.status,
                    message: parsed.message,
                    sourceCount: parsed.sourceCount,
                  });
                } else if (parsed.type === "text") {
                  onChunk(parsed.content);
                } else if (parsed.type === "sources") {
                  onSources(parsed.sources);
                } else if (parsed.type === "done") {
                  onDone(parsed.conversationId);
                } else if (parsed.type === "error") {
                  onError(parsed.message);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Stream failed");
    }
  },

  // Advanced RAG Streaming Chat (with reasoning steps)
  advancedChatStream: async (
    agentId: string,
    message: string,
    conversationId: string | undefined,
    onChunk: (text: string) => void,
    onSources: (sources: Array<{ id: string; title: string; url?: string; snippet: string; index: number }>) => void,
    onDone: (conversationId: string) => void,
    onError: (error: string) => void,
    onReasoning: (step: ReasoningStep) => void,
    onStatus?: (status: { status: string; message: string; sourceCount?: number }) => void
  ): Promise<void> => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    try {
      const response = await fetch(`${API_BASE}/chat/simple/${agentId}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, conversationId }),
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data) {
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "status" && onStatus) {
                  onStatus({
                    status: parsed.status,
                    message: parsed.message,
                    sourceCount: parsed.sourceCount,
                  });
                } else if (parsed.type === "reasoning") {
                  onReasoning(parsed.step);
                } else if (parsed.type === "text") {
                  onChunk(parsed.content);
                } else if (parsed.type === "sources") {
                  onSources(parsed.sources);
                } else if (parsed.type === "done") {
                  onDone(parsed.conversationId);
                } else if (parsed.type === "error") {
                  onError(parsed.message);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Stream failed");
    }
  },
};
