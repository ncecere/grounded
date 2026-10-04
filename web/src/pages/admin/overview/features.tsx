/*
 * Admin Overview › Features (docs/v0.2.1.md I2): one row per optional feature
 * with its state and a link to where it's set up. Evaluations, the MCP
 * server and saved answers (the answer cache) have their switches here (platform admins; auditors see them
 * disabled, with the reason); the MCP row links to its guide. The rows read
 * one response (GET /v1/admin/features, AD-03), which also primes the
 * switches' own queries; each row shows its whole description (not clamped).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownWideNarrow, ArrowRight, BookOpen, Cable, DatabaseZap, CircleDollarSign, ClipboardCheck, Earth, KeyRound, Network, ScanText, Sparkles, Wrench } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Schemas } from "@/api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item/item";
import { cx } from "@/lib/bitop-utils";
import { backendLabels } from "@/lib/parsing";
import { terms } from "@/lib/terms";
import { useIsPlatformAdmin } from "../hooks";
import { AnswerCacheSwitch, answerCacheText, useAnswerCacheSetting } from "./answer-cache-switch";
import { EvaluationsSwitch, evaluationsText, useEvaluationsSetting } from "./evaluations-switch";
import { costFeature, type FeatureState, plural, rerankFeature, systemOneFeature } from "./feature-text";
import { MCPSwitch, mcpDocsUrl, mcpText, useMCPSetting } from "./mcp-switch";
import { OAuthSwitch, oauthDocsUrl, oauthFeature, useOAuthSave } from "./oauth-switch";
import { featuresQuery } from "./queries";
import o from "./overview.module.css";

type Row = {
  id: string;
  icon: ReactNode;
  title: string;
  state?: FeatureState;
  description: ReactNode;
  link?: ReactElement;
  action?: string;
  /** An icon for the link's button (default: an arrow after the text). */
  actionIcon?: ReactNode;
  control?: ReactNode;
  /** A mark after the state, such as Experimental. */
  badge?: ReactNode;
};

const on: FeatureState = { label: "On", tone: "success" };
const off: FeatureState = { label: "Off", tone: "neutral" };

/** A row from its query: "Loading…" or a short error until the setting is read. */
function fromQuery<T>(q: UseQueryResult<T>, base: Omit<Row, "description" | "state">, read: (d: T) => Pick<Row, "state" | "description">): Row {
  if (q.data !== undefined) return { ...base, ...read(q.data) };
  return { ...base, description: q.error ? "Couldn't load this setting." : "Loading…" };
}

type Switches = {
  evaluations: ReturnType<typeof useEvaluationsSetting>;
  mcp: ReturnType<typeof useMCPSetting>;
  oauth: ReturnType<typeof useOAuthSave>;
  cache: ReturnType<typeof useAnswerCacheSetting>;
};

type Features = Schemas["AdminFeatures"];

function useRows(isAdmin: boolean, f: Features, { evaluations, mcp, oauth, cache }: Switches): Row[] {
  const rerank = rerankFeature(f.rerank, f.rerankModel);
  return [
    fromQuery(
      evaluations.settings,
      {
        id: "evaluations",
        icon: <ClipboardCheck />,
        title: "Evaluations",
        control: <EvaluationsSwitch setting={evaluations} isAdmin={isAdmin} />,
        action: "Evaluation limits",
        link: <Link to="/admin/limits" search={{ tab: "evaluations" }} />,
      },
      (d) => ({ state: d.enabled ? on : off, description: evaluationsText(d.enabled) }),
    ),
    fromQuery(
      mcp.settings,
      {
        id: "mcp",
        icon: <Cable />,
        title: "MCP server",
        control: <MCPSwitch setting={mcp} isAdmin={isAdmin} />,
        action: "Setup guide",
        actionIcon: <BookOpen aria-hidden />,
        link: <a href={mcpDocsUrl} target="_blank" rel="noreferrer" aria-label="MCP server setup guide (opens in a new tab)" />,
      },
      (d) => ({ state: d.enabled ? on : off, description: mcpText(d.enabled) }),
    ),
    fromQuery(
      mcp.settings,
      {
        id: "mcp-oauth",
        icon: <KeyRound />,
        title: "OAuth sign-in for MCP clients",
        badge: (
          <Badge size="sm" tone="warning">
            Experimental
          </Badge>
        ),
        control: <OAuthSwitch setting={mcp} save={oauth} isAdmin={isAdmin} />,
        action: "How it works",
        actionIcon: <BookOpen aria-hidden />,
        link: <a href={oauthDocsUrl} target="_blank" rel="noreferrer" aria-label="How OAuth sign-in works (opens in a new tab)" />,
      },
      oauthFeature,
    ),
    fromQuery(
      cache.settings,
      { id: "answer-cache", icon: <DatabaseZap />, title: "Saved answers", control: <AnswerCacheSwitch setting={cache} isAdmin={isAdmin} /> },
      (d) => ({ state: d.enabled ? on : off, description: answerCacheText(d.enabled) }),
    ),
    {
      id: "costs",
      icon: <CircleDollarSign />,
      title: "Cost tracking",
      action: "Cost settings",
      link: <Link to="/admin/costs" search={{ tab: "settings" }} />,
      ...costFeature(f.costs.settings.mode, f.costs.teams.map((x) => ({ teamName: x.teamName, status: { mode: x.mode } }))),
    },
    {
      id: "ocr",
      icon: <ScanText />,
      title: "OCR",
      action: "Parsing & OCR",
      link: <Link to="/admin/parsing" />,
      state: f.ocr.enabled ? { label: `On · ${backendLabels[f.ocr.backend]}`, tone: "success" } : off,
      description: f.ocr.enabled
        ? `Scanned PDF pages and image uploads are read with ${backendLabels[f.ocr.backend]}; each source can turn it off.`
        : "Scanned PDF pages and images are not read.",
    },
    {
      id: "sso",
      icon: <Network />,
      title: terms.groupMapping,
      action: terms.groupMapping,
      link: <Link to="/admin/group-mapping" />,
      state: { label: plural(f.groupMappingRules, "rule", "rules"), tone: f.groupMappingRules > 0 ? "info" : "neutral" },
      description: f.groupMappingRules > 0 ? "People get team roles from their identity-provider groups when they sign in." : "No rules: team members are added by hand.",
    },
    { id: "systemone", icon: <Sparkles />, title: "SystemOne", action: "SystemOne", link: <Link to="/admin/systemone" />, ...systemOneFeature(f.systemOne) },
    // Reranking (OW-2): "Off · Set up" or "On · <model>", linking to its page.
    { id: "reranking", icon: <ArrowDownWideNarrow />, title: "Reranking", link: <Link to="/admin/reranking" />, ...rerank },
    {
      id: "public",
      icon: <Earth />,
      title: "Public access",
      action: "Public access",
      link: <Link to="/admin/public-access" />,
      state: f.publicAccess.publicAgentsEnabled ? on : off,
      description: f.publicAccess.publicAgentsEnabled ? "Anonymous visitors can chat with agents published to the public." : "No agent answers anonymous visitors.",
    },
    {
      id: "maintenance",
      icon: <Wrench />,
      title: "Maintenance",
      action: "Maintenance",
      link: <Link to="/admin/maintenance" />,
      state: f.maintenance.enabled ? { label: "On", tone: "warning" } : off,
      description: f.maintenance.enabled ? `New ingestion is paused${f.maintenance.reason ? `: ${f.maintenance.reason}` : "."}` : "Ingestion runs as usual.",
    },
  ];
}

