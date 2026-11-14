import { AssistantAbout } from "../../components/assistant-about";
/*
 * The chat page (/a/$team/$agent and /a/id/$agentId), full width and full
 * height: the user's conversations with the agent in a panel on the left (a
 * sheet on narrow screens), and the thread with the composer pinned under it.
 * ?c=<id> opens a stored conversation; a new one gets its ID from the
 * stream's `conversation` event and the URL follows.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import { agentConversationsQuery, agentProfileQuery, conversationsKey } from "../../api/queries";
import { NotFoundState, isNotFound } from "../../components/not-found";
import { ConversationTranscript, conversationQuery } from "../conversations/transcript";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { IconButton } from "@/components/ui/button/button";
import { Sheet } from "@/components/ui/sheet/sheet";
import { preloadResponse } from "@/components/ui/response/response-lazy";
import { Loading } from "@/components/ui/spinner/spinner";
import { AgentInfo } from "./agent-info";
import { ConversationGone, ConversationList, ConversationMenu } from "./conversations";
import { useCanAddToEvaluations } from "../team/evaluations/queries";
import { type AnswerToAdd, answerToAdd } from "../team/evaluations/answer-to-add";
import { answerKey, useAddedAnswers } from "../team/evaluations/added";
import type { ComposerHandle } from "./composer";
import { ChatPanel } from "./panel";
import { needsEvaluation } from "./thread";
import { itemsFromConversation } from "./stream";
import { conversationParam, useConversationSync } from "./conversation-sync";
import { useChat } from "./useChat";
import { AgentAvatar } from "./welcome";
import a from "./agent-info.module.css";
import c from "./chat.module.css";
import pm from "./panel.module.css";

type Card = Schemas["AgentCard"];

/** Cited passages open through the person's own stored answers (docs/v0.4.0.md §5). */
const ownAnswers = { kind: "message" } as const;

const AddToEvaluationsDialog = lazy(() => import("../team/evaluations/add-to-evaluations").then((m) => ({ default: m.AddToEvaluationsDialog })));

export function ChatPage() {
  const { team, agent } = useParams({ from: "/app/a/$team/$agent" });
  const profile = useQuery(agentProfileQuery({ team, agent }));
  return <ProfileGate profile={profile} />;
}

export function ChatByIdPage() {
  const { agentId } = useParams({ from: "/app/a/id/$agentId" });
  const profile = useQuery(agentProfileQuery({ id: agentId }));
  return <ProfileGate profile={profile} />;
}

export function ChatByShortNamePage() {
  const { short } = useParams({ from: "/app/a/$short" });
  const profile = useQuery(agentProfileQuery({ short }));
  return <ProfileGate profile={profile} />;
}

function ProfileGate({ profile }: { profile: { isLoading: boolean; error: unknown; data?: Card } }) {
  const search = { c: conversationParam(useSearch({ strict: false })) };
  // A link to a conversation with a deleted agent: its transcript, read-only (G2).
  const lookUp = Boolean(search.c) && Boolean(profile.error);
  const stored = useQuery({ ...conversationQuery(search.c ?? ""), enabled: lookUp, retry: false });
  // A link to a conversation: its messages and the Markdown engine are asked for while the agent's profile loads, not
  // after it (the chat reads the conversation under the same key). Only then: a profile already here mounts the chat
  // at once, and the chat asks for it itself.
  const qc = useQueryClient();
  const early = useRef<string | undefined>(undefined);
  useEffect(() => preloadResponse(), []);
  useEffect(() => {
    if (!profile.isLoading || !search.c) return;
    early.current = search.c;
    void qc.prefetchQuery({ ...conversationQuery(search.c), retry: false });
  }, [profile.isLoading, search.c, qc]);
  if (profile.error && stored.data?.conversation.agentDeleted)
    return (
      <div className={c.unavailable}>
        <ConversationTranscript id={stored.data.conversation.id} />
      </div>
    );
  // Only this gate's own lookup counts: the query is shared with the chat's (same key), and reading its
  // fetch state while the chat loads the conversation unmounted the chat, which refetched on remount: a loop (US-01).
  if (profile.isLoading || (lookUp && stored.isLoading)) return <Loading label="Loading the agent…" />;
  if (profile.error || !profile.data)
    return (
      <div className={c.unavailable}>
        <NotFoundState what="chat" />
      </div>
    );
  return <AgentChat key={profile.data.id} card={profile.data} fetched={early} />;
}

