/*
 * A team's conversations, read under the viewer's break-glass session with
 * the conversations scope (ADR-0024): the list (no user identity) and each
 * transcript on a record page, read-only. Every list page and transcript opened is
 * recorded on the server, so these queries don't refetch by themselves.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { NotFoundState, isNotFound } from "@/components/not-found";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Loading } from "@/components/ui/spinner/spinner";
import { breakGlassKey, isLive, timeLeft, useNow } from "@/lib/break-glass";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import b from "./break-glass.module.css";
import { useSession } from "./queries";

type Conv = Schemas["TeamConversation"];

/** Reads are audited: fetch once, never in the background. */
const once = { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false } as const;

const columns: DataTableColumn<Conv>[] = [
  {
    id: "title",
    header: "Conversation",
    accessor: (c) => c.title,
    rowHeader: true,
    cell: (c) => (
      <>
        <span className={s.primary}>{c.title || "Untitled"}</span>
        <span className={s.secondary}>{c.agentName}</span>
      </>
    ),
  },
  { id: "who", header: "User", accessor: (c) => (c.anonymous ? "Public visitor" : "Signed-in user") },
  { id: "questions", header: "Questions", accessor: (c) => c.questions, numeric: true },
  timeColumn("updated", "Last active", (c) => c.updatedAt),
];

export function BreakGlassConversationsPage() {
  const { sessionId } = useParams({ from: "/app/admin/break-glass/$sessionId/conversations" });
  const me = useCurrentUser();
  const now = useNow();
  const session = useSession(sessionId);
  const v = session.data;
  if (session.isLoading) return <Loading label="Loading the session…" />;
  if (isNotFound(session.error)) return <NotFoundState what="page" />;
  if (!v) return <ErrorAlert error={session.error} title="Couldn't load the session" />;
  const readable = v.requestedBy.id === me.user.id && isLive(v, now) && v.scopes.includes("conversations");
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={`${v.team.name}: conversations`}
        description="Conversations with the team's agents, read under break-glass. Who had them isn't shown. Every list and transcript you open is recorded."
        meta={readable && v.expiresAt ? <Badge tone="warning">{timeLeft(v.expiresAt, now)}</Badge> : undefined}
        actions={
          <Button variant="secondary" render={<Link to="/admin/break-glass" search={{ record: v.id } as never} />}>
            Session details
          </Button>
        }
      />
      {readable ? (
        <ConversationList team={v.team.slug} sessionId={v.id} />
      ) : (
        <Alert tone="info" title="No access">
          Only the admin who started this session can read conversations with it, while it's active and includes conversations.
        </Alert>
      )}
    </Stack>
  );
}

function ConversationList({ team, sessionId }: { team: string; sessionId: string }) {
  const record = useRecordParam();
  const q = useInfiniteQuery({
    queryKey: [...breakGlassKey, "conversations", sessionId],
    queryFn: async ({ pageParam }) => unwrap(await api.GET("/v1/teams/{team}/conversations", { params: { path: { team }, query: { cursor: pageParam, limit: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    ...once,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <ListPage<Conv>
        id="break-glass-conversations"
        caption="Team conversations"
        columns={columns}
        data={items}
        getRowId={(c) => c.id}
        rowLabel={(c) => c.title || "Untitled conversation"}
        rowActions={(c) => [{ label: "Read transcript", onSelect: () => record.open(c.id) }]}
        onRowClick={(c) => record.open(c.id)}
        manual
        loading={q.isLoading}
        error={q.error}
        empty={{ icon: <MessagesSquare />, title: "This team has no conversations." }}
        tableProps={{ loadMore: { hasMore: Boolean(q.hasNextPage), loading: q.isFetchingNextPage, onLoadMore: () => void q.fetchNextPage() } }}
      />
      <Transcript id={record.id} onClose={record.close} />
    </>
  );
}

function Transcript({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const q = useQuery({
    queryKey: [...breakGlassKey, "transcript", id],
    queryFn: async () => unwrap(await api.GET("/v1/conversations/{conversationId}", { params: { path: { conversationId: id! } } })),
    enabled: Boolean(id),
    ...once,
  });
  const c = q.data?.conversation;
  const messages = q.data?.messages ?? [];
  return (
    <RecordPage
      open={Boolean(id)}
      onClose={onClose}
      title={c?.title || "Conversation"}
      description="A transcript read under break-glass (read-only)."
      loading={q.isLoading}
      error={q.error}
      facts={c ? [{ label: "Agent", value: c.agentName }, { label: "Started", value: formatDate(c.createdAt) }, { label: "Last active", value: formatDate(c.updatedAt) }] : undefined}
    >
      {c && (
        <ol className={b.transcript} aria-label="Messages">
          {messages.map((m) => (
            <li key={m.id} className={b.message} data-role={m.role}>
              <p className={b.who}>
                {m.role === "user" ? "User" : c.agentName} <span className={s.muted}>{formatDate(m.createdAt)}</span>
              </p>
              <p className={b.text}>{m.text || (m.errorCode ? `No answer (${m.errorCode}).` : "No text.")}</p>
              {m.citations && m.citations.length > 0 && (
                <p className={s.secondary}>Sources: {m.citations.map((x) => `[${x.n}] ${x.title}`).join(", ")}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </RecordPage>
  );
}
