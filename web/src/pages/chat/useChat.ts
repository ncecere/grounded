/*
 * useChat: sends questions to a chat endpoint, streams the answer into the
 * message list, and handles Stop and errors. The chat page and the draft
 * test share it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  type AssistantItem,
  type ChatItem,
  type UserItem,
  applyChatEvent,
  chatErrorText,
  isAbort,
  newKey,
  pendingAssistant,
  streamChat,
} from "./stream";

type ChatError = { code: string; title: string; message: string; details?: Record<string, unknown> };

type UseChatOptions = {
  /** The endpoint path, e.g. /v1/agents/{team}/{agent}/chat. */
  path: string;
  /** The request body for a new question, given the items before it. */
  body: (message: string, previous: ChatItem[]) => unknown;
  /** The server created or continued a conversation. */
  onConversation?: (conversationId: string) => void;
  /** The answer finished (successfully or not). */
  onSettled?: () => void;
};

export function useChat({ path, body, onConversation, onSettled }: UseChatOptions) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  /** An error that stopped a question before it started (the question was not kept). */
  const [error, setError] = useState<ChatError | null>(null);
  /** How the last answer ended, for ConversationAnnouncer: "Answer ready", "Stopped…", or an error. */
  const [announcement, setAnnouncement] = useState("");
  const controller = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const opts = useRef({ path, body, onConversation, onSettled });
  opts.current = { path, body, onConversation, onSettled };

  // Stop a running answer when the component unmounts.
  useEffect(() => () => controller.current?.abort(), []);

  // Set in the same render as `streaming` turning false, so ConversationAnnouncer reads it on that transition.
  const announce = (text: string) => setAnnouncement(text);

  const update = (key: string, fn: (a: AssistantItem) => AssistantItem) =>
    setItems((list) => list.map((i) => (i.key === key && i.role === "assistant" ? fn(i) : i)));

  /** Sends a question. Resolves to false when it was refused before starting (the caller keeps the text). */
  const send = useCallback(async (message: string): Promise<boolean> => {
    const text = message.trim();
    if (!text || controller.current) return false;
    const previous = itemsRef.current;
    const user: UserItem = { role: "user", key: newKey("u"), text };
    const pending = pendingAssistant();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setError(null);
    setItems([...previous, user, pending]);
    setStreaming(true);
    let sawEnd = false;
    const started = Date.now();
    // A local mirror of the streamed message, so the outcome is known without waiting for a render.
    let local: AssistantItem = pending;
    const set = (next: AssistantItem) => {
      local = next;
      update(pending.key, () => next);
    };
    try {
      await streamChat(opts.current.path, opts.current.body(text, previous), {
        signal: ctrl.signal,
        onEvent: (event, data) => {
          if (event === "conversation") {
            const id = (data as { conversationId?: string | null })?.conversationId;
            if (id) opts.current.onConversation?.(id);
            return;
          }
          if (event === "message_end" || event === "done" || event === "error") sawEnd = true;
          set(applyChatEvent(local, event, data));
        },
      });
      const timed = { ...local, latencyMs: Date.now() - started };
      if (timed.status !== "streaming") set(timed);
      else if (sawEnd) set({ ...timed, status: "done" });
      else set({ ...timed, status: "error", error: { code: "network_error", message: "The connection closed before the answer finished." } });
      // Errors and moderation notices aren't answers: say so (F-10).
      if (local.moderation) announce(`Not answered. ${local.moderation.notice}`);
      else if (local.status === "error" && local.error) announce(`Error: ${chatErrorText(local.error.code, local.error.message).title}`);
      else announce("Answer ready");
      return true;
    } catch (err) {
      if (isAbort(err)) {
        set({ ...local, status: "aborted", stopReason: "aborted" });
        announce("Stopped. The partial answer is kept.");
        return true;
      }
      if (err instanceof ApiError) {
        const friendly = chatErrorText(err.code, err.message, err.retryAfter);
        const conversationId = typeof err.details?.conversationId === "string" ? err.details.conversationId : undefined;
        if ((err.code === "model_unavailable" || err.code === "model_busy") && conversationId) {
          // The question was stored with a failed answer: show it in the conversation.
          set({ ...local, status: "error", error: { code: err.code, message: err.message } });
          opts.current.onConversation?.(conversationId);
          announce(`Error: ${friendly.title}`);
          return true;
        }
        setItems(previous);
        setError({ code: err.code, ...friendly, details: err.details });
        announce(`Error: ${friendly.title}. ${friendly.message}`);
        return false;
      }
      set({ ...local, status: "error", error: { code: "network_error", message: "The connection was lost before the answer finished." } });
      announce("Error: connection lost");
      return true;
    } finally {
      controller.current = null;
      setStreaming(false);
      opts.current.onSettled?.();
    }
  }, []);

  const stop = useCallback(() => controller.current?.abort(), []);

  /** Starts over (or shows another conversation's items). */
  const reset = useCallback((next: ChatItem[] = []) => {
    controller.current?.abort();
    setItems(next);
    setError(null);
  }, []);

  const patch = useCallback((key: string, fn: (a: AssistantItem) => AssistantItem) => update(key, fn), []);

  return { items, streaming, error, setError, announcement, send, stop, reset, patch };
}
