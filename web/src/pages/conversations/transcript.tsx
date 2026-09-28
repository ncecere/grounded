/*
 * One of the user's conversations by ID (/conversations/$conversationId).
 * A conversation whose agent still exists opens in its chat page; one whose
 * agent was deleted is shown here read-only: the transcript, a note that the
 * agent was deleted, no composer (G2). The chat page falls back to this view
 * for a ?c= link to a deleted agent.
 */
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { api, unwrap } from "../../api/client";
import { NotFoundState, isNotFound } from "../../components/not-found";
import { useCrumbTail } from "../../components/layout/crumb-tail";
import { ConversationMenu } from "../chat/conversations";
import { itemsFromConversation } from "../chat/stream";
import { ChatMessages } from "../chat/thread";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Loading } from "@/components/ui/spinner/spinner";
import { Time } from "@/components/ui/time/time";
import s from "../shared.module.css";
import c from "./conversations.module.css";

export const conversationQuery = (id: string) => ({
  queryKey: ["conversation", id],
  queryFn: async () => unwrap(await api.GET("/v1/conversations/{conversationId}", { params: { path: { conversationId: id } } })),
});

export function ConversationTranscriptPage() {
  const { conversationId } = useParams({ from: "/app/conversations/$conversationId" });
  return <ConversationTranscript id={conversationId} />;
}

/** A stored conversation: read-only when its agent was deleted, otherwise its chat page. */
export function ConversationTranscript({ id }: { id: string }) {
  const q = useQuery(conversationQuery(id));
  const navigate = useNavigate();
  const conv = q.data?.conversation;
  const items = useMemo(() => itemsFromConversation(q.data?.messages ?? []), [q.data]);
  useCrumbTail(conv ? conv.title || "Untitled conversation" : undefined);
  if (q.isLoading) return <Loading label="Loading the conversation…" />;
  if (isNotFound(q.error)) return <NotFoundState what="object" />;
  if (!conv) return <ErrorAlert error={q.error} title="Couldn't open this conversation" />;
  if (!conv.agentDeleted) return <Navigate to="/a/$team/$agent" params={{ team: conv.teamSlug, agent: conv.agentSlug }} search={{ c: conv.id }} replace />;
  const agent = { name: conv.agentName };
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={conv.title || "Untitled conversation"}
        description={
          <>
            With {conv.agentName} (deleted) · last active <Time value={conv.updatedAt} format="datetime" />
          </>
        }
        actions={<ConversationMenu conversation={conv} onDeleted={() => void navigate({ to: "/conversations" })} label="Conversation actions" />}
      />
      <Alert tone="info" title="This agent was deleted">
        You can read, export or delete this conversation, but you can't continue it.
      </Alert>
      <Card>
        <section aria-label={`Conversation with ${conv.agentName}`} className={c.transcript}>
          <ChatMessages items={items} agent={agent} />
        </section>
      </Card>
    </Stack>
  );
}
