/*
 * Admin Overview › Features (docs/v0.2.1.md I2): one row per optional feature
 * with its state and a link to where it's set up. Evaluations has its switch
 * here (platform admins; auditors see it disabled, with the reason). Each row
 * reads the same query as the feature's own page, so one failure doesn't hide
 * the others, and shows its whole description (not clamped).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleDollarSign, ClipboardCheck, Earth, Network, ScanText, Sparkles, Wrench } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item/item";
import { costSettingsQuery } from "@/lib/costs";
import { backendLabels } from "@/lib/parsing";
import { terms } from "@/lib/terms";
import { budgetsQuery } from "../costs/budgets";
import { groupMappingStatusQuery } from "../group-mapping/queries";
import { useIsPlatformAdmin } from "../hooks";
import { EvaluationsSwitch, evaluationsText, useEvaluationsSetting } from "./evaluations-switch";
import { costFeature, type FeatureState, plural, systemOneFeature } from "./feature-text";
import { maintenanceSettingsQuery, parsingSettingsQuery, publicAccessQuery, systemOneSettingsQuery } from "./queries";
import o from "./overview.module.css";

type Row = {
  id: string;
  icon: ReactNode;
  title: string;
  state?: FeatureState;
  description: ReactNode;
  link?: ReactElement;
  action?: string;
  control?: ReactNode;
};

const on: FeatureState = { label: "On", tone: "success" };
const off: FeatureState = { label: "Off", tone: "neutral" };

/** A row from its query: "Loading…" or a short error until the setting is read. */
function fromQuery<T>(q: UseQueryResult<T>, base: Omit<Row, "description" | "state">, read: (d: T) => Pick<Row, "state" | "description">): Row {
  if (q.data !== undefined) return { ...base, ...read(q.data) };
  return { ...base, description: q.error ? "Couldn't load this setting." : "Loading…" };
}

function useRows(isAdmin: boolean, evaluations: ReturnType<typeof useEvaluationsSetting>): Row[] {
  const costs = useQuery(costSettingsQuery());
  // Teams whose own mode differs from the platform's (Costs → Budgets).
  const budgets = useQuery(budgetsQuery());
  const parsing = useQuery(parsingSettingsQuery());
  const sso = useQuery(groupMappingStatusQuery());
  const systemOne = useQuery(systemOneSettingsQuery());
  const access = useQuery(publicAccessQuery());
  const maintenance = useQuery(maintenanceSettingsQuery());
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
    fromQuery(costs, { id: "costs", icon: <CircleDollarSign />, title: "Cost tracking", action: "Cost settings", link: <Link to="/admin/costs" search={{ tab: "settings" }} /> }, (d) =>
      costFeature(d.mode, budgets.data?.items),
    ),
    fromQuery(parsing, { id: "ocr", icon: <ScanText />, title: "OCR", action: "Parsing & OCR", link: <Link to="/admin/parsing" /> }, (d) => ({
      state: d.ocrEnabled ? { label: `On · ${backendLabels[d.backend]}`, tone: "success" } : off,
      description: d.ocrEnabled ? `Scanned PDF pages and image uploads are read with ${backendLabels[d.backend]}; each source can turn it off.` : "Scanned PDF pages and images are not read.",
    })),
    fromQuery(sso, { id: "sso", icon: <Network />, title: terms.groupMapping, action: terms.groupMapping, link: <Link to="/admin/group-mapping" /> }, (d) => ({
      state: { label: plural(d.ruleCount, "rule", "rules"), tone: d.ruleCount > 0 ? "info" : "neutral" },
      description: d.ruleCount > 0 ? "People get team roles from their identity-provider groups when they sign in." : "No rules: team members are added by hand.",
    })),
    fromQuery(systemOne, { id: "systemone", icon: <Sparkles />, title: "SystemOne", action: "SystemOne", link: <Link to="/admin/systemone" /> }, systemOneFeature),
    fromQuery(access, { id: "public", icon: <Earth />, title: "Public access", action: "Public access", link: <Link to="/admin/public-access" /> }, (d) => ({
      state: d.publicAgentsEnabled ? on : off,
      description: d.publicAgentsEnabled ? "Anonymous visitors can chat with agents published to the public." : "No agent answers anonymous visitors.",
    })),
    fromQuery(maintenance, { id: "maintenance", icon: <Wrench />, title: "Maintenance", action: "Maintenance", link: <Link to="/admin/maintenance" /> }, (d) => ({
      state: d.enabled ? { label: "On", tone: "warning" } : off,
      description: d.enabled ? `New ingestion is paused${d.reason ? `: ${d.reason}` : "."}` : "Ingestion runs as usual.",
    })),
  ];
}

export function FeaturesCard() {
  const isAdmin = useIsPlatformAdmin();
  const evaluations = useEvaluationsSetting();
  const rows = useRows(isAdmin, evaluations);
  return (
    <Card id="features" className={o.features} title="Features" description="Optional features, whether each is on, and where it's set up." flush>
      {evaluations.save.error != null && (
        <div className={o.cardAlert}>
          <ErrorAlert error={evaluations.save.error} title="Couldn't change evaluations" />
        </div>
      )}
      <ItemGroup className={o.queue}>
        {rows.map((r) => (
          <Item key={r.id} size="sm" className={o.row}>
            <ItemMedia variant="icon" aria-hidden>
              {r.icon}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {r.title}
                {r.state && (
                  <StatusBadge size="sm" tone={r.state.tone}>
                    {r.state.label}
                  </StatusBadge>
                )}
              </ItemTitle>
              {/* The whole sentence: what a feature does, or what turning it off hides, matters here. */}
              <ItemDescription className={o.fullText}>{r.description}</ItemDescription>
            </ItemContent>
            {(r.control || r.link) && (
              <ItemActions className={r.control ? `${o.rowActions} ${o.actionsBelow}` : o.rowActions}>
                {r.control}
                {r.link && (
                  <Button size="sm" variant="secondary" render={r.link}>
                    {r.action} <ArrowRight aria-hidden />
                  </Button>
                )}
              </ItemActions>
            )}
          </Item>
        ))}
      </ItemGroup>
    </Card>
  );
}
