/*
 * The chat stream: the POST that returns Server-Sent Events, the pure
 * reducer that folds events into an assistant message, and friendly text for
 * chat errors. Used by the chat page and the agent editor's draft test.
 *
 * Errors before the stream starts (policy, limits) are plain JSON responses
 * (spec §12 deviation 3); later ones are error events. status events say
 * what the agent is doing until the first token. text_delta is the raw model
 * text; message_end.text replaces it (deviation 4). With SystemOne citation
 * checks, citations_checked follows message_end and replaces the citations
 * (and, in enforce mode, the text) in place.
 */
import { ApiError, csrfHeader, type Schemas } from "../../api/client";
import { readSSE } from "../../lib/sse";

export type Citation = Schemas["Citation"];
export type UncitedSentence = Schemas["UncitedSentence"];
export type Claim = Schemas["Claim"];
export type RetrievalHit = Schemas["RetrievalHit"];
export type ChatUsage = Schemas["ChatUsage"];
export type StopReason = Schemas["StopReason"];
export type FeedbackRating = Schemas["FeedbackRating"];
export type FeedbackReason = Schemas["FeedbackReason"];
type ConversationMessage = Schemas["ConversationMessage"];

/** A step of the answer: the automatic retrieval (always mode), a search_knowledge call (tool mode) or an MCP tool's call. */
export type SearchStep = {
  /** The tool call ID (tool mode). */
  id?: string;
  kind: "retrieval" | "tool";
  /** Tool name for tool calls other than search_knowledge. */
  name?: string;
  query: string;
  /** An MCP tool's arguments, as the model sent them. */
  args?: unknown;
  hitCount?: number;
  isError?: boolean;
  /** Why the call failed or wasn't made (a sentence from the server). */
  error?: string;
  /** What an MCP tool returned (the start of it), or a note such as "The tool returned nothing." */
  result?: string;
  /** SystemOne passage judging of this search: candidates checked, passages used, dropped. */
  judging?: { judged: number; kept: number; dropped: number };
};

export type UserItem = { role: "user"; key: string; id?: string; text: string };

export type AssistantStatus = "streaming" | "done" | "aborted" | "error";

/** What the agent is doing before the answer's first words (status events). */
export type ChatStep = Schemas["ChatEventStatus"]["step"];
const chatSteps = new Set<string>(["rewriting", "searching", "checking", "answering"] satisfies ChatStep[]);

export type AssistantItem = {
  role: "assistant";
  key: string;
  /** The stored message ID (from message_start). */
  id?: string;
  text: string;
  thinking: string;
  steps: SearchStep[];
  /** Every source given to the model (retrieval events), numbered. */
  sources: RetrievalHit[];
  citations: Citation[];
  /** SystemOne citation checks: factual sentences without a citation (code point offsets in text). */
  uncited?: UncitedSentence[];
  /** SystemOne citation checks (v0.2.1 and later): the factual sentences with one verdict each; absent for older answers. */
  claims?: Claim[];
  status: AssistantStatus;
  /** The last status event's step (unknown steps are ignored). */
  step?: ChatStep;
  stopReason?: StopReason;
  refused?: boolean;
  noContext?: boolean;
  /** Why nothing was retrieved: judged_out, small_talk or out_of_scope (SystemOne). */
  noContextReason?: "judged_out" | "small_talk" | "out_of_scope";
  /** message_end arrived while the stream is still open: citations are being checked. */
  ended?: boolean;
  usage?: ChatUsage;
  latencyMs?: number;
  error?: { code: string; message: string };
  feedback?: { rating: FeedbackRating; reason?: FeedbackReason };
  /** Output moderation buffers the answer: nothing streams until it passes. */
  buffered?: boolean;
  /** Moderation replaced the answer with a notice (text is the notice). */
  moderation?: Moderation;
};

export type Moderation = { stage: "input" | "output"; action: "blocked" | "retracted" | "withheld" | "unavailable" | "support"; notice: string };

export type ChatItem = UserItem | AssistantItem;

