/*
 * useChat: sends questions to a chat endpoint, streams the answer into the
 * message list, and handles Stop and errors. The chat page and the draft
 * test share it. The answer is complete at message_end (or citations_checked
 * when its citations are being checked): the composer is free then, while the
 * stream stays open for the follow-up suggestions (docs/follow-ups.md); the
 * next question, a reset or leaving closes it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { settlePartial } from "./answer-text";
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

/** Whether this event completes the answer (the stream may stay open for its suggestions only). */
const completes = (event: string, item: AssistantItem) =>
  event === "done" || event === "citations_checked" || (event === "message_end" && !item.citationsPending);

/** How an answer ended, for ConversationAnnouncer. Errors and moderation notices aren't answers: say so (F-10). */
function outcome(item: AssistantItem) {
  if (item.moderation) return `Not answered. ${item.moderation.notice}`;
  if (item.status === "error" && item.error) return `Error: ${chatErrorText(item.error.code, item.error.message).title}`;
  return "Answer ready";
}

const lostMessage = "The connection was lost before the answer finished. Retry to ask again.";

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
  /** A complete answer's stream, still open for its suggestions. */
  const tail = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const opts = useRef({ path, body, onConversation, onSettled });
  opts.current = { path, body, onConversation, onSettled };

  // Stop a running answer when the component unmounts.
  useEffect(
    () => () => {
      controller.current?.abort();
      tail.current?.abort();
    },
    [],
  );

  // Set in the same render as `streaming` turning false, so ConversationAnnouncer reads it on that transition.
  const announce = (text: string) => setAnnouncement(text);

  const update = (key: string, fn: (a: AssistantItem) => AssistantItem) =>
    setItems((list) => list.map((i) => (i.key === key && i.role === "assistant" ? fn(i) : i)));

  /** Sends a question. Resolves to false when it was refused before starting (the caller keeps the text). */
  const send = useCallback(async (message: string): Promise<boolean> => {
    const text = message.trim();
    if (!text || controller.current) return false;
    tail.current?.abort(); // the previous answer's suggestions are no longer wanted
    tail.current = null;
    const previous = itemsRef.current;
    const user: UserItem = { role: "user", key: newKey("u"), text };
    const pending = pendingAssistant();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setError(null);
    setItems([...previous, user, pending]);
    setStreaming(true);
    let sawEnd = false;
    let received = false; // any event: the question reached the server
    const started = Date.now();
    // A local mirror of the streamed message, so the outcome is known without waiting for a render.
    let local: AssistantItem = pending;
    const set = (next: AssistantItem) => {
      local = next;
      update(pending.key, () => next);
    };
    let released = false;
    /** The answer is complete: settle it and free the composer; the stream stays open for the suggestions. */
    const release = () => {
      released = true;
      const timed = { ...local, latencyMs: Date.now() - started };
      set(timed.status === "streaming" ? { ...timed, status: "done" } : timed);
      controller.current = null;
      tail.current = ctrl;
      announce(outcome(local));
      setStreaming(false);
      opts.current.onSettled?.();
    };
    try {
      await streamChat(opts.current.path, opts.current.body(text, previous), {
        signal: ctrl.signal,
        onEvent: (event, data) => {
          received = true;
          if (event === "conversation") {
            const id = (data as { conversationId?: string | null })?.conversationId;
            if (id) opts.current.onConversation?.(id);
            return;
          }
          if (event === "message_end" || event === "done" || event === "error") sawEnd = true;
          set(applyChatEvent(local, event, data));
          if (!released && completes(event, local)) release();
        },
      });
      if (released) return true;
      const timed = { ...local, latencyMs: Date.now() - started };
      if (timed.status !== "streaming") set(timed);
      else if (sawEnd) set({ ...timed, status: "done" });
      else set(settlePartial({ ...timed, status: "error", error: { code: "network_error", message: lostMessage } }));
      announce(outcome(local));
      return true;
    } catch (err) {
      // After the answer: the suggestions' wait was cut short (a new question, a reset or a lost connection).
      if (released) return true;
      if (isAbort(err)) {
        // No message_end after Stop: settle the partial answer's markers and citations here (M4).
        set(settlePartial({ ...local, status: "aborted", stopReason: "aborted" }));
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
      if (!received) {
        // Nothing arrived: the question wasn't sent (offline). It goes back in the composer, with Retry.
        const friendly = chatErrorText("send_failed");
        setItems(previous);
        setError({ code: "send_failed", ...friendly });
        announce(`Error: ${friendly.title}. ${friendly.message}`);
        return false;
      }
      set(settlePartial({ ...local, status: "error", error: { code: "network_error", message: lostMessage } }));
      announce("Error: the connection was lost mid-answer");
      return true;
    } finally {
      if (tail.current === ctrl) tail.current = null;
      if (!released) {
        controller.current = null;
        setStreaming(false);
        opts.current.onSettled?.();
      }
    }
  }, []);

  const stop = useCallback(() => controller.current?.abort(), []);

  /** Starts over (or shows another conversation's items). */
  const reset = useCallback((next: ChatItem[] = []) => {
    controller.current?.abort();
    tail.current?.abort();
    setItems(next);
    setError(null);
  }, []);

  const patch = useCallback((key: string, fn: (a: AssistantItem) => AssistantItem) => update(key, fn), []);

  return { items, streaming, error, setError, announcement, send, stop, reset, patch };
}
