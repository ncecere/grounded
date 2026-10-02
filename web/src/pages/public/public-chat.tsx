/*
 * The anonymous chat with a public agent, shared by the public page (/a/…)
 * and the widget's embed page. The session starts with the first question
 * (after CAPTCHA, when the platform uses it); an existing session's current
 * conversation is restored. "New chat" starts another conversation in the
 * same session; there is no history across sessions (docs/phase4-publishing.md §5).
 * On the public page the chat header is the page's only bar (W12): the
 * instance mark, the agent, New chat (once there is a conversation) and
 * Sign in.
 * On the public page the chat header is the page's only bar (W12): the
 * instance mark, the agent, New chat (once there is a conversation) and
 * Sign in.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SquarePen } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, setPublicChannel } from "../../api/client";
import { Button } from "@/components/ui/button/button";
import { Loading } from "@/components/ui/spinner/spinner";
import { ChatPanel } from "../chat/panel";
import { itemsFromConversation } from "../chat/stream";
import { useChat } from "../chat/useChat";
import { AgentAvatar } from "../chat/welcome";
import { Turnstile } from "./captcha";
import { type PublicAgent, embeddingOrigin, publicSessionQuery, startSession } from "./session";
import c from "../chat/chat.module.css";
import p from "./public.module.css";

type Props = {
  agent: PublicAgent;
  /** The widget's publishable key (the embed page); absent on the public page. */
  widgetKey?: string;
  /** The embed page: a compact header. */
  compact?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** The public page: the instance's mark at the start of the one header bar (W12). */
  brand?: ReactNode;
  /** The public page: actions at the end of the header bar, e.g. Sign in. */
  actions?: ReactNode;
};

const sessionEnded = (code?: string) => code === "session_expired" || code === "session_required";

export function PublicChat({ agent, widgetKey, compact, inputRef, brand, actions }: Props) {
  const qc = useQueryClient();
  // The widget uses its own session (its cookie, started with its key), never the public page's, and the other way
  // round: set before the first request.
  useState(() => setPublicChannel(widgetKey ? "widget" : "public"));
  const session = useQuery(publicSessionQuery(agent.id, widgetKey));
  const [hasSession, setHasSession] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [text, setText] = useState("");
  const local = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? local;
  const newConversation = useRef(false);
  const chat = useChat({
    path: `/v1/public/agents/${agent.id}/chat`,
    body: (message) => {
      const body = { message, stream: true, newConversation: newConversation.current || undefined };
      newConversation.current = false;
      return body;
    },
  });
  const { reset } = chat;
  // Cited passages of the session's own answers (docs/v0.4.0.md §5).
  const viewer = useMemo(() => ({ kind: "public" as const, agentId: agent.id }), [agent.id]);

  // Restore the session's current conversation once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || session.data === undefined) return;
    restored.current = true;
    if (session.data) {
      setHasSession(true);
      if (session.data.conversation) reset(itemsFromConversation(session.data.conversation.messages));
    }
  }, [session.data, reset]);
  // An ended session is replaced on the next question.
  useEffect(() => {
    if (sessionEnded(chat.error?.code)) setHasSession(false);
  }, [chat.error]);

  const needsCaptcha = agent.captcha.provider === "turnstile" && !hasSession;
  const ensureSession = async () => {
    if (hasSession) return;
    await startSession({ agentId: agent.id, captchaToken: captchaToken || undefined, key: widgetKey, embedOrigin: widgetKey ? embeddingOrigin() || undefined : undefined });
    setHasSession(true);
    void qc.invalidateQueries({ queryKey: ["public-session", agent.id] });
  };
  const send = async (message: string) => {
    try {
      await ensureSession();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, "network_error", "The chat couldn't start.");
      chat.setError({ code: e.code, title: "The chat couldn't start", message: e.message, details: e.details });
      return false;
    }
    return chat.send(message);
  };
  const newChat = () => {
    newConversation.current = true;
    reset([]);
    setText("");
    setTimeout(() => ref.current?.focus(), 0);
  };

  const disabledReason =
    agent.status !== "active" ? "This assistant has been turned off." : needsCaptcha && !captchaToken ? "Complete the verification below to start." : undefined;
  const look = { name: agent.name, accentColor: agent.accentColor, welcomeMessage: agent.welcomeMessage, starterQuestions: agent.starterQuestions, description: agent.description };

  return (
    <section className={p.chat} aria-labelledby="public-chat-title">
      <header className={compact ? p.compactHead : `${c.header} ${p.bar}`}>
        {brand}
        {!compact && <AgentAvatar agent={agent} size="md" />}
        <div className={c.headerText}>
          <h1 id="public-chat-title" className={compact ? p.compactTitle : c.title}>
            {agent.name}
          </h1>
          {!compact && <p className={c.subtitle}>{agent.teamName}</p>}
        </div>
        {/* Nothing to start over from before the first question. */}
        {(compact || chat.items.length > 0) && (
          <Button variant="ghost" size="sm" onClick={newChat} disabled={chat.streaming || chat.items.length === 0}>
            <SquarePen aria-hidden /> New chat
          </Button>
        )}
        {actions}
      </header>
      {session.isLoading ? (
        <Loading label="Loading…" />
      ) : (
        <ChatPanel
          chat={{ ...chat, send }}
          agent={look}
          text={text}
          onTextChange={setText}
          fullPage
          viewer={viewer}
          inputRef={ref}
          maxLength={agent.maxMessageChars}
          disabledReason={disabledReason}
          label={`Conversation with ${agent.name}`}
        />
      )}
      {needsCaptcha && <Turnstile siteKey={agent.captcha.siteKey} onToken={setCaptchaToken} />}
      <p className={p.privacy}>
        Conversations here are anonymous and kept only briefly. Don't share personal information. Questions the assistant can't answer may be grouped,
        without your details, to improve it.
      </p>
    </section>
  );
}
