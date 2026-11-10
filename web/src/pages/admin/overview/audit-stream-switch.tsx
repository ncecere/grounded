/*
 * Admin → Settings › Features › Audit streaming (docs/specs/audit-streaming/DESIGN.md): the platform switch, off by default. Platform
 * admins change it (If-Match, audited as platform.audit_streaming), confirming before they turn it off; auditors see it read-only. Off
 * pauses every destination where it is; on resumes them.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { auditStreamQuery } from "../logs/streaming/queries";
import { FeatureSwitch, useFeatureSave } from "./feature-switch";

export function useAuditStreamSetting() {
  const stream = useQuery(auditStreamQuery());
  const save = useFeatureSave({
    put: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/audit-stream/settings", { params: { header: ifMatch(stream.data!.settings.revision) }, body: { enabled } })),
    queryKey: auditStreamQuery().queryKey,
    // The query holds the destinations too: reloaded, not replaced by the settings.
    store: "invalidate",
    saved: (st) => (st.enabled ? "Audit streaming is on" : "Audit streaming is off"),
  });
  // The Features list reads { enabled } like the other settings.
  const settings = useQuery({ ...auditStreamQuery(), select: (d) => d.settings });
  return { settings, save, stream };
}

export const auditStreamText = (enabled: boolean) =>
  enabled
    ? "Platform admins can send every new audit entry to a SIEM over HTTPS (Splunk HEC or NDJSON) or syslog over TLS (Admin → Logs → Streaming). Only the audit facts are sent, never content."
    : "Off: no audit entries are streamed and no destinations can be added. Destinations that exist are kept and continue where they stopped when it's turned on.";

const offConsequences =
  "Every streaming destination pauses at once, where it is. Nothing is lost while the audit log keeps the entries: turning streaming on again sends what was written meanwhile.";

export function AuditStreamSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useAuditStreamSetting>; isAdmin: boolean }) {
  const { stream, save } = setting;
  return (
    <FeatureSwitch
      label="Allow audit streaming"
      enabled={stream.data?.settings.enabled}
      save={save}
      isAdmin={isAdmin}
      off={{ title: "Turn audit streaming off?", description: offConsequences, confirmLabel: "Turn audit streaming off" }}
    />
  );
}
