/*
 * Admin team › Overview (A4): what the team holds, its cost tracking and
 * budget (the Budget card, E2; on the Limits tab until v0.2.1, I7), its usage
 * against its limits (fullest first), pending domain requests and recent changes.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot, Database, FileText, Library, UsersRound } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { actionLabel, actorName } from "@/components/audit/labels";
import { RelativeTime } from "@/components/templates/list-page";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item/item";
import { Meter } from "@/components/ui/meter/meter";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { formatStorage as formatBytes } from "@/lib/format";
import { formatAmount, teamLimitsQuery } from "@/lib/limits";
import { AdminTeamBudgetCard } from "../costs/team-budget-card";
import { pendingDomainRequestsQuery } from "../crawling/requests";
import { usedShare } from "../limits/groups";
import t from "./people.module.css";

type Summary = Schemas["TeamSummary"];

/** Measured limits with a maximum, fullest first (at most 6). */
export function usageRows(items: Schemas["TeamLimit"][]) {
  return items
    .filter((it) => it.used !== null && it.max !== null && it.max > 0 && it.group !== "public")
    .sort((a, b) => usedShare(b) - usedShare(a))
    .slice(0, 6);
}

export function TeamOverviewTab({ summary }: { summary: Summary }) {
  const slug = summary.team.slug;
  const limits = useQuery(teamLimitsQuery(slug));
  const requests = useQuery(pendingDomainRequestsQuery());
  const audit = useQuery({
    queryKey: ["team", slug, "audit", "recent"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/audit", { params: { path: { team: slug }, query: { limit: 5 } } })),
  });
  const pending = (requests.data ?? []).filter((r) => r.teamSlug === slug);
  const usage = usageRows(limits.data?.items ?? []);
  return (
    <div className={t.overview}>
      <div className={t.stats}>
        <StatCard label="Members" value={summary.memberCount.toLocaleString()} icon={<UsersRound />} hint={`${summary.ownerCount} ${summary.ownerCount === 1 ? "owner" : "owners"}`} />
        <StatCard label="Agents" value={summary.agentCount.toLocaleString()} icon={<Bot />} render={<Link to="/admin/agents" search={{ team: slug }} />} />
        <StatCard label="Data sources" value={summary.sourceCount.toLocaleString()} icon={<Database />} />
        <StatCard label="Knowledge bases" value={summary.kbCount.toLocaleString()} icon={<Library />} />
        <StatCard label="Documents" value={summary.documentCount.toLocaleString()} icon={<FileText />} hint={formatBytes(summary.storageBytes)} />
      </div>
      <AdminTeamBudgetCard team={slug} />
      <div className={t.columns}>
        <Card
          title="Usage against limits"
          actions={
            <Button size="sm" variant="ghost" render={<Link to="/admin/teams/$team" params={{ team: slug }} search={{ tab: "limits" }} />}>
              All limits <ArrowRight aria-hidden />
            </Button>
          }
        >
          {limits.isLoading ? (
            <SkeletonText lines={3} />
          ) : usage.length === 0 ? (
            <p className={t.muted}>No limits are set for what this team uses.</p>
          ) : (
            <div className={t.meters}>
              {usage.map((it) => (
                <Meter
                  key={it.key}
                  label={it.label}
                  value={it.used!}
                  max={it.max}
                  formatValue={(v) => formatAmount(it.unit, v)}
                />
              ))}
            </div>
          )}
        </Card>
        <Card title="Pending domain requests" flush={pending.length > 0}>
          {pending.length === 0 ? (
            <p className={t.muted}>None.</p>
          ) : (
            <ItemGroup>
              {pending.map((r) => (
                <Item key={r.id} size="xs" className={t.row} render={<Link to="/admin/crawl-domains" />}>
                  <ItemContent>
                    <ItemTitle>
                      <code>{r.pattern}</code>
                    </ItemTitle>
                    <ItemDescription>
                      {r.requester?.displayName || r.requester?.email || "Deleted user"} · <RelativeTime value={r.createdAt} />
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          )}
        </Card>
      </div>
      <Card title="Recent changes" flush={(audit.data?.items.length ?? 0) > 0}>
        {audit.isLoading ? (
          <SkeletonText lines={3} />
        ) : (audit.data?.items.length ?? 0) === 0 ? (
          <p className={t.muted}>No changes yet.</p>
        ) : (
          <ItemGroup>
            {audit.data!.items.map((e) => (
              <Item key={e.id} size="xs" className={t.row}>
                <ItemContent>
                  <ItemTitle>
                    {actionLabel(e.action)}
                    {e.targetLabel ? `: ${e.targetLabel}` : ""}
                  </ItemTitle>
                  <ItemDescription>
                    {actorName(e.actor, e)} · <RelativeTime value={e.occurredAt} />
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </Card>
    </div>
  );
}