const cardProps = { id: "features", className: o.features, title: "Features", description: "Optional features: whether each is on, and where to set it up." };

export function FeaturesCard() {
  const features = useQuery(featuresQuery(useQueryClient()));
  // One card in every state, so the #features anchor and the heading stay put while it loads.
  return (
    <Card {...cardProps} flush={Boolean(features.data)}>
      {features.data ? (
        <FeatureRows features={features.data} />
      ) : features.error ? (
        <ErrorAlert error={features.error} title="Couldn't load the features" onRetry={() => void features.refetch()} />
      ) : (
        <p className={o.fullText}>Loading…</p>
      )}
    </Card>
  );
}

/** Mounted once the features have loaded (and primed the switches' queries). */
function FeatureRows({ features }: { features: Features }) {
  const isAdmin = useIsPlatformAdmin();
  const evaluations = useEvaluationsSetting();
  const mcp = useMCPSetting();
  const oauth = useOAuthSave(mcp);
  const cache = useAnswerCacheSetting();
  const rows = useRows(isAdmin, features, { evaluations, mcp, oauth, cache });
  return (
    <>
      {evaluations.save.error != null && (
        <div className={o.cardAlert}>
          <ErrorAlert error={evaluations.save.error} title="Couldn't change evaluations" />
        </div>
      )}
      {mcp.save.error != null && (
        <div className={o.cardAlert}>
          <ErrorAlert error={mcp.save.error} title="Couldn't change the MCP server" />
        </div>
      )}
      {cache.save.error != null && (
        <div className={o.cardAlert}>
          <ErrorAlert error={cache.save.error} title="Couldn't change saved answers" />
        </div>
      )}
      {oauth.error != null && (
        <div className={o.cardAlert}>
          <ErrorAlert error={oauth.error} title="Couldn't change OAuth sign-in" />
        </div>
      )}
      <ItemGroup className={o.queue}>
        {rows.map((r) => (
          <Item key={r.id} size="sm" className={o.row}>
            <ItemMedia variant="icon" aria-hidden>
              {r.icon}
            </ItemMedia>
            <ItemContent>
              <ItemTitle className={o.featureTitle}>
                {r.title}
                {r.state && (
                  <StatusBadge size="sm" tone={r.state.tone}>
                    {r.state.label}
                  </StatusBadge>
                )}
                {r.badge}
              </ItemTitle>
              {/* The whole sentence: what a feature does, or what turning it off hides, matters here. */}
              <ItemDescription className={o.fullText}>{r.description}</ItemDescription>
            </ItemContent>
            {(r.control || r.link) && (
              <ItemActions className={cx(o.rowActions, o.featureActions)}>
                {r.control}
                {r.link && (
                  <Button size="sm" variant="secondary" render={r.link}>
                    {r.actionIcon}
                    {r.action} {!r.actionIcon && <ArrowRight aria-hidden />}
                  </Button>
                )}
              </ItemActions>
            )}
          </Item>
        ))}
      </ItemGroup>
    </>
  );
}
