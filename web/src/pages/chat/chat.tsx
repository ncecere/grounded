/*
 * The chat page (/a/$team/$agent and /a/id/$agentId), full width and full
 * height: the user's conversations with the agent in a panel on the left (a
 * sheet on narrow screens), and the thread with the composer pinned under it.
 * ?c=<id> opens a stored conversation; a new one gets its ID from the
 * stream's `conversation` event and the URL follows.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { PanelLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, unwrap, type Schemas } from "../../api/client";
import { agentProfileQuery, conversationsKey, conversationsQuery } from "../../api/queries";
import { NotFoundState } from "../../components/not-found";
import { ConversationTranscript, conversationQuery } from "../conversations/transcript";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { IconButton } from "@/components/ui/button/button";
import { Sheet } from "@/components/ui/sheet/sheet";
import { Loading } from "@/components/ui/spinner/spinner";
import { AgentInfo } from "./agent-info";
import { ConversationList, ConversationMenu } from "./conversations";
import { ChatPanel } from "./panel";
import { itemsFromConversation } from "./stream";
import { useChat } from "./useChat";
import { AgentAvatar } from "./welcome";
import a from "./agent-info.module.css";
import c from "./chat.module.css";

type Card = Schemas["AgentCard"];

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
  const search = useSearch({ strict: false }) as { c?: string };
  // A link to a conversation with a deleted agent: its transcript, read-only (G2).
  const stored = useQuery({ ...conversationQuery(search.c ?? ""), enabled: Boolean(search.c) && Boolean(profile.error), retry: false });
  if (profile.error && stored.data?.conversation.agentDeleted)
    return (
      <div className={c.unavailable}>
        <ConversationTranscript id={stored.data.conversation.id} />
      </div>
    );
  if (profile.isLoading || stored.isLoading) return <Loading label="Loading the agent…" />;
  if (profile.error || !profile.data)
    return (
      <div className={c.unavailable}>
        <NotFoundState what="chat" />
      </div>
    );
  return <AgentChat key={profile.data.id} card={profile.data} />;
}

function AgentChat({ card }: { card: Card }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { c?: string };
  const selected = search.c;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  /** The conversation the next question continues. */
  const current = useRef<string | undefined>(selected);
  /** Conversations created in this page session: their items are already on screen. */
  const local = useRef(new Set<string>());
  const conversations = useQuery(conversationsQuery({ agentId: card.id, limit: 50 }));
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
  const detail = useQuery({
    queryKey: ["conversation", selected],
    queryFn: async () => unwrap(await api.GET("/v1/conversations/{conversationId}", { params: { path: { conversationId: selected! } } })),
    enabled: Boolean(selected) && !local.current.has(selected!),
  });
  const { reset } = chat;
  useEffect(() => {
    current.current = selected;
    if (selected && local.current.has(selected)) return;
    reset([]);
  }, [selected, reset]);
  useEffect(() => {
    if (detail.data && detail.data.conversation.id === selected) reset(itemsFromConversation(detail.data.messages));
  }, [detail.data, selected, reset]);

  const newChat = () => {
    current.current = undefined;
    void navigate({ to: ".", search: {}, replace: false });
    reset([]);
    setText("");
    setSheetOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const currentSummary = conversations.data?.items.find((x) => x.id === selected);
  const agentLook = { name: card.name, accentColor: card.accentColor, welcomeMessage: card.welcomeMessage, starterQuestions: card.starterQuestions, description: card.description };

  const list = { card, conversations, selected, onNew: newChat };

  return (
    <div className={c.page}>
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
            trigger={<IconButton icon={<PanelLeft aria-hidden />} label="Show conversations" className={c.sheetToggle} />}
          >
            <ConversationList {...list} onPick={() => setSheetOpen(false)} className={c.sheetList} />
          </Sheet>
          <AgentAvatar agent={card} size="md" />
          <div className={c.headerText}>
            <h1 id="chat-title" className={c.title}>
              {card.name}
            </h1>
            <p className={c.subtitle}>
              <AgentInfo card={card} />
              {currentSummary?.title && <span className={a.subtitleConv}> · {currentSummary.title}</span>}
            </p>
          </div>
          {currentSummary && <ConversationMenu conversation={currentSummary} onDeleted={newChat} label="Conversation actions" />}
        </header>
        <ChatPanel
          chat={chat}
          agent={agentLook}
          text={text}
          onTextChange={setText}
          feedback
          fullPage
          inputRef={inputRef}
          disabledReason={disabledReason}
          label={`Conversation with ${card.name}`}
          loading={selected && !local.current.has(selected) ? detail.error ? <ErrorAlert error={detail.error} title="Couldn't open this conversation" /> : detail.isLoading ? <Loading label="Loading the conversation…" /> : undefined : undefined}
        />
      </section>
    </div>
  );
}
