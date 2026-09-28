/*
 * Admin → Retention (docs/phase5-deploy.md §5 P3, docs/operations/retention.md):
 * the periods per kind of data and classification level, the dry run of what
 * would be deleted now, and the runs, as pill tabs (?tab=settings|report|runs).
 * Platform admins change periods and run retention; auditors read everything.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History, ListChecks, SlidersHorizontal } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { QueryView } from "@/components/query-view";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { TextLink } from "@/components/ui/text-link/text-link";
import { retentionTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { RetentionReportTab } from "./report";
import { RetentionRunsTab } from "./runs";
import { RetentionSettingsTab, retentionKey } from "./settings";

export function RetentionPage() {
  const isAdmin = useIsPlatformAdmin();
  const [tab, setTab] = useUrlTab(retentionTabs);
  const settings = useQuery({ queryKey: retentionKey, queryFn: async () => unwrap(await api.GET("/v1/admin/retention")) });
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Retention"
        description={
          <>
            How long each kind of data is kept before it's deleted for good. Nothing is deleted until you set a period, and{" "}
            <TextLink render={<Link to="/admin/legal-holds" />}>legal holds</TextLink> keep what they cover.
          </>
        }
      />
      <PageTabs
        label="Retention sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          {
            value: "settings",
            label: "Periods",
            icon: <SlidersHorizontal aria-hidden />,
            content: (
              <QueryView query={settings} loadingLabel="Loading retention periods…">
                {settings.data && <RetentionSettingsTab key={settings.data.revision} saved={settings.data} isAdmin={isAdmin} />}
              </QueryView>
            ),
          },
          { value: "report", label: "Dry run", icon: <ListChecks aria-hidden />, content: <RetentionReportTab settings={settings.data} /> },
          { value: "runs", label: "Runs", icon: <History aria-hidden />, content: <RetentionRunsTab isAdmin={isAdmin} /> },
        ]}
      />
    </Stack>
  );
}
