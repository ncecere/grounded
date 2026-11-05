/*
 * Admin → Settings › Features › Audit streaming (docs/specs/audit-streaming/DESIGN.md): the platform switch, off by default. Platform
 * admins change it (If-Match, audited as platform.audit_streaming), confirming before they turn it off; auditors see it read-only. Off
 * pauses every destination where it is; on resumes them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { auditStreamQuery } from "../logs/streaming/queries";
import { lockedSwitch } from "./locked-switch";

export function useAuditStreamSetting() {
  const qc = useQueryClient();
  const stream = useQuery(auditStreamQuery());
  const save = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await api.PUT("/v1/admin/audit-stream/settings", { params: { header: ifMatch(stream.data!.settings.revision) }, body: { enabled } })),
    onSuccess: (st) => {
      void qc.invalidateQueries({ queryKey: auditStreamQuery().queryKey });
      toast.success(st.enabled ? "Audit streaming is on" : "Audit streaming is off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: auditStreamQuery().queryKey }),
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
  const [confirming, setConfirming] = useState(false);
  if (!stream.data) return null;
  return (
    <>
      <Switch
        label="Allow audit streaming"
        labelPosition="start"
        checked={stream.data.settings.enabled}
        disabled={save.isPending}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(true) : setConfirming(true))}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn audit streaming off?"
        description={offConsequences}
        confirmLabel="Turn audit streaming off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
