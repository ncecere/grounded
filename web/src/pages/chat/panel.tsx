/*
 * The chat surface shared by the chat page and the agent editor's draft
 * test: the scrolling conversation, a pre-start error, and the composer.
 * Focus: sending keeps focus in the textarea; Stop and the end of an answer
 * return it there. The message log stays silent while tokens stream; a
 * polite status says each step before the first words (progress.ts), and a
 * ConversationAnnouncer (polite status) says how each answer ended.
 */
import { RotateCcw } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Conversation, ConversationAnnouncer, ConversationContent, ConversationScrollButton, useConversation } from "@/components/ui/conversation/conversation";
import { PromptInput, PromptInputSubmit, PromptInputTextarea, PromptInputToolbar, PromptInputTools } from "@/components/ui/prompt-input/prompt-input";
import { preloadResponse } from "@/components/ui/response/response-lazy";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { cx } from "@/lib/bitop-utils";
import { progressAnnouncement } from "./progress";
import { ChatMessages } from "./thread";
import type { ViewerAccess } from "./viewer/data";
import { ViewerHost } from "./viewer/host";
import type { AssistantItem } from "./stream";
import type { useChat } from "./useChat";
import { type AgentLook, ChatWelcome } from "./welcome";
import a from "./answer.module.css";
import c from "./chat.module.css";
import pm from "./panel.module.css";
import { RevealBufferedAnswer } from "./reveal-answer";
import { ShowSuggestions } from "./show-suggestions";

const defaultMaxLength = 8000;

type ChatPanelProps = {
  chat: ReturnType<typeof useChat>;
  agent: AgentLook;
  text: string;
  onTextChange: (text: string) => void;
  /** Offer feedback on answers (stored conversations). */
  feedback?: boolean;
  /** Chat is impossible (e.g. the agent is disabled): why. */
  disabledReason?: string;
  /** Extra content for a pre-start error (e.g. links to fix the draft). */
  errorExtra?: ReactNode;
  /** Shown instead of the welcome while a stored conversation loads. */
  loading?: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
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

/** Errors worth a Retry: the question never left (offline). */
const retriable = new Set(["send_failed"]);

export function ChatPanel(props: ChatPanelProps) {
  const { chat, text, onTextChange, disabledReason, inputRef, maxLength = defaultMaxLength } = props;
  const local = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? local;
  const over = text.length > maxLength;
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

  const send = async (message: string) => {
    if (!message.trim() || over || chat.streaming || disabledReason) return;
    onTextChange("");
    ref.current?.focus();
    const started = await chat.send(message);
    // Refused before it started: give the question back.
    if (!started) onTextChange(message);
  };
  /** Asks without touching what's being typed (Retry after a lost answer, a starter under a refusal). */
  const ask = async (question: string) => {
    if (!question.trim() || chat.streaming || disabledReason) return;
    const started = await chat.send(question);
    if (!started && !ref.current?.value.trim()) onTextChange(question);
  };

  return (
    <ViewerHost access={props.viewer} items={chat.items}>
      <ChatColumn {...props} send={send} ask={ask} over={over} inputRef={ref} />
    </ViewerHost>
  );
}

type ColumnProps = ChatPanelProps & {
  send: (message: string) => Promise<void>;
  ask: (question: string) => Promise<void>;
  over: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

/** The conversation, its errors and the composer: one column, beside the source viewer when it is open. */
function ChatColumn(props: ColumnProps) {
  const { chat, agent, text, onTextChange, feedback, disabledReason, errorExtra, loading, inputRef: ref, label = "Conversation", fullPage, send, ask, over } = props;
  const maxLength = props.maxLength ?? defaultMaxLength;
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
            (loading ?? <ChatWelcome agent={agent} compact={props.compact} disabled={Boolean(disabledReason) || chat.streaming} onStarter={(q) => void send(q)} />)
          ) : (
            <ChatMessages
              items={chat.items}
              agent={agent}
              feedback={feedback}
              showThinking={props.showThinking}
              onPatch={chat.patch}
              onAddToEvaluations={props.onAddToEvaluations}
              canAdd={props.canAdd}
              added={props.added}
              onRetry={(q) => void ask(q)}
              onStarter={disabledReason ? undefined : (q) => void ask(q)}
            />
          )}
        </ConversationContent>
        <ScrollOnSend questions={chat.items.filter((i) => i.role === "user").length} />
        <RevealBufferedAnswer items={chat.items} />
        <ShowSuggestions items={chat.items} />
        {chat.items.length > 0 && <ConversationScrollButton className={props.compact ? pm.compactScroll : undefined} />}
      </Conversation>
      {disabledReason && (
        <Alert tone="warning" title="Chat is unavailable" className={c.errorBox}>
          {disabledReason}
        </Alert>
      )}
      {chat.error && (
        <Alert
          tone={chat.error.code === "rate_limited" || chat.error.code === "quota_exceeded" || chat.error.code === "budget_exhausted" ? "warning" : "danger"}
          title={chat.error.title}
          onDismiss={() => chat.setError(null)}
          className={c.errorBox}
          actions={
            retriable.has(chat.error.code) && text.trim() ? (
              <Button size="sm" variant="secondary" disabled={chat.streaming} onClick={() => void send(text)}>
                <RotateCcw aria-hidden /> Retry
              </Button>
            ) : undefined
          }
        >
          {chat.error.message}
          {errorExtra}
        </Alert>
      )}
      {/* What the agent is doing until the first words, one polite announcement per step (the log itself is silent). */}
      <VisuallyHidden role="status">{progressAnnouncement(chat.items, agent.name)}</VisuallyHidden>
      <ConversationAnnouncer
        status={chat.streaming ? "streaming" : "ready"}
        // Silent while answering (the log isn't live either); the outcome comes from useChat.
        messages={{ submitted: "", streaming: "", complete: chat.announcement }}
      />
      <PromptInput
        onSubmit={({ text: t }) => void send(t)}
        status={chat.streaming ? "streaming" : "ready"}
        onStop={() => {
          chat.stop();
          ref.current?.focus();
        }}
        className={c.composer}
      >
        <PromptInputTextarea
          ref={ref}
          value={text}
          aria-label={`Message ${agent.name}`}
          placeholder={disabledReason ?? `Ask ${agent.name}…`}
          disabled={Boolean(disabledReason)}
          aria-invalid={over || undefined}
          aria-describedby={over ? "composer-count" : undefined}
          onChange={(e) => onTextChange(e.target.value)}
        />
        <PromptInputToolbar>
          <PromptInputTools className={c.tools}>
            {/* The keyboard hint means nothing on a touch screen: hidden there (answer.module.css). */}
            <span className={cx(c.hint, !chat.streaming && a.keyHint)}>
              {chat.streaming ? "Answering… You can type your next question meanwhile." : "Enter to send, Shift+Enter for a new line."}
            </span>
            <span id="composer-count" className={c.count} data-over={over ? "" : undefined}>
              {text.length.toLocaleString()} / {maxLength.toLocaleString()}
              {over && " (too long)"}
            </span>
          </PromptInputTools>
          {/* While streaming the button is Stop: only disable it when sending is impossible. */}
          <PromptInputSubmit showLabel disabled={chat.streaming ? false : !text.trim() || over || Boolean(disabledReason)} />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}
