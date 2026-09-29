/*
 * Admin Overview › Needs attention (A1): one row per thing waiting for an
 * admin, each linking to the filtered page. Hidden rows are simply absent;
 * with nothing to do it says so.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, CircleDollarSign, FileWarning, Gauge, Globe, LogIn, Mail, PowerOff, ShieldAlert, ShieldOff, TriangleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item/item";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import type { Schemas } from "@/api/client";
import { formatMoney, formatStorage as formatBytes } from "@/lib/format";
import { adminAgentsQuery } from "../agents/agents";
import { attentionQuery, overviewQuery, publicAccessQuery, publicPolicyQuery } from "./queries";
import o from "./overview.module.css";

type Row = { id: string; icon: ReactNode; title: string; description: ReactNode; action?: string; link?: ReactElement; tone?: "danger" | "warning" };

/* Production-readiness warnings (E7): an icon and, where the fix is in the UI, a link. Settings fixed in the environment have no link. */
const warningRows: Record<string, Pick<Row, "icon" | "action" | "link">> = {
  crawl_allowlist_empty: { icon: <Globe />, action: "Crawl domains", link: <Link to="/admin/crawl-domains" search={{ tab: "allowlist" }} /> },
  public_agents_without_moderation: { icon: <ShieldAlert />, action: "Set up moderation", link: <Link to="/admin/moderation" search={{ tab: "public" }} /> },
  smtp_not_configured: { icon: <Mail /> },
  oidc_no_domain_restriction: { icon: <LogIn /> },
  sso_groups_claim_missing: { icon: <LogIn />, action: "Group mapping", link: <Link to="/admin/group-mapping" /> },
};

function warningRow(w: Schemas["AdminWarning"]): Row {
  return {
    id: `warning-${w.code}`,
    icon: <TriangleAlert />,
    ...warningRows[w.code],
    title: w.message,
    description: w.fix,
    tone: w.severity === "warning" ? "warning" : undefined,
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function useRows(): { rows: Row[]; loading: boolean } {
  const overview = useQuery(overviewQuery());
  const attention = useQuery(attentionQuery());
  const agents = useQuery(adminAgentsQuery());
  const access = useQuery(publicAccessQuery());
  const policy = useQuery(publicPolicyQuery());
  const rows: Row[] = [];
  const pending = attention.data?.pendingDomainRequests ?? 0;
  if (pending > 0) {
    rows.push({
      id: "requests",
      icon: <Globe />,
      title: `${plural(pending, "domain request", "domain requests")} waiting for review`,
      description: "Teams can't crawl these hosts until a platform admin approves them.",
      action: "Review",
      link: <Link to="/admin/crawl-domains" />,
      tone: "warning",
    });
  }
  const disabled = (agents.data ?? []).filter((a) => a.status === "disabled_by_platform");
  if (disabled.length > 0) {
    rows.push({
      id: "disabled",
      icon: <PowerOff />,
      title: `${plural(disabled.length, "agent is", "agents are")} disabled by the platform`,
      description: disabled.map((a) => `${a.name} (${a.teamName})`).join(", "),
      action: "View agents",
      link: <Link to="/admin/agents" search={{ status: "disabled_by_platform" }} />,
    });
  }
  if (policy.data && !policy.data.modelId) {
    rows.push({
      id: "moderation",
      icon: <ShieldAlert />,
      title: "The public audience has no moderation provider",
      description: "No agent can be published to the public until one is chosen.",
      action: "Set up moderation",
      link: <Link to="/admin/moderation" search={{ tab: "public" }} />,
      tone: "danger",
    });
  }
  for (const w of overview.data?.warnings ?? []) {
    // The moderation row above already says this, with more detail.
    if (w.code === "public_agents_without_moderation" && rows.some((r) => r.id === "moderation")) continue;
    rows.push(warningRow(w));
  }
  if (access.data && !access.data.publicAgentsEnabled) {
    rows.push({
      id: "public-off",
      icon: <ShieldOff />,
      title: "Public agents are turned off",
      description: "Anonymous visitors can't chat with any public agent.",
      action: "Public access",
      link: <Link to="/admin/public-access" />,
    });
  }
  for (const f of overview.data?.failedIngest ?? []) {
    rows.push({
      id: `failed-${f.teamSlug ?? "shared"}`,
      icon: <FileWarning />,
      title: `${plural(f.failed, "document", "documents")} failed to index in ${f.teamName ?? "shared sources"}`,
      description: f.teamSlug ? "The team's owners see the reasons on each source's Documents tab." : "See each shared source's Documents tab.",
      action: f.teamSlug ? "Open team" : "Shared sources",
      link: f.teamSlug ? <Link to="/admin/teams/$team" params={{ team: f.teamSlug }} /> : <Link to="/admin/shared-sources" />,
    });
  }
  for (const n of overview.data?.teamsNearLimits ?? []) {
    const fmt = (v: number) => (n.unit === "bytes" ? formatBytes(v) : v.toLocaleString());
    rows.push({
      id: `limit-${n.teamSlug}-${n.key}`,
      icon: <Gauge />,
      title: `${n.teamName} is at ${Math.round((n.used / n.max) * 100)}% of its ${n.label.toLowerCase()} limit`,
      description: `${fmt(n.used)} of ${fmt(n.max)}`,
      action: "Team limits",
      link: <Link to="/admin/teams/$team" params={{ team: n.teamSlug }} search={{ tab: "limits" }} />,
      tone: n.used >= n.max ? "danger" : "warning",
    });
  }
  for (const n of overview.data?.teamsNearBudget ?? []) {
    rows.push({
      id: `budget-${n.teamSlug}`,
      icon: <CircleDollarSign />,
      title: n.state === "exhausted" ? `${n.teamName} has used up its monthly budget` : `${n.teamName} is at ${n.percent ?? 0}% of its monthly budget`,
      description: `${formatMoney(n.spent, n.currency)} of ${formatMoney(n.limit, n.currency)}${n.state === "exhausted" ? ": its chats, searches and ingestion are paused" : ""}`,
      action: "Team budget",
      link: <Link to="/admin/teams/$team" params={{ team: n.teamSlug }} search={{ tab: "limits" }} />,
      tone: n.state === "exhausted" ? "danger" : "warning",
    });
  }
  return { rows, loading: overview.isLoading || attention.isLoading || agents.isLoading || policy.isLoading || access.isLoading };
}

export function AttentionQueue() {
  const { rows, loading } = useRows();
  return (
    <Card title="Needs attention" description={loading ? undefined : rows.length ? undefined : "Nothing is waiting for a platform admin."} flush={rows.length > 0}>
      {loading ? (
        <div role="status" aria-label="Loading…">
          <SkeletonText lines={3} />
        </div>
      ) : rows.length === 0 ? (
        <p className={o.allClear}>
          <CheckCircle2 aria-hidden /> All clear
        </p>
      ) : (
        <ItemGroup className={o.queue}>
          {rows.map((r) => (
            <Item key={r.id} size="sm" className={o.row} data-tone={r.tone}>
              <ItemMedia variant="icon" aria-hidden>
                {r.icon}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{r.title}</ItemTitle>
                <ItemDescription>{r.description}</ItemDescription>
              </ItemContent>
              {r.link && (
                <ItemActions className={o.rowActions}>
                  <Button size="sm" variant="secondary" render={r.link}>
                    {r.action} <ArrowRight aria-hidden />
                  </Button>
                </ItemActions>
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
    </Card>
  );
}