/** `fetched`: the conversation the gate asked for while the profile loaded. */
function AgentChat({ card, fetched }: { card: Card; fetched: { current: string | undefined } }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const selected = conversationParam(useSearch({ strict: false }));
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composer = useRef<ComposerHandle | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // "Add to evaluations" on the person's own answers, for editors of the agent's team (docs/evaluations.md §1).
  const canAdd = useCanAddToEvaluations(card.teamSlug);
  const [adding, setAdding] = useState<AnswerToAdd | null>(null);
  const isAdded = useAddedAnswers();
  /** The conversation the next question continues. */
  const current = useRef<string | undefined>(selected);
  /** Conversations created in this page session: their items are already on screen. */
  const local = useRef(new Set<string>());
  // All the conversations, a page at a time (Load more in the list): it used to stop at the newest 50 (#124).
  const pages = useInfiniteQuery(agentConversationsQuery(card.id));
  const items = useMemo(() => pages.data?.pages.flatMap((p) => p.items) ?? [], [pages.data]);
  // The same objects while the list is: a streamed token re-renders this page, not the two conversation lists (#252).
  const conversations = useMemo(() => ({ isLoading: pages.isLoading, error: pages.error, data: { items } }), [pages.isLoading, pages.error, items]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const more = useMemo(() => ({ hasNextPage, isFetchingNextPage, fetchNextPage }), [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const disabledReason =
    card.status === "disabled_by_platform"
      ? "A platform admin turned this agent off. Your conversations are still here to read."
      : card.status !== "active"
        ? "The team that owns this agent turned it off. Your conversations are still here to read."
        : undefined;

  const refreshLists = useCallback(() => void qc.invalidateQueries({ queryKey: conversationsKey }), [qc]);
  const chat = useChat({
    path: `/v1/agents/${encodeURIComponent(card.teamSlug)}/${encodeURIComponent(card.slug)}/chat`,
    body: (message) => ({ message, conversationId: current.current, stream: true }),
    onConversation: (id) => {
      if (current.current === id) return;
      current.current = id;
      local.current.add(id);
      void navigate({ to: ".", search: { c: id }, replace: true });
      refreshLists();
    },
    onSettled: refreshLists,
  });

  // Opening a stored conversation (not one this page just created).
  const [early] = useState(() => fetched.current);
  // Taken once: another agent's chat mounted by the same gate later starts without it.
  useEffect(() => {
    fetched.current = undefined;
  }, [fetched]);
  const detail = useQuery({
    ...conversationQuery(selected ?? ""),
    enabled: Boolean(selected) && !local.current.has(selected!),
    retry: false,
    // The gate's request for this conversation is in flight or just answered (or refused: "isn't available"): it
    // isn't asked for twice. A conversation picked later is fetched as ever (these two are about mounting only).
    refetchOnMount: selected !== early,
    retryOnMount: selected !== early,
  });
  /** A link to a deleted or unknown conversation: say so once, and the next question starts a new one (US-01). */
  const gone = Boolean(selected) && isNotFound(detail.error);
  useConversationSync(gone ? undefined : selected, chat);
  const { reset, adopt } = chat;
  /** The conversation whose stored messages are on screen. */
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    current.current = gone ? undefined : selected;
    shown.current = undefined;
    if (selected && local.current.has(selected)) return;
    reset([]);
  }, [selected, gone, reset]);
  const streaming = useRef(chat.streaming);
  streaming.current = chat.streaming;
  useEffect(() => {
    if (!detail.data || detail.data.conversation.id !== selected) return;
    const stored = itemsFromConversation(detail.data.messages);
    if (shown.current !== selected) {
      shown.current = selected;
      reset(stored);
      return;
    }
    // A later copy (a background refetch) adds what another tab stored and never replaces the thread: reset would
    // abort an answer that is streaming (#252). While one streams, useConversationSync catches up when it ends.
    if (!streaming.current) adopt(stored);
  }, [detail.data, selected, reset, adopt]);

  // A new chat starts in the message box (US2-04): once, when the page opens, on a device with a keyboard, and only
  // if nothing else has focus. The box's description reads the agent's welcome, so a screen reader hears where it is.
  useEffect(() => {
    if (selected || disabledReason || window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const active = document.activeElement;
    if (!active || active === document.body) inputRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on opening the page only, not when a conversation starts
  }, []);

  const newChat = useCallback(() => {
    current.current = undefined;
    void navigate({ to: ".", search: {}, replace: false });
    reset([]);
    composer.current?.clear();
    setSheetOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [navigate, reset]);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const currentSummary = conversations.data?.items.find((x) => x.id === selected);
  // The same object while the card is: the answers are memoised on it (thread.tsx).
  const agentLook = useMemo(
    () => ({ name: card.name, accentColor: card.accentColor, welcomeMessage: card.welcomeMessage, starterQuestions: card.starterQuestions, description: card.description }),
    [card],
  );

  const list = { card, conversations, selected, onNew: newChat, more };

  return (
    <div className={c.page}>
      {/* After the shell's Skip to content: past the conversation list, straight to the box (US2-04). */}
      <a
        href="#chat-composer"
        className={pm.skipToComposer}
        onClick={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        Skip to message box
      </a>
      <ConversationList {...list} className={c.side} />

      <section className={c.main} aria-labelledby="chat-title">
        <header className={c.header}>
          <Sheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            side="left"
            size="sm"
            title="Conversations"
            description={`Your conversations with ${card.name}.`}
            // Not the navigation's icon: on a phone both buttons show, one above the other (US-18).
            trigger={<IconButton icon={<MessagesSquare aria-hidden />} label="Show conversations" className={c.sheetToggle} />}
          >
            <ConversationList {...list} onPick={closeSheet} className={c.sheetList} />
          </Sheet>
          <AgentAvatar agent={card} size="md" />
          <div className={c.headerText}>
            <h1 id="chat-title" className={c.title}>
              {card.name}
            </h1>
            <p className={c.subtitle}>
              <AgentInfo card={card} />
              {currentSummary?.title && <span className={a.subtitleConv} title={currentSummary.title}> · {currentSummary.title}</span>}
            </p>
          </div>
          <AssistantAbout about={card.about} />
          {currentSummary && <ConversationMenu conversation={currentSummary} onDeleted={newChat} label="Conversation actions" />}
        </header>
        <ChatPanel
          chat={chat}
          agent={agentLook}
          composer={composer}
          feedback
          fullPage
          viewer={ownAnswers}
          inputRef={inputRef}
          composerId="chat-composer"
          disabledReason={disabledReason}
          label={`Conversation with ${card.name}`}
          onAddToEvaluations={canAdd ? (question, item) => setAdding(answerToAdd(question, item)) : undefined}
          canAdd={needsEvaluation}
          added={(item) => isAdded(answerKey(item))}
          loading={selected && !local.current.has(selected) ? gone ? <ConversationGone onNew={newChat} /> : detail.error ? <ErrorAlert error={detail.error} title="Couldn't open this conversation" /> : detail.isLoading ? <Loading label="Loading the conversation…" /> : undefined : undefined}
        />
      </section>
      {adding && (
        <Suspense>
          <AddToEvaluationsDialog team={card.teamSlug} agentId={card.id} agentName={card.name} answer={adding} onClose={() => setAdding(null)} />
        </Suspense>
      )}
    </div>
  );
}
