/*
 * Admin → Logs (D6, A3): pill tabs (?tab=) for the platform audit log and the
 * access log (one filter-bar template; filters, the date range and the open
 * entry ?record= live in the URL), the signed daily exports (#36) and
 * streaming to a SIEM (docs/specs/audit-streaming/DESIGN.md).
 */
import { FileClock, FileSignature, RadioTower, ScrollText } from "lucide-react";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { logTabs } from "@/lib/tabs";
import { terms } from "@/lib/terms";
import s from "../../shared.module.css";
import { AccessLogTab } from "./access";
import { AuditLogTab } from "./audit";
import { SignedExports } from "./signed-exports";
import { StreamingTab } from "./streaming/tab";

export function LogsPage() {
  const [tab, setTab] = useUrlTab(logTabs);
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={terms.logs}
        // One description for both tabs, so the tabs don't move.
        description="Every administrative and membership change on the platform, and every use of a Sensitive or Restricted agent: who, which agent and version, and the channel. Never questions or answers. Signed daily exports and streaming send the audit facts elsewhere."
      />
      <PageTabs
        label="Log sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "audit", label: terms.auditLog, crumb: "Audit", icon: <FileClock aria-hidden />, content: <AuditLogTab /> },
          { value: "access", label: terms.accessLog, crumb: "Access", icon: <ScrollText aria-hidden />, content: <AccessLogTab /> },
          { value: "exports", label: "Signed exports", icon: <FileSignature aria-hidden />, content: <SignedExports /> },
          { value: "streaming", label: "Streaming", icon: <RadioTower aria-hidden />, content: <StreamingTab /> },
        ]}
      />
    </Stack>
  );
}
