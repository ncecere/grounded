/*
 * Admin → Costs (E2, docs/costs.md §5): Overview · Budgets · Prices ·
 * Settings as pill tabs. While the mode is Off only Prices and Settings show,
 * so prices can be entered before tracking starts. Platform admins change
 * things; auditors read.
 */
import { LayoutDashboard, Settings2, Tags, Wallet } from "lucide-react";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Loading } from "@/components/ui/spinner/spinner";
import { timeZoneNote, useCostSettings } from "@/lib/costs";
import { costTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { BudgetsTab } from "./budgets";
import { CostOverviewTab } from "./overview";
import { PricesTab } from "./prices";
import { CostSettingsTab } from "./settings";

export function CostsPage() {
  const settings = useCostSettings();
  const [tab, setTab] = useUrlTab(costTabs);
  const st = settings.data;
  const off = st?.mode === "off";
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Costs"
        description={`What model use costs, from the prices entered here, and each team's monthly budget, in the platform currency. ${timeZoneNote(st?.timeZone)} Analytics counts UTC days.`}
      />
      {settings.isLoading ? (
        <Loading label="Loading costs…" />
      ) : !st ? (
        <ErrorAlert error={settings.error} title="Couldn't load the cost settings" />
      ) : (
        <>
          {off && (
            <Alert tone="info" title="Cost tracking is off">
              Nothing is tracked or refused. You can enter prices now; choose Track only or Enforce under Settings to start.
            </Alert>
          )}
          <PageTabs
            label="Cost sections"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: "overview", label: "Overview", icon: <LayoutDashboard aria-hidden />, hidden: off, content: <CostOverviewTab settings={st} /> },
              { value: "budgets", label: "Budgets", icon: <Wallet aria-hidden />, hidden: off, content: <BudgetsTab /> },
              { value: "prices", label: "Prices", icon: <Tags aria-hidden />, content: <PricesTab /> },
              { value: "settings", label: "Settings", icon: <Settings2 aria-hidden />, content: <CostSettingsTab key={st.revision} settings={st} /> },
            ]}
          />
        </>
      )}
    </Stack>
  );
}
