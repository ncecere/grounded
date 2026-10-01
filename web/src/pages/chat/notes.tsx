/*
 * The parts of an answer around its text: the search steps, status notes
 * (stopped, refused, errors, moderation notices) with a Retry or the agent's
 * starter questions, and the feedback buttons.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Ban, CircleStop, RotateCcw, Search, ThumbsDown, ThumbsUp, TriangleAlert, Wrench } from "lucide-react";
import { api, unwrap } from "../../api/client";
import { Alert } from "@/components/ui/alert/alert";
import { Button, IconButton } from "@/components/ui/button/button";
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuSeparator } from "@/components/ui/menu/menu";
import { MessageAction } from "@/components/ui/message/message";
import { Suggestion, Suggestions } from "@/components/ui/suggestion/suggestion";
import { toast } from "@/components/ui/toast/toast";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ui/tool/tool";
import { judgedSummary } from "@/lib/systemone";
import { type AssistantItem, type FeedbackRating, type FeedbackReason, type SearchStep, chatErrorText, feedbackReasons } from "./stream";
import a from "./answer.module.css";
import c from "./chat.module.css";

function stepTitle(step: SearchStep) {
  if (step.name) return `Used ${step.name}`;
  const q = step.query ? `“${step.query}”` : "the knowledge base";
  return step.kind === "retrieval" ? `Searched the knowledge base for ${q}` : `Searched: ${q}`;
}

/** A search's result in words: "5 results", or the judged counts. */
function searchSummary(s: SearchStep) {
  if (s.judging) return judgedSummary(s.judging);
  return s.hitCount === undefined ? undefined : s.hitCount === 1 ? "1 result" : `${s.hitCount} results`;
}

/** Why a step failed or wasn't made, as the server says it. */
const failure = (s: SearchStep) => (s.isError ? (s.error ?? (s.name ? "The call failed." : "The search failed.")) : undefined);

export function Steps({ item }: { item: AssistantItem }) {
  if (item.steps.length === 0) return null;
  return (
    <div className={c.steps}>
      {item.steps.map((s, i) => {
        const state = s.isError ? "error" : s.hitCount !== undefined ? "completed" : item.status === "streaming" ? "running" : "completed";
        // An MCP tool shows its arguments and what it returned; a search, its query and hit count.
        const tool = Boolean(s.name);
        const reason = failure(s);
        // A tool that reported an error sent its own message too.
        const error = reason && tool && s.result ? `${reason} Its message: ${s.result}` : reason;
        const result = tool ? s.result : searchSummary(s);
        const summary = reason ?? (tool ? (s.hitCount ? "1 source" : undefined) : result);
        return (
          <Tool key={s.id ?? i}>
            <ToolHeader
              className={a.step}
              name={s.name ?? (s.kind === "retrieval" ? "retrieve" : "search_knowledge")}
              icon={tool ? <Wrench /> : <Search />}
              title={stepTitle(s)}
              state={state}
              summary={summary}
            />
            <ToolContent>
              <ToolInput input={tool ? (s.args ?? {}) : { query: s.query }} />
              <ToolOutput output={result} errorText={error} />
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

/** What a refusal says about itself, then what else the agent can answer (its starter questions). */
const refusalNote = (item: AssistantItem) =>
  item.noContextReason === "out_of_scope" ? undefined : "The agent searched its sources and found nothing that answers this.";

type NotesProps = {
  item: AssistantItem;
  /** Ask again after the connection was lost mid-answer (the last answer only). */
  onRetry?: () => void;
  /** The agent's starter questions, offered under a refusal (the last answer only). */
  starters?: string[];
  onStarter?: (q: string) => void;
};

export function Notes({ item, onRetry, starters, onStarter }: NotesProps) {
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
    const lost = item.error.code === "network_error";
    return (
      <Alert
        tone="danger"
        title={lost ? "Connection lost mid-answer" : e.title}
        className={c.note}
        actions={lost && onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}><RotateCcw aria-hidden /> Retry</Button> : undefined}
      >
        {e.message}
      </Alert>
    );
  }
  const notes: { icon: typeof Ban; text: string; tone: "info" | "warning" }[] = [];
  if (item.status === "aborted") notes.push({ icon: CircleStop, text: "Stopped. This is a partial answer.", tone: "info" });
  const refusal = item.refused ? refusalNote(item) : undefined;
  if (refusal) notes.push({ icon: Ban, text: refusal, tone: "info" });
  else if (!item.refused && item.noContext && item.status === "done" && item.noContextReason !== "small_talk")
    notes.push({ icon: TriangleAlert, text: "No matching sources were found, so this answer isn't based on the knowledge base.", tone: "warning" });
  if (item.stopReason === "length") notes.push({ icon: TriangleAlert, text: "The answer reached the length limit and was cut off.", tone: "warning" });
  const offer = item.refused && item.status === "done" && onStarter ? (starters ?? []).map((q) => q.trim()).filter(Boolean) : [];
  if (notes.length === 0 && offer.length === 0) return null;
  return (
    <>
      {notes.length > 0 && (
        <ul className={c.notes}>
          {notes.map((n) => (
            <li key={n.text} className={c.statusNote} data-tone={n.tone}>
              <n.icon aria-hidden className={c.noteIcon} />
              {n.text}
            </li>
          ))}
        </ul>
      )}
      {offer.length > 0 && (
        <Suggestions label="You can ask" className={a.offer}>
          <span className={a.offerLabel}>You can ask:</span>
          {offer.map((q) => (
            <Suggestion key={q} suggestion={q} onSelect={onStarter} />
          ))}
        </Suggestions>
      )}
    </>
  );
}

export function Feedback({ item, onChange }: { item: AssistantItem; onChange: (f: AssistantItem["feedback"]) => void }) {
  const send = useMutation({
    mutationFn: async (body: { rating: FeedbackRating; reason?: FeedbackReason; share?: boolean }) =>
      unwrap(await api.POST("/v1/messages/{messageId}/feedback", { params: { path: { messageId: item.id! } }, body })),
    onSuccess: (res) => {
      onChange({ rating: res.rating, reason: res.reason, shared: res.shared });
      toast.success("Thanks for the feedback");
    },
    onError: (err) => toast.error("Couldn't save your feedback", err instanceof Error ? err.message : undefined),
  });
  const rating = item.feedback?.rating;
  // "Share this question with the team" (off by default; docs/gaps.md): ticked before choosing what was wrong.
  const [share, setShare] = useState(item.feedback?.shared === true);
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
        <MenuCheckboxItem checked={share} onCheckedChange={setShare}>
          Share this question with the team
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuGroup label="What was wrong?">
          {feedbackReasons.map((r) => (
            <MenuItem key={r.value} onClick={() => send.mutate({ rating: "down", reason: r.value, share })}>
              {r.label}
            </MenuItem>
          ))}
        </MenuGroup>
      </Menu>
    </>
  );
}
