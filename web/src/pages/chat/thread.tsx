/*
 * The Grounded chat thread: maps streamed/stored chat items onto bitop-ui's AI
 * elements (Message, Response, Reasoning, Tool, Sources, InlineCitation)
 * and adds Grounded behaviour: citation markers with their claim's verdict
 * whose card leads to the source card (sources numbered 1..n), "Uncited" marks (citations.tsx), the claims'
 * summary (claims.tsx), feedback through the API, status notes and friendly
 * errors (notes.tsx). The sources start collapsed; a chip opens them. Where the
 * chat has a source viewer (viewer/, docs/v0.4.0.md §5), a chip's "Show source
 * n" and a source card open the passage there; each card breaks down how the
 * source fared with the claims citing it ("Supports 3 claims · 1 not supported").
 *
 * The model's thinking is shown to editors testing a draft (showThinking);
 * everyone else sees "Thinking…" while the model thinks, never its reasoning.
 */
import { Check, ClipboardPlus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Message, MessageActions, MessageContent, MessageCopyAction } from "@/components/ui/message/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ui/reasoning/reasoning";
import { LazyResponse } from "@/components/ui/response/response-lazy";
import { Shimmer } from "@/components/ui/shimmer/shimmer";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ui/sources/sources";
import { verificationLabel } from "@/lib/systemone";
import { displayText, normalizePunctuation } from "./answer-text";
import { displayNumbers, jumpBelow, useAnswerMarkers, withUncited } from "./citations";
import { type Claim, ClaimSummary, SourceBreakdown, sourceBreakdown, uncitedOfClaims } from "./claims";
import { Feedback, Notes, Steps, isAnswer } from "./notes";
import { waitingText } from "./progress";
import { revealSource } from "./reveal";
import type { AssistantItem, ChatItem, Citation } from "./stream";
import { UserMessage } from "./user-message";
import { useSourceViewer } from "./viewer/data";
import { AgentAvatar, type AgentLook } from "./welcome";
import a from "./answer.module.css";
import c from "./chat.module.css";

export { normalizeMarkers } from "./answer-text";
export { isAnswer } from "./notes";

/** "p. 3", "pp. 3–4", or "". */
function pages(start?: number, end?: number) {
  if (!start) return "";
  return !end || end === start ? `p. ${start}` : `pp. ${start}–${end}`;
}

/** The id of an answer's source card (a chip, or the source viewer when it closes, focuses it). */
export const sourceElementId = (itemKey: string, n: number) => `${itemKey}-source-${n}`;
/** An MCP tool's result (docs/mcp-client.md) reads "From Service status · check_outage"; a passage by its document's title. */
export const sourceTitle = (s: Citation) => (s.kind === "tool" ? `From ${s.server ?? "a tool"} · ${s.tool ?? ""}` : s.title || "Untitled document");
const where = (s: Citation) =>
  s.kind === "tool"
    ? ["Tool result", s.truncated ? "cut to fit" : ""].filter(Boolean).join(" · ")
    : [s.headingPath.join(" › "), pages(s.pageStart, s.pageEnd)].filter(Boolean).join(" · ");
