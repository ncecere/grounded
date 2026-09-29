/*
 * The Grounded chat thread: maps streamed/stored chat items onto bitop-ui's AI
 * elements (Message, Response, Reasoning, Tool, Sources, InlineCitation)
 * and adds Grounded behaviour: citation markers that focus the source card,
 * feedback through the API, status notes and friendly errors.
 */
import { useMutation } from "@tanstack/react-query";
import { Ban, Check, CircleStop, ClipboardPlus, Search, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { api, unwrap } from "../../api/client";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button, IconButton } from "@/components/ui/button/button";
import { InlineCitation } from "@/components/ui/inline-citation/inline-citation";
import { Menu, MenuGroup, MenuItem } from "@/components/ui/menu/menu";
import { Message, MessageAction, MessageActions, MessageContent, MessageCopyAction } from "@/components/ui/message/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ui/reasoning/reasoning";
import { LazyResponse } from "@/components/ui/response/response-lazy";
import { Shimmer } from "@/components/ui/shimmer/shimmer";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ui/sources/sources";
import { toast } from "@/components/ui/toast/toast";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ui/tool/tool";
import { judgedSummary, verificationLabel, worstVerification } from "@/lib/systemone";
import { type AssistantItem, type ChatItem, type Citation, type FeedbackRating, type FeedbackReason, type SearchStep, chatErrorText, feedbackReasons } from "./stream";
import { AgentAvatar, type AgentLook } from "./welcome";
import c from "./chat.module.css";

/** "p. 3", "pp. 3–4", or "". */
function pages(start?: number, end?: number) {
  if (!start) return "";
  return !end || end === start ? `p. ${start}` : `pp. ${start}–${end}`;
}

