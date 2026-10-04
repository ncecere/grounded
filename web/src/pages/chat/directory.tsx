/* Discover agents (/agents): agents grouped by audience (your teams, signed-in users, public) with each tile's audience, search, a group toggle and a team filter in the URL; and the lists the home page reuses. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot, MessagesSquare } from "lucide-react";
import type { Schemas } from "../../api/client";
import { agentDirectoryQuery, conversationsQuery } from "../../api/queries";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { type Facet, FilterBar, type FilterValue } from "@/components/ui/filter-bar/filter-bar";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import { RelativeTime, SEARCH_PARAM, useListFilters } from "../../components/templates/list-page";
import { useSearchParams } from "@/lib/url-search";
import { DirectoryChips } from "./directory-chips";
import { audienceLabel, audienceLabels, terms } from "../../lib/terms";
import { useDebounced } from "../admin/hooks";
import { AgentAvatar } from "./welcome";
import s from "../shared.module.css";
import d from "./directory.module.css";

type Card = Schemas["AgentCard"];

/** One agent tile, linking to its chat page. */
function AgentTile({ a }: { a: Card }) {
  return (
    <Link to="/a/$team/$agent" params={{ team: a.teamSlug, agent: a.slug }} className={d.agent}>
      <AgentAvatar agent={a} size="md" />
      <span className={d.agentText}>
        <span className={d.agentName}>{a.name}</span>
        <span className={d.agentTeam}>{a.teamName}</span>
        {a.description && <span className={d.agentDescription}>{a.description}</span>}
        <span className={d.agentBadges}>
          <Badge variant="outline" size="sm">
            {audienceLabel(a.audience)}
          </Badge>
          {a.status !== "active" && (
            <Badge tone="warning" size="sm">
              Turned off
            </Badge>
          )}
        </span>
      </span>
      <ArrowRight aria-hidden className={d.arrow} />
    </Link>
  );
}

function TileGrid({ list }: { list: Card[] }) {
  return (
    <ul className={d.grid}>
      {list.map((a) => (
        <li key={a.id}>
          <AgentTile a={a} />
        </li>
      ))}
    </ul>
  );
}

const loadingTiles = (
  <div className={d.grid}>
    <Skeleton height="5.5rem" />
    <Skeleton height="5.5rem" />
  </div>
);

/** The home page's list: agents the user can chat with (all groups), newest first by name. */
export function AgentList({ limit }: { limit?: number }) {
  const agents = useQuery(agentDirectoryQuery());
  if (agents.isLoading) return loadingTiles;
  if (agents.error) return <ErrorAlert error={agents.error} title="Couldn't load agents" />;
  const list = (agents.data ?? []).slice(0, limit);
  if (list.length === 0)
    return (
      <EmptyState
        size="compact"
        icon={<Bot />}
        title="No agents yet."
        description="Agents your teams publish appear here. Editors create them under a team's Agents page."
      />
    );
  return <TileGrid list={list} />;
}

type Group = NonNullable<Card["group"]>;

/** The directory's groups (docs/phase4-publishing.md §3), named by audience (terms.ts). */
const groups: { key: Group; title: string; description: string }[] = [
  { key: "team", title: "From your teams", description: "Agents published by the teams you belong to." },
  { key: "organisation", title: `Shared with ${audienceLabels.all_authenticated.toLowerCase()}`, description: "Agents anyone who signs in can use." },
  { key: "public", title: audienceLabels.public, description: "Agents anyone can use, including visitors who aren't signed in." },
];

const audienceOf: Record<Exclude<Group, "team">, Card["audience"]> = { organisation: "all_authenticated", public: "public" };

function DirectoryGroups({ q, team, show }: { q: string; team: string; show?: Group }) {
  const agents = useQuery(agentDirectoryQuery({ q, team }));
  if (agents.isLoading) return loadingTiles;
  if (agents.error) return <ErrorAlert error={agents.error} title="Couldn't load agents" />;
  // "Your teams" is the section; Signed-in users and Public match each agent's
  // audience (its badge), so a team's own public agent counts as public too.
  const list = (agents.data ?? []).filter((a) => !show || (show === "team" ? (a.group ?? "team") === "team" : a.audience === audienceOf[show]));
  if (list.length === 0)
    return (
      <EmptyState
        icon={<Bot />}
        title={q || team || show ? "No agents match." : "No agents yet."}
        description={q || team || show ? "Try another search or filter." : "Agents published by your teams, and shared with everyone, appear here."}
      />
    );
  return (
    <>
      {groups.map((g) => {
        const items = list.filter((a) => (a.group ?? "team") === g.key);
        if (items.length === 0) return null;
        return (
          <section key={g.key} aria-labelledby={`group-${g.key}`} className={d.group}>
            <h2 id={`group-${g.key}`} className={d.groupTitle}>
              {g.title} <span className={d.groupCount}>· {items.length === 1 ? "1 agent" : `${items.length} agents`}</span>
            </h2>
            <p className={d.groupDescription}>{g.description}</p>
            <TileGrid list={items} />
          </section>
        );
      })}
    </>
  );
}

