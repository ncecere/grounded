/*
 * Two tabs on one conversation (#128): each tab only knew the messages it sent itself, until a reload. A tab now asks
 * for the stored conversation when it comes back into view and after each of its own answers, and adds the messages
 * another tab (or device) stored, in the server's order. Messages this tab already shows keep their on-screen state
 * (sources, suggestions still arriving, revealed text): only messages it has not seen are taken from the server.
 */
import { useCallback, useEffect, useRef } from "react";
import { api, unwrap } from "../../api/client";
import { type ChatItem, itemsFromConversation, type UserItem } from "./stream";

/**
 * The ?c= conversation as text. The router parses search values as JSON, so ?c=null arrived as null and the page
 * showed a blank new chat (#128); as text it is looked up and answered "This conversation isn't available."
 */
export function conversationParam(search: unknown): string | undefined {
  const c = (search as { c?: unknown } | undefined)?.c;
  if (c === undefined) return undefined;
  return typeof c === "string" ? c : JSON.stringify(c);
}

/**
 * The conversation as stored, keeping this tab's own items; null when the server has nothing this tab lacks.
 * Local answers are matched by their stored message ID, and each one's question by its position just before it.
 * Local items the server does not have (a question that never got a stored answer) stay at the end.
 */
export function mergeConversation(local: ChatItem[], server: ChatItem[]): ChatItem[] | null {
  const mine = new Map<string, ChatItem>();
  const questionOf = new Map<string, UserItem>();
  local.forEach((item, i) => {
    if (item.role !== "assistant" || !item.id) return;
    mine.set(item.id, item);
    const before = local[i - 1];
    if (before?.role === "user") questionOf.set(item.id, before);
  });
  const missing = server.some((item) => item.role === "assistant" && item.id && !mine.has(item.id));
  if (!missing) return null;
  const out: ChatItem[] = [];
  for (const item of server) {
    const own = item.role === "assistant" && item.id ? mine.get(item.id) : undefined;
    if (!own) {
      out.push(item);
      continue;
    }
    const question = questionOf.get(item.id!);
    if (question && out[out.length - 1]?.role === "user") out[out.length - 1] = question;
    out.push(own);
  }
  const used = new Set(out);
  // Never drop what the person sees: anything of this tab's that the server did not return goes last.
  local.forEach((item, i) => {
    if (used.has(item)) return;
    const next = local[i + 1];
    const paired = item.role === "user" && next?.role === "assistant" && next.id && used.has(next);
    if (!paired) out.push(item);
  });
  return out;
}

type Chat = { streaming: boolean; adopt: (stored: ChatItem[]) => void };

/**
 * Keeps the open conversation in step with what other tabs stored: when the page comes back into view, and once this
 * tab's own answer has finished (another tab may have asked meanwhile). Never while an answer streams in this tab; a
 * failed request changes nothing.
 */
export function useConversationSync(id: string | undefined, chat: Chat) {
  const state = useRef({ id, chat });
  state.current = { id, chat };
  const sync = useCallback(async () => {
    const target = state.current.id;
    if (!target || state.current.chat.streaming) return;
    let messages;
    try {
      messages = unwrap(await api.GET("/v1/conversations/{conversationId}", { params: { path: { conversationId: target } } })).messages;
    } catch {
      return;
    }
    const now = state.current;
    if (now.id !== target || now.chat.streaming) return;
    now.chat.adopt(itemsFromConversation(messages));
  }, []);
  // After this tab's own answer: streaming has just turned false in this render.
  const wasStreaming = useRef(chat.streaming);
  useEffect(() => {
    if (wasStreaming.current && !chat.streaming) void sync();
    wasStreaming.current = chat.streaming;
  }, [chat.streaming, sync]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [sync]);
  return sync;
}
