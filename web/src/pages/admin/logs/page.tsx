/*
 * Admin → Logs (D6, A3): the platform audit log and the access log as pill
 * tabs (?tab=audit|access) on one filter-bar template. Filters, the date
 * range and the open entry (?record=) live in the URL.
 */
import { FileClock, ScrollText } from "lucide-react";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { logTabs } from "@/lib/tabs";
import { terms } from "@/lib/terms";
import s from "../../shared.module.css";
import { AccessLogTab } from "./access";
import { AuditLogTab } from "./audit";

export function LogsPage() {
  const [tab, setTab] = useUrlTab(logTabs);
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={terms.logs}
        // One description for both tabs, so the tabs don't move.
        description="Every administrative and membership change on the platform, and every use of a Sensitive or Restricted agent: who, which agent and version, and the channel. Never questions or answers."
      />
      <PageTabs
        label="Log sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "audit", label: terms.auditLog, crumb: "Audit", icon: <FileClock aria-hidden />, content: <AuditLogTab /> },
          { value: "access", label: terms.accessLog, crumb: "Access", icon: <ScrollText aria-hidden />, content: <AccessLogTab /> },
        ]}
      />
    </Stack>
  );
}
