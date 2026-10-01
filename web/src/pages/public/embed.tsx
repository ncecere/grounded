/*
 * The widget's chat page (/embed/{agentId}?key=pk_…), framed by the widget
 * loader on allowed sites. Grounded serves it with frame-ancestors set to the
 * key's allowed origins, and marks failures with <meta name="grounded-embed-error">.
 * Esc anywhere in the frame asks the loader to close the panel (the loader
 * returns focus to its launcher). ?preview=1&team= is the agent editor's
 * preview: the draft, as the signed-in member, nothing stored. The route is
 * outside the app's session gate, so the preview loads the session itself:
 * its CSRF token must be set before the first question is posted.
 */
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../../session";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { ChatPanel } from "../chat/panel";
import { chatErrorText, historyOf } from "../chat/stream";
import { useChat } from "../chat/useChat";
import { sharingQuery } from "../agents/share/sharing";
import { agentQuery } from "../team/common";
import { PublicChat } from "./public-chat";
import { publicAgentQuery } from "./session";
import p from "./public.module.css";

export type EmbedSearch = { key?: string; preview?: "1"; team?: string };

/**
 * Esc closes the widget's panel, unless it closes something open inside it first (a citation's card, the source
 * viewer's sheet); the loader's "focus" puts the cursor in the composer.
 */
function useWidgetBridge(input: React.RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || window.parent === window || e.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      window.parent.postMessage({ type: "grounded-widget:close" }, "*");
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && (e.data as { type?: string } | null)?.type === "grounded-widget:focus") input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMessage);
    };
  }, [input]);
}

export function EmbedPage() {
  const { agentId } = useParams({ from: "/embed/$agentId" });
  const search = useSearch({ from: "/embed/$agentId" }) as EmbedSearch;
  const input = useRef<HTMLTextAreaElement | null>(null);
  useWidgetBridge(input);
  const [error] = useState(() => document.querySelector('meta[name="grounded-embed-error"]')?.getAttribute("content") ?? "");
  let body;
  if (search.preview === "1" && search.team) body = <EmbedPreview team={search.team} agentId={agentId} input={input} />;
  else if (error || !search.key) body = <EmbedError code={error || "invalid_publishable_key"} />;
  else body = <EmbedChat agentId={agentId} widgetKey={search.key} input={input} />;
  return (
    <main className={p.embed} aria-label={search.preview === "1" ? "Widget preview" : "Chat widget"}>
      {body}
    </main>
  );
}

function EmbedError({ code }: { code: string }) {
  const text = chatErrorText(code);
  return <EmptyState className={p.unavailable} icon={<Bot />} title={code === "agent_disabled" ? "This assistant has been turned off" : text.title} description={text.message} />;
}

function EmbedChat({ agentId, widgetKey, input }: { agentId: string; widgetKey: string; input: React.RefObject<HTMLTextAreaElement | null> }) {
  const agent = useQuery(publicAgentQuery(agentId));
  if (agent.isLoading) return <Loading label="Loading the assistant…" />;
  if (!agent.data) return <EmbedError code={(agent.error as { code?: string } | null)?.code ?? "agent_not_found"} />;
  return <PublicChat agent={agent.data} widgetKey={widgetKey} compact inputRef={input} />;
}

/** The editor's preview: the draft through the test endpoint (nothing stored). */
function EmbedPreview({ team, agentId, input }: { team: string; agentId: string; input: React.RefObject<HTMLTextAreaElement | null> }) {
  // GET /v1/me sets the session's CSRF token (the test endpoint is a POST); wait for it before chatting.
  const me = useMe();
  const agent = useQuery({ ...agentQuery(team, agentId), enabled: Boolean(me.data) });
  // The real public message limit, so the preview composer matches the widget (P-14).
  const sharing = useQuery({ ...sharingQuery(team, agentId), enabled: Boolean(me.data) });
  const [text, setText] = useState("");
  const viewer = useMemo(() => ({ kind: "team" as const, team }), [team]);
  const chat = useChat({
    path: `/v1/teams/${encodeURIComponent(team)}/agents/${agentId}/test`,
    body: (message, previous) => ({ message, history: historyOf(previous), stream: true }),
  });
  if (me.isLoading || agent.isLoading) return <Loading label="Loading the preview…" />;
  if (!me.data) {
    return <EmptyState className={p.unavailable} icon={<Bot />} title="Sign in to preview this agent" description="The preview answers as you, with the draft. Sign in, then reload this page." />;
  }
  if (!agent.data) return <EmbedError code="agent_not_found" />;
  const a = agent.data;
  return (
    <section className={p.chat} aria-labelledby="preview-title">
      <header className={p.compactHead}>
        <h1 id="preview-title" className={p.compactTitle}>
          {a.name}
        </h1>
        <span className={p.previewNote}>Preview of the draft: nothing is stored</span>
      </header>
      <ChatPanel
        chat={chat}
        agent={{ name: a.name, accentColor: a.accentColor, welcomeMessage: a.welcomeMessage, starterQuestions: a.starterQuestions, description: a.description }}
        text={text}
        onTextChange={setText}
        fullPage
        viewer={viewer}
        inputRef={input}
        label={`Preview conversation with ${a.name}`}
        maxLength={sharing.data?.widget.maxMessageChars}
      />
    </section>
  );
}