export function RecentConversations({ limit = 8 }: { limit?: number }) {
  const conversations = useQuery(conversationsQuery({ limit }));
  if (conversations.isLoading) return <Skeleton height="6rem" />;
  if (conversations.error) return <ErrorAlert error={conversations.error} title="Couldn't load conversations" />;
  const items = conversations.data?.items ?? [];
  if (items.length === 0) return <EmptyState size="compact" icon={<MessagesSquare />} title="No conversations yet." description="Start one by choosing an agent." />;
  return (
    <ul className={d.recent}>
      {items.map((c) => (
        <li key={c.id}>
          {c.agentDeleted ? (
            <Link to="/conversations/$conversationId" params={{ conversationId: c.id }} className={d.recentRow}>
              <span className={d.recentTitle}>{c.title || "Untitled conversation"}</span>
              <span className={d.recentMeta}>
                {c.agentName} (deleted) · <RelativeTime value={c.updatedAt} />
              </span>
            </Link>
          ) : (
            <Link to="/a/$team/$agent" params={{ team: c.teamSlug, agent: c.agentSlug }} search={{ c: c.id }} className={d.recentRow}>
              <span className={d.recentTitle}>{c.title || "Untitled conversation"}</span>
              <span className={d.recentMeta}>
                {c.agentName} · <RelativeTime value={c.updatedAt} />
              </span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Filters in the URL: ?q= (search), ?show= (group) and ?team=. */
function useDirectoryFacets(): Facet<Card>[] {
  // Teams to filter by: those in the unfiltered directory; the filter only appears with more than one.
  const all = useQuery(agentDirectoryQuery());
  const teams = [...new Map((all.data ?? []).map((a) => [a.teamSlug, a.teamName])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
  return [
    { id: "show", label: "Show", type: "toggle", allLabel: "All", options: groups.map((g) => ({ value: g.key, label: g.key === "team" ? "Your teams" : g.key === "organisation" ? audienceLabels.all_authenticated : audienceLabels.public })) },
    ...(teams.length > 1 ? [{ id: "team", label: "Team", type: "select" as const, placeholder: "All teams", options: teams.map(([value, label]) => ({ value, label })) }] : []),
  ];
}

const first = (v: FilterValue | undefined) => (Array.isArray(v) ? v[0] : undefined);

export function AgentDirectoryPage() {
  const facets = useDirectoryFacets();
  const filters = useListFilters(facets);
  const [, setParams] = useSearchParams();
  const q = useDebounced(filters.query.trim(), 250);
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={terms.discoverAgents}
        description="Agents you can chat with: your teams', those shared with everyone who signs in, and public ones. Your conversations are private to you."
      />
      <FilterBar
        facets={facets}
        value={filters.values}
        onValueChange={filters.setValues}
        // Discover's own chips also show the search, and its Clear all clears it (US-13).
        chips={false}
        start={
          <Input
            type="search"
            size="sm"
            aria-label="Search"
            placeholder="Name, description or team"
            value={filters.query}
            onChange={(e) => filters.setQuery(e.target.value)}
            className={d.search}
          />
        }
      />
      <DirectoryChips
        facets={facets}
        values={filters.values}
        query={filters.query}
        onValues={filters.setValues}
        onQuery={filters.setQuery}
        onClearAll={() =>
          setParams((p) => {
            const out = new URLSearchParams(p);
            for (const id of [SEARCH_PARAM, ...facets.map((f) => f.id)]) out.delete(id);
            return out;
          })
        }
      />
      <DirectoryGroups q={q} team={first(filters.values.team) ?? ""} show={first(filters.values.show) as Group | undefined} />
    </Stack>
  );
}
