/*
 * Admin → Retention (docs/phase5-deploy.md §5 P3, docs/operations/retention.md):
 * the periods per kind of data and classification level, the dry run of what
 * would be deleted now, the runs and the legal holds, as pill tabs
 * (?tab=settings|report|runs|holds; Legal holds was a page of its own until
 * v0.2.1, I1). Platform admins change periods, run retention and place holds
 * ("Place a hold", the header's primary on Legal holds); auditors read everything.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History, ListChecks, Scale, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { QueryView } from "@/components/query-view";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { TextLink } from "@/components/ui/text-link/text-link";
import { retentionTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { PlaceHoldDialog } from "./hold-dialogs";
import { LegalHoldsTab } from "./holds";
import { RetentionReportTab } from "./report";
import { RetentionRunsTab } from "./runs";
import { RetentionSettingsTab, retentionKey } from "./settings";

export function RetentionPage() {
  const isAdmin = useIsPlatformAdmin();
  const [tab, setTab] = useUrlTab(retentionTabs);
  const [placing, setPlacing] = useState(false);
  const settings = useQuery({ queryKey: retentionKey, queryFn: async () => unwrap(await api.GET("/v1/admin/retention")) });
  const onHolds = tab === "holds";
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Retention"
        description={
          onHolds ? (
            "A legal hold stops every retention deletion of what it covers, including conversations their users delete, until you release it. Holds never expire. Only platform admins and auditors see them."
          ) : (
            <>
              How long each kind of data is kept before it's deleted for good. Nothing is deleted until you set a period, and{" "}
              <TextLink render={<Link to="/admin/retention" search={{ tab: "holds" }} />}>legal holds</TextLink> keep what they cover.
            </>
          )
        }
        actions={onHolds && isAdmin && <Button onClick={() => setPlacing(true)}>Place a hold</Button>}
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
          { value: "holds", label: "Legal holds", icon: <Scale aria-hidden />, content: <LegalHoldsTab isAdmin={isAdmin} onPlace={() => setPlacing(true)} /> },
        ]}
      />
      {placing && <PlaceHoldDialog onClose={() => setPlacing(false)} />}
    </Stack>
  );
}
