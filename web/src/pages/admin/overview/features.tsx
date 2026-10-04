/*
 * Admin Overview › Features (docs/v0.2.1.md I2): one row per optional feature
 * with its state and a link to where it's set up. The switches (evaluations,
 * the MCP server, its OAuth sign-in and saved answers) moved to Admin →
 * Settings in v0.4.2 (AD-39); their rows here say whether each is on and link
 * there. The rows read one response (GET /v1/admin/features, AD-03), which
 * also primes the switches' own queries; each row shows its whole description
 * (not clamped). FeatureList draws the rows for both pages.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownWideNarrow, ArrowRight, Cable, DatabaseZap, CircleDollarSign, ClipboardCheck, Earth, KeyRound, Network, ScanText, Sparkles, Wrench } from "lucide-react";
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
import { answerCacheText } from "./answer-cache-switch";
import { evaluationsText } from "./evaluations-switch";
import { costFeature, type FeatureState, plural, rerankFeature, systemOneFeature } from "./feature-text";
import { mcpText } from "./mcp-switch";
import { oauthFeature } from "./oauth-switch";
import { answerCacheSettingsQuery, evaluationSettingsQuery, featuresQuery, mcpSettingsQuery } from "./queries";
import o from "./overview.module.css";

export type Row = {
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

export const on: FeatureState = { label: "On", tone: "success" };
export const off: FeatureState = { label: "Off", tone: "neutral" };

/** A row from its query: "Loading…" or a short error until the setting is read. */
export function fromQuery<T>(q: UseQueryResult<T>, base: Omit<Row, "description" | "state">, read: (d: T) => Pick<Row, "state" | "description">): Row {
  if (q.data !== undefined) return { ...base, ...read(q.data) };
  return { ...base, description: q.error ? "Couldn't load this setting." : "Loading…" };
}

type Features = Schemas["AdminFeatures"];

/** Where the switches are (AD-39). */
const settingsLink = { action: "Settings", link: <Link to="/admin/settings" hash="features" /> };

/** The switch features' rows: their state, with a link to Admin → Settings. */
function useSwitchRows(): Row[] {
  const evaluations = useQuery(evaluationSettingsQuery());
  const mcp = useQuery(mcpSettingsQuery());
  const cache = useQuery(answerCacheSettingsQuery());
  return [
    fromQuery(evaluations, { id: "evaluations", icon: <ClipboardCheck />, title: "Evaluations", ...settingsLink }, (d) => ({
      state: d.enabled ? on : off,
      description: evaluationsText(d.enabled),
    })),
    fromQuery(mcp, { id: "mcp", icon: <Cable />, title: "MCP server", ...settingsLink }, (d) => ({ state: d.enabled ? on : off, description: mcpText(d.enabled) })),
    fromQuery(mcp, { id: "mcp-oauth", icon: <KeyRound />, title: "OAuth sign-in for MCP clients", badge: experimental, ...settingsLink }, oauthFeature),
    fromQuery(cache, { id: "answer-cache", icon: <DatabaseZap />, title: "Saved answers", ...settingsLink }, (d) => ({
      state: d.enabled ? on : off,
      description: answerCacheText(d.enabled),
    })),
  ];
}

export const experimental = (
  <Badge size="sm" tone="warning">
    Experimental
  </Badge>
);

function useRows(f: Features): Row[] {
  const rerank = rerankFeature(f.rerank, f.rerankModel);
  return [
    ...useSwitchRows(),
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

const cardProps = { id: "features", className: o.features, title: "Features", description: "Optional features: whether each is on, and where to set it up. The switches are in Settings." };

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
  return <FeatureList rows={useRows(features)} />;
}

/** The rows: icon, title with its state, the whole description, and the row's control or link (Overview and Settings). */
export function FeatureList({ rows }: { rows: Row[] }) {
  return (
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
  );
}