const sourceElementId = (itemKey: string, n: number) => `${itemKey}-source-${n}`;
const where = (s: Citation) => [s.headingPath.join(" › "), pages(s.pageStart, s.pageEnd)].filter(Boolean).join(" · ");
/** Snippets are raw chunk text: drop Markdown heading and emphasis marks for display. */
const plainSnippet = (t: string) => t.replace(/^#{1,6}\s+/gm, "").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/\s+/g, " ").trim();
const webUrl = (s: Citation) => (s.url && /^https?:\/\//.test(s.url) ? s.url : undefined);
/** The source card's meta line, with the SystemOne citation check when there is one. */
const sourceMeta = (s: Citation) =>
  [where(s), s.verification && s.verification !== "unchecked" ? verificationLabel(s.verification, s.confidence) : ""].filter(Boolean).join(" · ") || undefined;

function stepTitle(step: SearchStep) {
  if (step.name) return `Used ${step.name}`;
  const q = step.query ? `“${step.query}”` : "the knowledge base";
  return step.kind === "retrieval" ? `Searched the knowledge base for ${q}` : `Searched: ${q}`;
}

function Steps({ item }: { item: AssistantItem }) {
  if (item.steps.length === 0) return null;
  return (
    <div className={c.steps}>
      {item.steps.map((s, i) => {
        const state = s.isError ? "error" : s.hitCount !== undefined ? "completed" : item.status === "streaming" ? "running" : "completed";
        const results = s.judging ? judgedSummary(s.judging) : s.hitCount === undefined ? undefined : s.hitCount === 1 ? "1 result" : `${s.hitCount} results`;
        return (
          <Tool key={s.id ?? i}>
            <ToolHeader name={s.name ?? (s.kind === "retrieval" ? "retrieve" : "search_knowledge")} icon={<Search />} title={stepTitle(s)} state={state} summary={results} />
            <ToolContent>
              <ToolInput input={{ query: s.query }} />
              <ToolOutput output={results} errorText={s.isError ? "The search failed." : undefined} />
            </ToolContent>
          </Tool>
        );
      })}
    </div>
  );
}

type NoticeLook = { tone: "danger" | "warning" | "info"; title?: string };
const moderationLook: Partial<Record<string, NoticeLook>> = {
  unavailable: { tone: "danger", title: "Safety check unavailable" },
  blocked: { tone: "warning", title: "Not answered" },
  withheld: { tone: "warning", title: "Answer withheld" },
  retracted: { tone: "warning", title: "Answer removed" },
  support: { tone: "info" },
};

/** Moderation notices and errors aren't answers: no copy or rating buttons on them. */
export const isAnswer = (item: AssistantItem) => !item.moderation && item.status !== "error" && item.text.trim() !== "";

function Notes({ item }: { item: AssistantItem }) {
  if (item.moderation) {
    // The notice replaces the answer (or a retracted one). It isn't an answer: shown as an alert,
    // without copy or rating buttons, and announced as "Not answered" by useChat (F-10).
    const look: NoticeLook = moderationLook[item.moderation.action] ?? { tone: "warning", title: "Not answered" };
    return (
      <Alert tone={look.tone} title={look.title} className={c.note}>
        {item.moderation.notice}
      </Alert>
    );
  }
  if (item.status === "error" && item.error) {
    const e = chatErrorText(item.error.code, item.error.message);
    return (
      <Alert tone="danger" title={e.title} className={c.note}>
        {e.message}
      </Alert>
    );
  }
  const notes: { icon: typeof Ban; text: string; tone: "info" | "warning" }[] = [];
  if (item.status === "aborted") notes.push({ icon: CircleStop, text: "Stopped. This is a partial answer.", tone: "info" });
  if (item.refused && item.noContextReason === "out_of_scope")
    notes.push({ icon: Ban, text: "This question is outside what this agent covers, so it didn't search.", tone: "info" });
  else if (item.refused) notes.push({ icon: Ban, text: "No answer in the sources: the agent is set to answer only from them.", tone: "info" });
  else if (item.noContext && item.status === "done" && item.noContextReason !== "small_talk")
    notes.push({ icon: TriangleAlert, text: "No matching sources were found, so this answer isn't based on the knowledge base.", tone: "warning" });
  if (item.stopReason === "length") notes.push({ icon: TriangleAlert, text: "The answer reached the length limit and was cut off.", tone: "warning" });
  if (notes.length === 0) return null;
  return (
    <ul className={c.notes}>
      {notes.map((n) => (
        <li key={n.text} className={c.statusNote} data-tone={n.tone}>
          <n.icon aria-hidden className={c.noteIcon} />
          {n.text}
        </li>
      ))}
    </ul>
  );
}

function Feedback({ item, onChange }: { item: AssistantItem; onChange: (f: AssistantItem["feedback"]) => void }) {
  const send = useMutation({
    mutationFn: async (body: { rating: FeedbackRating; reason?: FeedbackReason }) =>
      unwrap(await api.POST("/v1/messages/{messageId}/feedback", { params: { path: { messageId: item.id! } }, body })),
    onSuccess: (res) => {
      onChange({ rating: res.rating, reason: res.reason });
      toast.success("Thanks for the feedback");
    },
    onError: (err) => toast.error("Couldn't save your feedback", err instanceof Error ? err.message : undefined),
  });
  const rating = item.feedback?.rating;
  const reason = feedbackReasons.find((r) => r.value === item.feedback?.reason)?.label;
  return (
    <>
      <MessageAction
        label="Good answer"
        pressed={rating === "up"}
        disabled={send.isPending}
        className={c.feedbackAction}
        onClick={() => rating !== "up" && send.mutate({ rating: "up" })}
      >
        <ThumbsUp aria-hidden />
      </MessageAction>
      <Menu
        side="top"
        trigger={
          // A menu trigger, so a plain IconButton (MessageAction adds a tooltip trigger of its own).
          <IconButton
            size="sm"
            icon={<ThumbsDown aria-hidden />}
            label={rating === "down" ? `Bad answer${reason ? `: ${reason}` : ""}` : "Bad answer"}
            aria-pressed={rating === "down"}
            data-pressed={rating === "down" ? "" : undefined}
            disabled={send.isPending}
            className={c.feedbackAction}
          />
        }
      >
        <MenuGroup label="What was wrong?">
          {feedbackReasons.map((r) => (
            <MenuItem key={r.value} onClick={() => send.mutate({ rating: "down", reason: r.value })}>
              {r.label}
            </MenuItem>
          ))}
        </MenuGroup>
      </Menu>
    </>
  );
}

type AssistantProps = { item: AssistantItem; agent: AgentLook; feedback: boolean; onPatch?: ChatMessagesProps["onPatch"]; onAdd?: () => void; added?: boolean };

function AssistantMessage({ item, agent, feedback, onPatch, onAdd, added = false }: AssistantProps) {
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const streaming = item.status === "streaming";
  const byN = new Map(item.citations.map((s) => [s.n, s]));

  /** Opens the source list, then scrolls to and focuses the card. */
  const goToSource = useCallback(
    (n: number) => {
      setSourcesOpen(true);
      setTimeout(() => {
        const el = document.getElementById(sourceElementId(item.key, n));
        if (!el) return;
        const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
        el.setAttribute("data-highlighted", "");
        setTimeout(() => el.removeAttribute("data-highlighted"), 1500);
      }, 30);
    },
    [item.key],
  );

  /** [n] and [n, m] markers: chips that preview on hover and jump to the source card on press. Unknown numbers stay text. */
  const renderCitation = (indices: number[]) => {
    const cited = indices.map((n) => byN.get(n));
    if (cited.some((s) => !s)) return undefined;
    // SystemOne citation checks: the worst verdict of the cited sources marks the chip.
    const verification = worstVerification(cited.map((s) => s!.verification));
    const deciding = cited.find((s) => s!.verification === verification);
    return (
      <InlineCitation
        index={indices}
        verification={verification}
        verificationLabel={verification ? verificationLabel(verification, deciding?.confidence) : undefined}
        sources={cited.map((s) => ({
          title: s!.title || "Untitled document",
          href: webUrl(s!),
          siteName: where(s!) || undefined,
          description: plainSnippet(s!.snippet),
        }))}
        onActivate={() => goToSource(indices[0]!)}
      />
    );
  };

  return (
    <Message from="assistant" label={`${agent.name} said`}>
      <AgentAvatar agent={agent} size="md" />
      <MessageContent>
        <Steps item={item} />
        {item.thinking && !item.moderation && (
          <Reasoning streaming={streaming && !item.text}>
            <ReasoningTrigger />
            <ReasoningContent>
              <p className={c.thinking}>{item.thinking}</p>
            </ReasoningContent>
          </Reasoning>
        )}
        {item.moderation ? null : streaming && !item.text ? (
          // While thinking, the Reasoning trigger already shimmers "Thinking…". Buffered answers arrive whole.
          !item.thinking && (
            <p className={c.waiting}>
              <Shimmer>{item.buffered ? "Thinking…" : item.steps.length > 0 ? "Reading the sources…" : "Working on it…"}</Shimmer>
            </p>
          )
        ) : (
          item.text && (
            // Answers quote team documents: never fetch image URLs from them.
            <LazyResponse streaming={streaming} renderCitation={renderCitation} images="alt">
              {streaming ? normalizeMarkers(item.text) : item.text}
            </LazyResponse>
          )
        )}
        <Notes item={item} />
        {streaming && item.ended && item.citations.length > 0 && (
          <p className={c.waiting}>
            <Shimmer>Checking the citations…</Shimmer>
          </p>
        )}
        {item.citations.length > 0 && (
          <Sources open={sourcesOpen} onOpenChange={setSourcesOpen}>
            <SourcesTrigger count={item.citations.length} />
            <SourcesContent label="Sources for this answer">
              {item.citations.map((s) => (
                <Source
                  key={s.n}
                  id={sourceElementId(item.key, s.n)}
                  tabIndex={-1}
                  aria-label={`Source ${s.n}: ${s.title || "Untitled document"}`}
                  index={s.n}
                  title={s.title || "Untitled document"}
                  href={webUrl(s)}
                  meta={sourceMeta(s)}
                  description={plainSnippet(s.snippet)}
                />
              ))}
            </SourcesContent>
          </Sources>
        )}
      </MessageContent>
      {!streaming && isAnswer(item) && (
        <MessageActions label="Answer actions">
          <MessageCopyAction value={item.text} label="Copy answer" />
          {feedback && item.id && <Feedback item={item} onChange={(f) => onPatch?.(item.key, (a) => ({ ...a, feedback: f }))} />}
          {/* A labelled button, and "Added" once added (remembered across reloads; docs/evaluations.md §1). */}
          {onAdd &&
            (added ? (
              <Badge tone="success">
                <Check aria-hidden /> Added to evaluations
              </Badge>
            ) : (
              <Button variant="ghost" size="sm" onClick={onAdd}>
                <ClipboardPlus aria-hidden /> Add to evaluations
              </Button>
            ))}
        </MessageActions>
      )}
    </Message>
  );
}

type ChatMessagesProps = {
  items: ChatItem[];
  agent: AgentLook;
  /** Offer thumbs up/down (stored conversations only). */
  feedback?: boolean;
  onPatch?: (key: string, fn: (a: AssistantItem) => AssistantItem) => void;
  /**
   * "Add to evaluations" with the question an answer replied to and the
   * answer (for its citations and rating), on the answers `canAdd` accepts
   * (docs/evaluations.md §1).
   */
  onAddToEvaluations?: (question: string, item: AssistantItem) => void;
  canAdd?: (item: AssistantItem) => boolean;
  /** Answers already added: "Added to evaluations". */
  added?: (item: AssistantItem) => boolean;
};

/** An answer worth testing: rated down, or answered without sources (the chat page's rule). */
export const needsEvaluation = (item: AssistantItem) => item.feedback?.rating === "down" || item.noContext === true || item.citations.length === 0;

/** The messages of a chat; put them in <ConversationContent>. */

/**
 * While an answer streams, show the citation markers some models write in
 * full-width or lenticular brackets (［1］, 【1】, 【1†L10-L12】) as [1], as the
 * server does for the finished answer (internal/agents/citations.go), so
 * they're chips from the start rather than raw text.
 */
export function normalizeMarkers(text: string) {
  return text.replace(/(?:［|【)(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)(?:†[^】］]*)?(?:］|】)/g, (_m, nums: string, at: number, all: string) => {
    // Right after a word ("online【2】") it gets a space, or it would read as part of an identifier.
    const space = at > 0 && /[\p{L}\p{N}_]/u.test(all[at - 1]!) ? " " : "";
    return `${space}[${nums.replace(/，/g, ",")}]`;
  });
}
export function ChatMessages({ items, agent, feedback = false, onPatch, onAddToEvaluations, canAdd, added }: ChatMessagesProps) {
  // The question each answer replied to: the user message before it.
  const asked = new Map<string, string>();
  let last = "";
  for (const item of items) {
    if (item.role === "user") last = item.text;
    else asked.set(item.key, last);
  }
  const addFor = (item: AssistantItem) => {
    const q = asked.get(item.key);
    return onAddToEvaluations && q && (!canAdd || canAdd(item)) ? () => onAddToEvaluations(q, item) : undefined;
  };
  return (
    <>
      {items.map((item) =>
        item.role === "user" ? (
          <Message key={item.key} from="user">
            <MessageContent className={c.userText}>{item.text}</MessageContent>
          </Message>
        ) : (
          <AssistantMessage key={item.key} item={item} agent={agent} feedback={feedback} onPatch={onPatch} onAdd={addFor(item)} added={added?.(item)} />
        ),
      )}
    </>
  );
}
