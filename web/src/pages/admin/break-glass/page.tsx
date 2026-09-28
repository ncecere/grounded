/*
 * Admin → Break-glass (ADR-0024, docs/phase5-deploy.md §5 P4): start a
 * session (team, reason, scope, duration), review requests waiting for a
 * second admin, and see every session with what it read. The Settings tab
 * holds the platform setting. Auditors see everything read-only.
 */
import { History, LockOpen, Settings2 } from "lucide-react";
import { useState } from "react";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { QueryView } from "@/components/query-view";
import { useRecordParam } from "@/components/templates/record-sheet";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { breakGlassTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { useBreakGlassSettings } from "./queries";
import { SessionSheet } from "./session-sheet";
import { AllSessionsList, OpenSessionsCard } from "./sessions";
import { BreakGlassSettingsForm } from "./settings";
import { StartDialog } from "./start-dialog";

export function BreakGlassPage() {
  const isAdmin = useIsPlatformAdmin();
  const [tab, setTab] = useUrlTab(breakGlassTabs);
  const record = useRecordParam();
  const settings = useBreakGlassSettings();
  const [starting, setStarting] = useState(false);
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Break-glass"
        description="Read one team's conversations or documents for a limited time, to investigate an incident or a support problem. Every read is recorded, and the team's owners are notified when a session starts and get a summary when it ends."
        actions={
          isAdmin && (
            <Button onClick={() => setStarting(true)} disabled={!settings.data}>
              <LockOpen aria-hidden /> Start a session
            </Button>
          )
        }
      />
      {!isAdmin && <Alert tone="info">Auditors can see sessions and what they read. Only platform admins can start, approve or end them.</Alert>}
      <PageTabs
        label="Break-glass sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          {
            value: "sessions",
            label: "Sessions",
            icon: <History aria-hidden />,
            content: (
              <Stack gap={6}>
                <OpenSessionsCard onOpen={record.open} />
                <AllSessionsList onOpen={record.open} />
              </Stack>
            ),
          },
          {
            value: "settings",
            label: "Settings",
            icon: <Settings2 aria-hidden />,
            content: (
              <QueryView query={settings} loadingLabel="Loading break-glass settings…">
                {settings.data && <BreakGlassSettingsForm key={settings.data.revision} saved={settings.data} isAdmin={isAdmin} />}
              </QueryView>
            ),
          },
        ]}
      />
      <SessionSheet id={record.id} onClose={record.close} />
      {starting && settings.data && (
        <StartDialog
          settings={settings.data}
          onClose={() => setStarting(false)}
          onStarted={(x) => {
            setStarting(false);
            record.open(x.id);
          }}
        />
      )}
    </Stack>
  );
}

export { BreakGlassConversationsPage } from "./conversations";