/** Snippets are raw chunk text: drop Markdown heading and emphasis marks for display. */
const plainSnippet = (t: string) => t.replace(/^#{1,6}\s+/gm, "").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/\s+/g, " ").trim();
const webUrl = (s: Citation) => (s.url && /^https?:\/\//.test(s.url) ? s.url : undefined);
/**
 * The source card's meta line, with the SystemOne citation check when there is one: with claims, the breakdown of
 * the claims citing it by this source's verdict (a chip's claim may be supported by another source); before claims,
 * its own verdict.
 */
const sourceMeta = (s: Citation, claims?: Claim[]) => {
  const parts = claims ? sourceBreakdown(claims, s.n) : undefined;
  if (parts) {
    return (
      <>
        {where(s)}
        <SourceBreakdown parts={parts} />
      </>
    );
  }
  const check = !claims && s.verification && s.verification !== "unchecked" ? verificationLabel(s.verification, s.confidence) : "";
  return [where(s), check].filter(Boolean).join(" · ") || undefined;
};
/** The chip card's action where the viewer opens passages: "Show source 2" (tools' results keep the jump below). */
const showSource = (s: Citation, shown: number) => (s.kind === "tool" ? jumpBelow(s, shown) : `Show source ${shown}`);
/** What a citation chip's card shows about its source. */
const chipSource = (s: Citation) => ({ title: sourceTitle(s), href: webUrl(s), siteName: where(s) || undefined, description: plainSnippet(s.snippet) });

type AssistantProps = {
  item: AssistantItem;
  agent: AgentLook;
  feedback: boolean;
  showThinking: boolean;
  onPatch?: ChatMessagesProps["onPatch"];
  onAdd?: () => void;
  added?: boolean;
  onRetry?: () => void;
  onStarter?: (q: string) => void;
};

function AssistantMessage({ item, agent, feedback, showThinking, onPatch, onAdd, added = false, onRetry, onStarter }: AssistantProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const streaming = item.status === "streaming";

  /** Opens the source list, then focuses the card and scrolls it into view (clear of the composer). */
  const goToSource = useCallback(
    (n: number) => {
      setSourcesOpen(true);
      void revealSource(sourceElementId(item.key, n));
    },
    [item.key],
  );
  const viewer = useSourceViewer();
  const viewable = (s: Citation) => Boolean(viewer) && s.kind !== "tool";
  /** The viewer for passages (the sources under the answer open too, so its card is there); a tool's result its card. */
  const openSource = useCallback(
    (n: number) => {
      const s = item.citations.find((x) => x.n === n);
      if (!viewer || !s || s.kind === "tool") return goToSource(n);
      setSourcesOpen(true);
      viewer.open({ item, n });
    },
    [viewer, item, goToSource],
  );
  // [n] markers: chips whose card (hover, click, Enter) shows the claim and offers the source; unknown numbers stay text.
  const markers = useAnswerMarkers(item.citations, openSource, chipSource, item.claims, viewer ? showSource : jumpBelow);
  const num = useMemo(() => displayNumbers(item.citations), [item.citations]);
  const thinking = Boolean(item.thinking) && !item.moderation;
  // Answers without sources already say so: no "Uncited" marks or claim summary for them.
  const uncited = item.noContext ? undefined : item.claims ? uncitedOfClaims(item.claims) : item.uncited;

  return (
    <Message from="assistant" label={`${agent.name} said`}>
      <AgentAvatar agent={agent} size="md" />
      <MessageContent>
        <Steps item={item} />
        {thinking && showThinking && (
          <Reasoning streaming={streaming && !item.text}>
            <ReasoningTrigger />
            <ReasoningContent>
              <p className={c.thinking}>{item.thinking}</p>
            </ReasoningContent>
          </Reasoning>
        )}
        {item.moderation ? null : streaming && !item.text ? (
          // While thinking, the editor's Reasoning trigger already shimmers "Thinking…". Buffered answers arrive whole.
          !(thinking && showThinking) && (
            <p className={c.waiting}>
              <Shimmer>{waitingText(item, thinking, agent.name)}</Shimmer>
            </p>
          )
        ) : (
          item.text && (
            // Answers quote team documents: never fetch image URLs from them.
            <LazyResponse streaming={streaming} images="alt" {...markers}>
              {displayText(withUncited(item.text, uncited), streaming)}
            </LazyResponse>
          )
        )}
        <Notes item={item} onRetry={onRetry} starters={agent.starterQuestions} onStarter={onStarter} />
        {streaming && item.ended && item.citations.length > 0 && (
          <p className={c.waiting}>
            <Shimmer>Checking the citations…</Shimmer>
          </p>
        )}
        {!item.noContext && !streaming && <ClaimSummary claims={item.claims} />}
        {item.citations.length > 0 && (
          <Sources open={sourcesOpen} onOpenChange={setSourcesOpen}>
            <SourcesTrigger count={item.citations.length} />
            <SourcesContent label="Sources for this answer">
              {item.citations.map((s) => (
                <Source
                  key={s.n}
                  id={sourceElementId(item.key, s.n)}
                  tabIndex={-1}
                  className={a.sourceCard}
                  aria-label={`Source ${num(s.n)}: ${sourceTitle(s)}`}
                  index={num(s.n)}
                  title={sourceTitle(s)}
                  href={webUrl(s)}
                  meta={sourceMeta(s, item.claims)}
                  description={plainSnippet(s.snippet)}
                  onSelect={viewable(s) ? () => openSource(s.n) : undefined}
                  selectLabel={viewable(s) ? `Show source ${num(s.n)}: ${sourceTitle(s)}` : undefined}
                  linkLabel="Open the page"
                />
              ))}
            </SourcesContent>
          </Sources>
        )}
      </MessageContent>
      {!streaming && isAnswer(item) && (
        <MessageActions label="Answer actions">
          <MessageCopyAction value={normalizePunctuation(item.text)} label="Copy answer" />
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
  /** Let the reader open the model's thinking (editors testing a draft). Others only see "Thinking…". */
  showThinking?: boolean;
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
  /** Ask a question again (the last answer, when the connection was lost mid-answer). */
  onRetry?: (question: string) => void;
  /** Ask one of the agent's starter questions (offered under the last answer when it's a refusal). */
  onStarter?: (question: string) => void;
};

/** An answer worth testing: rated down, or answered without sources (the chat page's rule). */
export const needsEvaluation = (item: AssistantItem) => item.feedback?.rating === "down" || item.noContext === true || item.citations.length === 0;

/** The messages of a chat; put them in <ConversationContent>. */
export function ChatMessages({ items, agent, feedback = false, showThinking = false, onPatch, onAddToEvaluations, canAdd, added, onRetry, onStarter }: ChatMessagesProps) {
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
  const lastKey = items[items.length - 1]?.key;
  return (
    <>
      {items.map((item) =>
        item.role === "user" ? (
          <UserMessage key={item.key} text={item.text} />
        ) : (
          <AssistantMessage
            key={item.key}
            item={item}
            agent={agent}
            feedback={feedback}
            showThinking={showThinking}
            onPatch={onPatch}
            onAdd={addFor(item)}
            added={added?.(item)}
            onRetry={item.key === lastKey && onRetry && asked.get(item.key) ? () => onRetry(asked.get(item.key)!) : undefined}
            onStarter={item.key === lastKey ? onStarter : undefined}
          />
        ),
      )}
    </>
  );
}
