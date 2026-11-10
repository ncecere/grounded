/*
 * The chat's message box, with what depends on the text being typed: the
 * character count, Send, and Retry on an error that gave the question back.
 * The text is this component's own state, so a typed character renders the
 * composer and not the conversation above it (src/test/chat-renders.test.tsx).
 * The panel and the page reach it through a handle: send a starter, ask again
 * without touching what is being typed, clear the box for a new chat.
 */
import { RotateCcw } from "lucide-react";
import { type ReactNode, type Ref, type RefObject, useImperativeHandle, useState } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { ConversationAnnouncer } from "@/components/ui/conversation/conversation";
import { PromptInput, PromptInputSubmit, PromptInputTextarea, PromptInputToolbar, PromptInputTools } from "@/components/ui/prompt-input/prompt-input";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { cx } from "@/lib/bitop-utils";
import { progressAnnouncement } from "./progress";
import type { useChat } from "./useChat";
import a from "./answer.module.css";
import c from "./chat.module.css";
import pm from "./panel.module.css";

export const defaultMaxLength = 8000;

/** Characters (code points), as the server counts them: text.length counts UTF-16 units, so an emoji would count twice (#127). */
const charCount = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Errors worth a Retry: the question never left (offline). */
const retriable = new Set(["send_failed"]);

export type ComposerHandle = {
  /** Sends a question as if typed and sent: the box is emptied, and gets the question back if it was refused. */
  send: (message: string) => Promise<void>;
  /** Asks without touching what's being typed (Retry after a lost answer, a starter under a refusal). */
  ask: (question: string) => Promise<void>;
  /** Empties the box (a new chat). */
  clear: () => void;
};

type Props = {
  ref: Ref<ComposerHandle>;
  chat: ReturnType<typeof useChat>;
  agentName: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  composerId?: string;
  disabledReason?: string;
  errorExtra?: ReactNode;
  maxLength?: number;
  /** The id of the welcome that describes the box of an empty chat. */
  welcomeId?: string;
};

export function Composer({ ref: handle, chat, agentName, inputRef: ref, composerId, disabledReason, errorExtra, maxLength = defaultMaxLength, welcomeId }: Props) {
  const [text, setText] = useState("");
  const over = charCount(text) > maxLength;
  const describedBy = [over && "composer-count", welcomeId].filter(Boolean).join(" ") || undefined;

  const send = async (message: string) => {
    if (!message.trim() || over || chat.streaming || disabledReason) return;
    setText("");
    ref.current?.focus();
    const started = await chat.send(message);
    // Refused before it started: give the question back.
    if (!started) setText(message);
  };
  const ask = async (question: string) => {
    if (!question.trim() || chat.streaming || disabledReason) return;
    const started = await chat.send(question);
    if (!started && !ref.current?.value.trim()) setText(question);
  };
  // No dependencies: the handle always calls this render's send and ask (they read the chat's current state).
  useImperativeHandle(handle, () => ({ send, ask, clear: () => setText("") }));

  return (
    <>
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
      <VisuallyHidden role="status">{progressAnnouncement(chat.items, agentName)}</VisuallyHidden>
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
        className={cx(c.composer, pm.raised)}
      >
        <PromptInputTextarea
          ref={ref}
          id={composerId}
          value={text}
          aria-label={`Message ${agentName}`}
          placeholder={disabledReason ?? `Ask ${agentName}…`}
          disabled={Boolean(disabledReason)}
          aria-invalid={over || undefined}
          aria-describedby={describedBy}
          onChange={(e) => setText(e.target.value)}
        />
        <PromptInputToolbar>
          <PromptInputTools className={c.tools}>
            {/* The keyboard hint means nothing on a touch screen: hidden there (answer.module.css). */}
            <span className={cx(c.hint, !chat.streaming && a.keyHint)}>
              {chat.streaming ? "Answering… You can type your next question meanwhile." : "Enter to send, Shift+Enter for a new line."}
            </span>
            <span id="composer-count" className={c.count} data-over={over ? "" : undefined}>
              {charCount(text).toLocaleString()} / {maxLength.toLocaleString()}
              {over && " (too long)"}
            </span>
          </PromptInputTools>
          {/* While streaming the button is Stop: only disable it when sending is impossible. */}
          <PromptInputSubmit showLabel disabled={chat.streaming ? false : !text.trim() || over || Boolean(disabledReason)} />
        </PromptInputToolbar>
      </PromptInput>
    </>
  );
}
