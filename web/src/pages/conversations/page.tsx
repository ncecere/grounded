/*
 * Conversations (D1): the user's whole chat history, searchable, filtered by
 * agent and last activity (all in the URL), grouped by day. Rename, export
 * and delete are in each row's "…" menu. Only the user sees these.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessagesSquare, SearchX } from "lucide-react";
import { api, unwrap } from "../../api/client";
import { agentDirectoryQuery, conversationsKey } from "../../api/queries";
import { LoadMore } from "../../components/query-view";
import { RelativeTime, useListFilters } from "../../components/templates/list-page";
import { terms } from "../../lib/terms";
import { useDebounced } from "../admin/hooks";
import { ConversationMenu, type ConversationSummary } from "../chat/conversations";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { startOfDay } from "@/components/ui/calendar/calendar";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { type Facet, FilterBar, isFacetActive } from "@/components/ui/filter-bar/filter-bar";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import type { DateRangeSelection } from "@/components/ui/date-picker/date-picker";
import { groupByDay } from "../../lib/group-by-day";
import s from "../shared.module.css";
import c from "./conversations.module.css";

function useFacets(): Facet<ConversationSummary>[] {
  const agents = useQuery(agentDirectoryQuery());
  const options = (agents.data ?? []).map((a) => ({ value: a.id, label: a.name, group: a.teamName })).sort((x, y) => x.label.localeCompare(y.label));
  return [
    { id: "agent", label: "Agent", type: "select", placeholder: "All agents", options },
    { id: "range", label: "Last active", type: "date-range" },
  ];
}

export function ConversationsPage() {
  const facets = useFacets();
  const filters = useListFilters(facets);
  const q = useDebounced(filters.query.trim(), 250);
  const agentId = (filters.values.agent as string[] | undefined)?.[0];
  const range = (filters.values.range as DateRangeSelection | undefined)?.range;
  const from = range ? startOfDay(range.from) : undefined;
  const last = range ? startOfDay(range.to ?? range.from) : undefined;
  const to = last ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) : undefined;
  const list = useInfiniteQuery({
    queryKey: [...conversationsKey, "history", q, agentId ?? "", from?.toISOString() ?? "", to?.toISOString() ?? ""],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/v1/conversations", {
          params: { query: { q: q || undefined, agentId, from: from?.toISOString(), to: to?.toISOString(), cursor: pageParam, limit: 50 } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(q) || Object.values(filters.values).some(isFacetActive);

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title={terms.conversations} description="Your conversations with agents, newest first. Only you can see them." />
      <FilterBar
        facets={facets}
        value={filters.values}
        onValueChange={filters.setValues}
        start={
          <Input
            type="search"
            size="sm"
            aria-label="Search conversations"
            placeholder="Search titles and agents"
            value={filters.query}
            onChange={(e) => filters.setQuery(e.target.value)}
            className={c.search}
          />
        }
      />
      <Card flush>
        {list.isLoading ? (
          <div role="status" aria-label="Loading conversations…" className={s.pad}>
            <Skeleton height="10rem" />
          </div>
        ) : list.error ? (
          <div className={s.pad}>
            <ErrorAlert error={list.error} title="Couldn't load your conversations" />
          </div>
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<SearchX />}
              title="No conversations match."
              action={
                <Button variant="secondary" onClick={() => (filters.setValues({}), filters.setQuery(""))}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<MessagesSquare />}
              title="No conversations yet."
              description="Start one by choosing an agent."
              action={
                <Button variant="secondary" render={<Link to="/agents" />}>
                  {terms.discoverAgents}
                </Button>
              }
            />
          )
        ) : (
          <ConversationGroups items={items} />
        )}
        <LoadMore query={list} />
      </Card>
    </Stack>
  );
}

function ConversationGroups({ items }: { items: ConversationSummary[] }) {
  return (
    <div className={c.groups}>
      {groupByDay(items).map((g) => (
        <section key={g.key} aria-labelledby={`day-${g.key.replace(/\W/g, "")}`} className={c.group}>
          <h2 id={`day-${g.key.replace(/\W/g, "")}`} className={c.day}>
            {g.label}
          </h2>
          <ul className={c.list}>
            {g.items.map((item) => (
              <li key={item.id} className={c.row}>
                <ConversationLink item={item} />
                <ConversationMenu conversation={item} onDeleted={() => {}} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ConversationLink({ item }: { item: ConversationSummary }) {
  const title = item.title || "Untitled conversation";
  const meta = (
    <span className={c.meta}>
      {item.agentName}
      {/* Lists are relative, with the exact time on hover (VI-16). */}
      {item.agentDeleted && " (deleted)"} · <RelativeTime value={item.updatedAt} />
    </span>
  );
  // A deleted agent's conversation opens read-only.
  if (item.agentDeleted) {
    return (
      <Link to="/conversations/$conversationId" params={{ conversationId: item.id }} className={c.link}>
        <span className={c.title}>{title}</span>
        {meta}
      </Link>
    );
  }
  return (
    <Link to="/a/$team/$agent" params={{ team: item.teamSlug, agent: item.agentSlug }} search={{ c: item.id }} className={c.link}>
      <span className={c.title}>{title}</span>
      {meta}
    </Link>
  );
}
