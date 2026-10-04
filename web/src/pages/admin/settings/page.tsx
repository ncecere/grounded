/*
 * Admin → Settings (docs/v0.4.2.md AD-39, owner decision A): the platform's general settings in one place. The
 * currency, time zone and default monthly budget (moved from Costs → Settings, which keeps the cost tracking mode and
 * warning threshold), the feature switches (moved from Overview → Features, which keeps their state), what the
 * environment sets (read-only, with its variable), and links to the areas that keep their own settings pages.
 * Platform admins change things; auditors read them, with the reason.
 */
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Loading } from "@/components/ui/spinner/spinner";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { useCostSettings } from "@/lib/costs";
import { useInstance } from "@/session";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import o from "../overview/overview.module.css";
import { FeatureSwitches } from "./features";
import { GeneralSettings } from "./general";
import st from "./settings.module.css";

/** The areas that keep their own settings pages, with what each holds. */
const otherSettings: { name: string; link: ReactElement; holds: string }[] = [
  { name: "Costs", link: <Link to="/admin/costs" search={{ tab: "settings" }} />, holds: "Cost tracking (off, track only or enforce) and the budget warning threshold." },
  { name: "Moderation", link: <Link to="/admin/moderation" />, holds: "What each audience may be told, and the moderation provider." },
  { name: "Public access", link: <Link to="/admin/public-access" />, holds: "Whether agents can answer anonymous visitors, and the public page and widget." },
  { name: "Limits", link: <Link to="/admin/limits" />, holds: "Default limits and ceilings for every team, public caps and evaluation limits." },
  { name: "Retention", link: <Link to="/admin/retention" />, holds: "How long conversations, logs and deleted files are kept, and legal holds." },
  { name: "Reranking", link: <Link to="/admin/reranking" />, holds: "The rerank model, candidates and time limit." },
  { name: "SystemOne", link: <Link to="/admin/systemone" />, holds: "The model that judges passages, checks citations and spots out-of-scope questions." },
  { name: "Parsing & OCR", link: <Link to="/admin/parsing" />, holds: "How documents are read, OCR and its languages." },
];

/** What the environment sets: shown, never changed here. */
function EnvironmentCard() {
  const i = useInstance();
  const rows: [string, string | null, string][] = [
    ["Instance name", i.name, "INSTANCE_NAME"],
    ["Organisation name", i.orgName || null, "ORG_NAME"],
    // The colours; light or dark is each person's own choice (VI2-09).
    ["Colour theme", `${i.theme} (light or dark is each person's choice, in their account menu)`, "UI_THEME"],
    ["Logo", i.logoUrl, "UI_LOGO_URL"],
    ["Help link", i.supportUrl, "SUPPORT_URL"],
  ];
  return (
    <Card title="From the environment" description="Set by whoever runs Grounded, in its environment; a change applies after a restart. Shown here, never changed here.">
      <Table caption="Settings from the environment" columns={["Setting", "Value", "Variable"]} density="compact">
        {rows.map(([label, value, variable]) => (
          <Tr key={variable}>
            <Td>{label}</Td>
            <Td muted={!value}>{value ?? "Not set"}</Td>
            <Td>
              <code>{variable}</code>
            </Td>
          </Tr>
        ))}
      </Table>
    </Card>
  );
}

export function AdminSettingsPage() {
  const isAdmin = useIsPlatformAdmin();
  const costs = useCostSettings();
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title="Settings" description="The platform's general settings and feature switches. Areas with settings of their own are linked at the end." />
      {costs.isLoading ? (
        <Loading label="Loading settings…" />
      ) : costs.data ? (
        // Not keyed by the revision: a remount would throw the edits away on a save conflict (AD2-01).
        <GeneralSettings settings={costs.data} isAdmin={isAdmin} />
      ) : (
        <ErrorAlert error={costs.error} title="Couldn't load the settings" onRetry={() => void costs.refetch()} />
      )}
      <Card id="features" className={o.features} title="Features" description="Optional features for the whole platform. Each switch applies at once." flush>
        <FeatureSwitches isAdmin={isAdmin} />
      </Card>
      <EnvironmentCard />
      <Card title="Other settings" description="Areas that keep their settings on their own pages.">
        <ul className={st.links} aria-label="Other settings">
          {otherSettings.map((x) => (
            <li key={x.name}>
              <TextLink render={x.link}>{x.name}</TextLink>
              <span className={s.muted}>{x.holds}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
