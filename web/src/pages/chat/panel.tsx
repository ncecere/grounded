/*
 * The chat surface shared by the chat page and the agent editor's draft
 * test: the scrolling conversation, a pre-start error, and the composer.
 * Focus: sending keeps focus in the textarea; Stop and the end of an answer
 * return it there. The message log stays silent while tokens stream; a
 * polite status says each step before the first words (progress.ts), and a
 * ConversationAnnouncer (polite status) says how each answer ended.
 */
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useMemo, useRef } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Conversation, ConversationContent, ConversationScrollButton, useConversation } from "@/components/ui/conversation/conversation";
import { preloadResponse } from "@/components/ui/response/response-lazy";
import { cx } from "@/lib/bitop-utils";
import { Composer, type ComposerHandle } from "./composer";
import { ChatMessages } from "./thread";
import type { ViewerAccess } from "./viewer/data";
import { ViewerHost } from "./viewer/host";
import type { AssistantItem } from "./stream";
import type { useChat } from "./useChat";
import { type AgentLook, ChatWelcome } from "./welcome";
import c from "./chat.module.css";
import pm from "./panel.module.css";
import { RevealBufferedAnswer } from "./reveal-answer";
import { ShowSuggestions } from "./show-suggestions";
import { rememberSuggestions, withRememberedSuggestions } from "./suggestion-memory";

type ChatPanelProps = {
  chat: ReturnType<typeof useChat>;
  agent: AgentLook;
  /** The message box's handle: the page clears it for a new chat. The text itself is the composer's own state. */
  composer?: RefObject<ComposerHandle | null>;
  /** Offer feedback on answers (stored conversations). */
  feedback?: boolean;
  /** Chat is impossible (e.g. the agent is disabled): why. */
  disabledReason?: string;
  /** Extra content for a pre-start error (e.g. links to fix the draft). */
  errorExtra?: ReactNode;
  /** Shown instead of the welcome while a stored conversation loads. */
  loading?: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** The message box's id (the chat page's "Skip to message box" link). */
  composerId?: string;
  label?: string;
  /** The chat page's layout: no frame, messages and composer in one centred reading column. */
  fullPage?: boolean;
  /** The longest question (public agents may allow less than 8,000 characters). */
  maxLength?: number;
  /** "Add to evaluations" on answers (see ChatMessages). */
  onAddToEvaluations?: (question: string, item: AssistantItem) => void;
  canAdd?: (item: AssistantItem) => boolean;
  added?: (item: AssistantItem) => boolean;
  /** Let the reader open the model's thinking (editors testing a draft); others see "Thinking…" only. */
  showThinking?: boolean;
  /** How the source viewer reads cited passages (docs/v0.4.0.md §5); without it, sources open under the answer only. */
  viewer?: ViewerAccess;
  /** The widget's small panel: a smaller welcome and less padding, so the starters show (US-16). */
  compact?: boolean;
};

/** Sending scrolls to your new message (and follows the answer), even after you scrolled up to read. */
function ScrollOnSend({ questions }: { questions: number }) {
  const { scrollToBottom } = useConversation();
  const seen = useRef(questions);
  useEffect(() => {
    if (questions > seen.current) scrollToBottom("smooth");
    seen.current = questions;
  }, [questions, scrollToBottom]);
  return null;
}

export function ChatPanel(props: ChatPanelProps) {
  const { chat, inputRef } = props;
  const local = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? local;
  const ownComposer = useRef<ComposerHandle | null>(null);
  const wasStreaming = useRef(false);
  // Fetch the Markdown engine while the user types the first question.
  useEffect(() => preloadResponse(), []);

  // When an answer ends (or is stopped), put focus back in the composer if it was on a chat control.
  useEffect(() => {
    if (wasStreaming.current && !chat.streaming) {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest("form")?.contains(ref.current)) ref.current?.focus();
    }
    wasStreaming.current = chat.streaming;
  }, [chat.streaming, ref]);

  return (
    <ViewerHost access={props.viewer} items={chat.items}>
      <ChatColumn {...props} composer={props.composer ?? ownComposer} inputRef={ref} />
    </ViewerHost>
  );
}

type ColumnProps = ChatPanelProps & {
  composer: RefObject<ComposerHandle | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

/** The conversation, its errors and the composer: one column, beside the source viewer when it is open. */
function ChatColumn(props: ColumnProps) {
  const { chat, agent, feedback, disabledReason, loading, inputRef: ref, composer, label = "Conversation", fullPage } = props;
  // An empty chat's message box is described by the agent's welcome (focused on opening a new chat, US2-04).
  const welcomeId = useId();
  const welcomed = chat.items.length === 0 && !loading;
  // Through the composer's handle, which holds the text: these two never change, so the answers aren't rendered again for them.
  const send = useCallback((q: string) => void composer.current?.send(q), [composer]);
  const ask = useCallback((q: string) => void composer.current?.ask(q), [composer]);
  // The last answer's follow-up suggestions survive a reload in this tab (US2-09).
  const items = useMemo(() => withRememberedSuggestions(chat.items), [chat.items]);
  useEffect(() => rememberSuggestions(chat.items), [chat.items]);
  return (
    <div className={cx(fullPage ? c.pagePanel : c.panel, props.compact && pm.compactPanel)}>
      <Conversation
        aria-label={label}
        className={fullPage ? c.pageConversation : c.conversation}
        viewportClassName={fullPage ? cx(c.pageViewport, pm.scrollShadows) : undefined}
        // The welcome starts at its top (the avatar in view, Q14); answers are followed.
        stickToBottom={chat.items.length > 0}
      >
        <ConversationContent className={c.content}>
          {chat.items.length === 0 ? (
            (loading ?? <ChatWelcome agent={agent} textId={welcomeId} compact={props.compact} disabled={Boolean(disabledReason) || chat.streaming} onStarter={send} />)
          ) : (
            <ChatMessages
              items={items}
              agent={agent}
              feedback={feedback}
              showThinking={props.showThinking}
              onPatch={chat.patch}
              onAddToEvaluations={props.onAddToEvaluations}
              canAdd={props.canAdd}
              added={props.added}
              onRetry={ask}
              onStarter={disabledReason ? undefined : ask}
            />
          )}
        </ConversationContent>
        <ScrollOnSend questions={chat.items.filter((i) => i.role === "user").length} />
        <RevealBufferedAnswer items={chat.items} />
        <ShowSuggestions items={items} />
        {chat.items.length > 0 && <ConversationScrollButton className={cx(pm.phoneScroll, props.compact && pm.compactScroll)} />}
      </Conversation>
      {disabledReason && (
        <Alert tone="warning" title="Chat is unavailable" className={c.errorBox}>
          {disabledReason}
        </Alert>
      )}
      <Composer
        ref={composer}
        chat={chat}
        agentName={agent.name}
        inputRef={ref}
        composerId={props.composerId}
        disabledReason={disabledReason}
        errorExtra={props.errorExtra}
        maxLength={props.maxLength}
        welcomeId={welcomed ? welcomeId : undefined}
      />
    </div>
  );
}
