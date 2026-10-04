/*
 * Admin Overview › Needs attention (A1): one row per thing waiting for an
 * admin, each linking to the filtered page. Hidden rows are simply absent;
 * with nothing to do it says so.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Blocks, CheckCircle2, CircleDollarSign, Cpu, FileWarning, Gauge, Globe, LogIn, Mail, Plug, PowerOff, ShieldAlert, ShieldOff, TriangleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item/item";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import type { Schemas } from "@/api/client";
import { formatMoney, formatStorage as formatBytes } from "@/lib/format";
import { adminAgentsQuery } from "../agents/agents";
import { failingCount, healthChecksQuery } from "../models/health";
import { useIsPlatformAdmin } from "../hooks";
import { attentionQuery, featuresQuery, overviewQuery } from "./queries";
import o from "./overview.module.css";

type Row = { id: string; icon: ReactNode; title: string; description: ReactNode; action?: string; link?: ReactElement; tone?: "danger" | "warning" };

/* Production-readiness warnings (E7): an icon and, where the fix is in the UI, a link. Settings fixed in the environment have no link. */
const warningRows: Record<string, Pick<Row, "icon" | "action" | "link">> = {
  crawl_allowlist_empty: { icon: <Globe />, action: "Crawl domains", link: <Link to="/admin/crawl-domains" search={{ tab: "allowlist" }} /> },
  public_agents_without_moderation: { icon: <ShieldAlert />, action: "Set up moderation", link: <Link to="/admin/moderation" search={{ tab: "public" }} /> },
  smtp_not_configured: { icon: <Mail /> },
  oidc_no_domain_restriction: { icon: <LogIn /> },
  sso_groups_claim_missing: { icon: <LogIn />, action: "SSO groups", link: <Link to="/admin/group-mapping" /> },
};

function warningRow(w: Schemas["AdminWarning"], isAdmin: boolean): Row {
  const known = warningRows[w.code];
  return {
    id: `warning-${w.code}`,
    icon: <TriangleAlert />,
    ...known,
    // Read-only staff open the page; they can't set anything up.
    action: !isAdmin && known?.action === "Set up moderation" ? "Moderation" : known?.action,
    title: w.message,
    description: w.fix,
    tone: w.severity === "warning" ? "warning" : undefined,
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function useRows(isAdmin: boolean): { rows: Row[]; loading: boolean } {
  const overview = useQuery(overviewQuery());
  const attention = useQuery(attentionQuery());
  const agents = useQuery(adminAgentsQuery());
  // Public access and the public moderation provider come with the Features card's request (AD-03).
  const features = useQuery(featuresQuery(useQueryClient()));
  const health = useQuery(healthChecksQuery());
  const rows: Row[] = [];
  const pending = attention.data?.pendingDomainRequests ?? 0;
  if (pending > 0) {
    rows.push({
      id: "requests",
      icon: <Globe />,
      title: `${plural(pending, "domain request", "domain requests")} waiting for review`,
      description: "Teams can't crawl these hosts until a platform admin approves them.",
      action: isAdmin ? "Review" : "View requests",
      link: <Link to="/admin/crawl-domains" />,
      tone: "warning",
    });
  }
  // Stored health (E11): enabled connections and models whose latest test failed.
  const failingConns = failingCount(health.data, "connection");
  if (failingConns > 0) {
    rows.push({
      id: "health-connections",
      icon: <Plug />,
      title: `${plural(failingConns, "connection is", "connections are")} failing`,
      description:
        failingConns === 1
          ? "Its latest test failed. Models on it may not answer until it works again."
          : "Their latest tests failed. Models on them may not answer until they work again.",
      action: "View connections",
      link: <Link to="/admin/connections" search={{ health: "failing" } as never} />,
      tone: "danger",
    });
  }
  const failingModels = failingCount(health.data, "model");
  if (failingModels > 0) {
    rows.push({
      id: "health-models",
      icon: <Cpu />,
      title: `${plural(failingModels, "model is", "models are")} failing`,
      description:
        failingModels === 1
          ? "Its latest test failed. Agents and knowledge bases that use it may not work."
          : "Their latest tests failed. Agents and knowledge bases that use them may not work.",
      action: "View models",
      link: <Link to="/admin/models" search={{ health: "failing" } as never} />,
      tone: "danger",
    });
  }
  const failingMCP = failingCount(health.data, "mcp_server");
  if (failingMCP > 0) {
    rows.push({
      id: "health-mcp",
      icon: <Blocks />,
      title: `${plural(failingMCP, "MCP server is", "MCP servers are")} failing`,
      description:
        failingMCP === 1
          ? "Its latest test failed. Agents' calls to its tools will probably fail."
          : "Their latest tests failed. Agents' calls to their tools will probably fail.",
      action: "View MCP servers",
      link: <Link to="/admin/mcp-servers" search={{ health: "failing" } as never} />,
      tone: "danger",
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
  if (features.data && !features.data.publicModeration) {
    rows.push({
      id: "moderation",
      icon: <ShieldAlert />,
      title: "The public audience has no moderation provider",
      description: "No agent can be published to the public until one is chosen.",
      action: isAdmin ? "Set up moderation" : "Moderation",
      link: <Link to="/admin/moderation" search={{ tab: "public" }} />,
      tone: "danger",
    });
  }
  for (const w of overview.data?.warnings ?? []) {
    // The moderation row above already says this, with more detail.
    if (w.code === "public_agents_without_moderation" && rows.some((r) => r.id === "moderation")) continue;
    rows.push(warningRow(w, isAdmin));
  }
  if (features.data && !features.data.publicAccess.publicAgentsEnabled) {
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
      description: "See them by source and reason on Parsing & OCR, retry them or notify the team's owners.",
      action: "Failed documents",
      link: <Link to="/admin/parsing" hash="document-problems" />,
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
      // The Budget card is on the team's Overview (v0.2.1 I7).
      link: <Link to="/admin/teams/$team" params={{ team: n.teamSlug }} />,
      tone: n.state === "exhausted" ? "danger" : "warning",
    });
  }
  return { rows, loading: overview.isLoading || attention.isLoading || agents.isLoading || features.isLoading || health.isLoading };
}

export function AttentionQueue() {
  const { rows, loading } = useRows(useIsPlatformAdmin());
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
