/*
 * The chat surface shared by the chat page and the agent editor's draft
 * test: the scrolling conversation, a pre-start error, and the composer.
 * Focus: sending keeps focus in the textarea; Stop and the end of an answer
 * return it there. The message log stays silent while tokens stream; a
 * ConversationAnnouncer (polite status) says how each answer ended.
 */
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Conversation, ConversationAnnouncer, ConversationContent, ConversationScrollButton } from "@/components/ui/conversation/conversation";
import { PromptInput, PromptInputSubmit, PromptInputTextarea, PromptInputToolbar, PromptInputTools } from "@/components/ui/prompt-input/prompt-input";
import { preloadResponse } from "@/components/ui/response/response-lazy";
import { ChatMessages } from "./thread";
import type { useChat } from "./useChat";
import { type AgentLook, ChatWelcome } from "./welcome";
import c from "./chat.module.css";

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
};

export function ChatPanel({ chat, agent, text, onTextChange, feedback, disabledReason, errorExtra, loading, inputRef, label = "Conversation", fullPage, maxLength = defaultMaxLength }: ChatPanelProps) {
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

  return (
    <div className={fullPage ? c.pagePanel : c.panel}>
      <Conversation
        aria-label={label}
        className={fullPage ? c.pageConversation : c.conversation}
        viewportClassName={fullPage ? c.pageViewport : undefined}
        // The welcome starts at its top (the avatar in view, Q14); answers are followed.
        stickToBottom={chat.items.length > 0}
      >
        <ConversationContent className={c.content}>
          {chat.items.length === 0 ? (
            (loading ?? <ChatWelcome agent={agent} disabled={Boolean(disabledReason) || chat.streaming} onStarter={(q) => void send(q)} />)
          ) : (
            <ChatMessages items={chat.items} agent={agent} feedback={feedback} onPatch={chat.patch} />
          )}
        </ConversationContent>
        {chat.items.length > 0 && <ConversationScrollButton />}
      </Conversation>
      {disabledReason && (
        <Alert tone="warning" title="Chat is unavailable" className={c.errorBox}>
          {disabledReason}
        </Alert>
      )}
      {chat.error && (
        <Alert tone={chat.error.code === "rate_limited" || chat.error.code === "quota_exceeded" ? "warning" : "danger"} title={chat.error.title} onDismiss={() => chat.setError(null)} className={c.errorBox}>
          {chat.error.message}
          {errorExtra}
        </Alert>
      )}
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
            <span className={c.hint}>{chat.streaming ? "Answering… You can type your next question meanwhile." : "Enter to send, Shift+Enter for a new line."}</span>
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