let seq = 0;
export const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function pendingAssistant(): AssistantItem {
  return { role: "assistant", key: newKey("a"), text: "", thinking: "", steps: [], sources: [], citations: [], status: "streaming" };
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The query of a tool call's JSON arguments ({query}), or "". */
function toolQuery(args: unknown): string {
  if (typeof args === "string") {
    try {
      return toolQuery(JSON.parse(args));
    } catch {
      return "";
    }
  }
  return args && typeof args === "object" ? str((args as Json).query) : "";
}

/** A tool call's JSON arguments as an object (a JSON string is parsed). */
function toolArgs(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** The step of a tool call: a knowledge base search (its query) or an MCP tool (its arguments). */
function toolStep(id: string, name: string, args: unknown): SearchStep {
  if (name === "search_knowledge") return { kind: "tool", id, query: toolQuery(args) };
  return { kind: "tool", id, name, query: "", args: toolArgs(args) };
}

/** A tool result's outcome fields, when set. */
const outcomeOf = (d: { error?: unknown; result?: unknown }) => ({ error: str(d.error) || undefined, result: str(d.result) || undefined });

/** The judging counts of a retrieval event (absent when nothing was judged). */
function judgingOf(v: unknown): SearchStep["judging"] {
  if (!v || typeof v !== "object") return undefined;
  const j = v as Json;
  return { judged: Number(j.judged) || 0, kept: Number(j.kept) || 0, dropped: Number(j.dropped) || 0 };
}

/** The uncited sentences of an event (absent when citations weren't checked). */
const uncitedOf = (v: unknown) => (Array.isArray(v) && v.length ? (v as UncitedSentence[]) : undefined);
/** The claims of an event (absent when citations weren't checked). */
const claimsOf = (v: unknown) => (Array.isArray(v) && v.length ? (v as Claim[]) : undefined);

/** Folds one SSE event into the assistant message being streamed. */
export function applyChatEvent(item: AssistantItem, event: string, data: unknown): AssistantItem {
  const d = (data ?? {}) as Json;
  switch (event) {
    case "status":
      return chatSteps.has(str(d.step)) ? { ...item, step: str(d.step) as ChatStep } : item;
    case "message_start":
      return { ...item, id: str(d.messageId) || item.id, buffered: Boolean(d.buffered) };
    case "thinking_delta":
      return item.moderation ? item : { ...item, thinking: item.thinking + str(d.delta) };
    case "text_delta":
      return item.moderation ? item : { ...item, text: item.text + str(d.delta) };
    case "moderation": {
      // The notice replaces whatever streamed: text, thinking and citations are dropped.
      const moderation = { stage: str(d.stage) === "output" ? "output" : "input", action: str(d.action), notice: str(d.notice) } as Moderation;
      return { ...item, moderation, text: moderation.notice, thinking: "", citations: [], claims: undefined };
    }
    case "retrieval": {
      const hits = Array.isArray(d.hits) ? (d.hits as RetrievalHit[]) : [];
      const query = str(d.query);
      const known = new Set(item.sources.map((h) => h.n));
      const sources = [...item.sources, ...hits.filter((h) => !known.has(h.n))];
      const judging = judgingOf(d.judging);
      // Tool mode: the retrieval follows its tool call; always mode: a step of its own.
      const open = [...item.steps].reverse().find((s) => s.kind === "tool" && !s.name && s.hitCount === undefined && s.query === query);
      if (open) return { ...item, sources, steps: item.steps.map((s) => (s === open ? { ...s, hitCount: hits.length, judging } : s)) };
      if (item.steps.some((s) => s.kind === "tool")) return { ...item, sources };
      return { ...item, sources, steps: [...item.steps, { kind: "retrieval", query, hitCount: hits.length, judging }] };
    }
    case "tool_call":
      return { ...item, steps: [...item.steps, toolStep(str(d.id), str(d.name), d.arguments)] };
    case "tool_result":
      return {
        ...item,
        steps: item.steps.map((s) =>
          s.kind === "tool" && s.id === str(d.id) ? { ...s, hitCount: Number(d.hitCount) || 0, isError: Boolean(d.isError), ...outcomeOf(d) } : s,
        ),
      };
    case "message_end": {
      const stopReason = str(d.stopReason) as StopReason;
      return {
        ...item,
        id: str(d.messageId) || item.id,
        text: typeof d.text === "string" ? d.text : item.text,
        citations: item.moderation ? [] : Array.isArray(d.citations) ? (d.citations as Citation[]) : [],
        uncited: item.moderation ? undefined : uncitedOf(d.uncited),
        claims: item.moderation ? undefined : claimsOf(d.claims),
        stopReason,
        refused: Boolean(d.refused),
        noContext: Boolean(d.noContext),
        noContextReason: (str(d.noContextReason) || undefined) as AssistantItem["noContextReason"],
        ended: true,
        usage: d.usage as ChatUsage | undefined,
        status: stopReason === "aborted" ? "aborted" : item.status === "error" ? "error" : item.status,
      };
    }
    case "citations_checked":
      // SystemOne citation checks: verdicts on the citations; enforce may change the text or refuse.
      if (item.moderation) return item;
      return {
        ...item,
        text: typeof d.text === "string" ? d.text : item.text,
        citations: Array.isArray(d.citations) ? (d.citations as Citation[]) : item.citations,
        uncited: uncitedOf(d.uncited),
        claims: claimsOf(d.claims),
        refused: Boolean(d.refused) || item.refused,
      };
    case "error":
      return { ...item, status: "error", error: { code: str(d.code) || "internal", message: str(d.message) } };
    case "done":
      return item.status === "streaming" ? { ...item, status: "done" } : item;
    default:
      return item;
  }
}

/** Items for a stored conversation's messages. */
export function itemsFromConversation(messages: ConversationMessage[]): ChatItem[] {
  return messages.map((m): ChatItem => {
    if (m.role === "user") return { role: "user", key: m.id, id: m.id, text: m.text };
    const moderation = storedModeration(m);
    const status: AssistantStatus = m.stopReason === "aborted" ? "aborted" : m.errorCode && !moderation ? "error" : "done";
    return {
      role: "assistant",
      key: m.id,
      id: m.id,
      text: m.text,
      thinking: m.thinking ?? "",
      steps: storedSteps(m),
      sources: [],
      citations: m.citations ?? [],
      uncited: m.uncited,
      claims: m.claims,
      status,
      stopReason: m.stopReason,
      usage: m.usage,
      latencyMs: m.latencyMs,
      error: m.errorCode && !moderation ? { code: m.errorCode, message: "" } : undefined,
      feedback: m.feedback ? { rating: m.feedback, reason: m.feedbackReason } : undefined,
      moderation,
    };
  });
}

/** A stored answer's steps: the search before the model (always mode), then its tool calls. */
function storedSteps(m: ConversationMessage): SearchStep[] {
  const r = m.retrieval;
  const first: SearchStep[] = r ? [{ kind: "retrieval", query: r.query, hitCount: r.hitCount, judging: r.judging }] : [];
  const calls = (m.toolCalls ?? []).map((t): SearchStep => {
    const step = toolStep(t.id, t.name, t.arguments);
    return { ...step, query: t.query || step.query, hitCount: t.hitCount, isError: t.isError, ...outcomeOf(t) };
  });
  return [...first, ...calls];
}

/** A stored answer that moderation replaced with a notice. */
function storedModeration(m: ConversationMessage): Moderation | undefined {
  if (m.errorCode === "moderation_blocked") return { stage: "input", action: "blocked", notice: m.text };
  if (m.errorCode === "moderation_withheld") return { stage: "output", action: "withheld", notice: m.text };
  if (m.errorCode === "moderation_support") return { stage: "input", action: "support", notice: m.text };
  if (m.errorCode === "moderation_unavailable") return { stage: "input", action: "unavailable", notice: m.text };
  return undefined;
}

/** History for a stateless request (the draft test): earlier questions and final answers. */
export function historyOf(items: ChatItem[]): Schemas["ChatHistoryMessage"][] {
  // Moderated turns are left out: neither the question nor the notice is replayed.
  const moderated = new Set(items.flatMap((i, n) => (i.role === "assistant" && i.moderation ? [n, n - 1] : [])));
  return items
    .filter((_, n) => !moderated.has(n))
    .filter((i) => i.role === "user" || (i.status !== "streaming" && i.text.trim() !== ""))
    .map((i) => ({ role: i.role, content: i.text }))
    .slice(-50);
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const retry = Number(res.headers.get("Retry-After"));
  return new ApiError(
    res.status,
    body?.error?.code ?? `http_${res.status}`,
    body?.error?.message ?? `Request failed (${res.status})`,
    body?.error?.details,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

/**
 * POSTs a chat request and calls onEvent for each SSE event (JSON data
 * parsed). Throws an ApiError when the server answers with an error before
 * streaming, and the abort reason when `signal` aborts.
 */
export async function streamChat(path: string, body: unknown, opts: { signal?: AbortSignal; onEvent: (event: string, data: unknown) => void }) {
  const res = await globalThis.fetch(new URL(path, globalThis.location?.origin ?? "http://localhost").toString(), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...csrfHeader() },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new ApiError(0, "network_error", "The answer couldn't be read.");
  await readSSE(
    res.body,
    (m) => {
      let data: unknown = undefined;
      try {
        data = m.data ? JSON.parse(m.data) : undefined;
      } catch {
        data = m.data;
      }
      opts.onEvent(m.event, data);
    },
    opts.signal,
  );
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/** A title and message for chat errors, in plain language. */
export function chatErrorText(code: string, message = "", retryAfter?: number): { title: string; message: string } {
  switch (code) {
    case "agent_disabled":
    case "agent_disabled_by_platform":
      return { title: "This agent is turned off", message: message || "The team that owns it has disabled it. Try again later." };
    case "agent_policy_violation":
      return {
        title: "This agent can't answer right now",
        message: `Its settings no longer meet the data classification policy, so it was stopped before answering. Ask the team that owns it to review the agent. ${message}`.trim(),
      };
    case "model_unavailable":
      return { title: "The AI model is unavailable", message: "The agent's chat model didn't respond. Try again in a few minutes." };
    case "model_busy":
      return { title: "The AI model is busy", message: "Lots of people are asking questions right now. Try again in a moment." };
    case "rate_limited":
      return {
        title: "Too many questions at once",
        message: `${message || "You've sent a lot of questions in a short time."}${retryAfter ? ` Try again in ${retryAfter} s.` : ""}`,
      };
    case "budget_exhausted":
      return {
        title: "The team's monthly budget is used up",
        message: message || "Chat is paused until the budget resets at the start of next month, or a platform admin raises it.",
      };
    case "agent_unavailable":
      return { title: "This assistant is unavailable right now", message: message || "Please try again later." };
    case "quota_exceeded":
      return { title: "Daily limit reached", message: message || "The team's daily chat budget is used up. It resets at midnight UTC." };
    case "incomplete_answer":
      return { title: "The answer is incomplete", message: "The agent ran out of search steps before it could finish. Try asking a narrower question." };
    case "agent_invalid":
      return { title: "The draft can't be tested yet", message: message || "Fix the problems below first." };
    case "not_found":
    case "agent_not_found":
      return { title: "Agent not found", message: "It may have been deleted, or you don't have access to it." };
    case "network_error":
      return { title: "Connection lost", message: message || "Check your connection and try again." };
    case "send_failed":
      return { title: "Couldn't send your question", message: "Check your connection, then try again. Your question is still in the message box." };
    case "public_disabled":
      return { title: "Public chat is turned off", message: "This assistant isn't available to visitors right now. Try again later." };
    case "limits_unavailable":
      return { title: "The assistant can't take questions right now", message: "Try again in a moment." };
    case "session_expired":
    case "session_required":
      return { title: "Your chat session ended", message: "Send your question again to start a new chat." };
    case "message_too_long":
      return { title: "Your message is too long", message: message || "Shorten it and try again." };
    case "captcha_failed":
      return { title: "Verification failed", message: "Complete the verification again, then send your question." };
    case "invalid_publishable_key":
    case "origin_not_allowed":
      return { title: "This chat isn't set up for this site", message: message || "Ask the site's owner to check the widget settings." };
    default:
      return { title: "Something went wrong", message: message || "The answer couldn't be completed. Try again." };
  }
}

export const feedbackReasons: { value: FeedbackReason; label: string }[] = [
  { value: "incorrect", label: "Incorrect" },
  { value: "not_helpful", label: "Not helpful" },
  { value: "missing_sources", label: "Missing sources" },
  { value: "wrong_sources", label: "Wrong sources" },
  { value: "outdated", label: "Outdated" },
  { value: "harmful_or_unsafe", label: "Harmful or unsafe" },
  { value: "other", label: "Something else" },
];
