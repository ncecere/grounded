/*
 * Admin → Settings › Features › Content health reports (docs/content-health.md): the platform switch, off by default. Platform admins
 * change it (If-Match, audited as platform.content_health); auditors see it read-only. Platform staff see nothing of what teams'
 * reports hold. Off means no report can be made; reports that exist are kept and come back when it is turned on.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { lockedSwitch } from "./locked-switch";

const settingsQuery = () => ({
  queryKey: ["admin", "content-health-settings"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/content-health")),
  staleTime: 30_000,
});

/** The content health setting and its save. */
export function useContentHealthSetting() {
  const qc = useQueryClient();
  const settings = useQuery(settingsQuery());
  const save = useMutation({
    mutationFn: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/settings/content-health", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    onSuccess: (st) => {
      qc.setQueryData(settingsQuery().queryKey, st);
      void qc.invalidateQueries({ queryKey: ["team"] });
      toast.success(st.enabled ? "Content health reports are on" : "Content health reports are off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: settingsQuery().queryKey }),
  });
  return { settings, save };
}

export const contentHealthText = (enabled: boolean) =>
  enabled
    ? "Editors, admins and owners can ask for a report of their own team's sources: documents not processed in a long time, links a crawl saw fail, files in two sources, documents no answer cited, and documents that failed. Reports are made in the background, fetch nothing and use no model. Platform staff never see a team's reports."
    : "Off: no report can be made, and teams are told reports are switched off. Reports that exist are kept and come back when it is turned on.";

const offConsequences = "No new report can be made and one waiting to start ends as failed. Teams can't open their reports while it is off; stored reports are kept for their usual time and come back when it is turned on.";

export function ContentHealthSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useContentHealthSetting>; isAdmin: boolean }) {
  const { settings, save } = setting;
  const [confirming, setConfirming] = useState(false);
  if (!settings.data) return null;
  return (
    <>
      <Switch
        label="Allow content health reports"
        labelPosition="start"
        checked={settings.data.enabled}
        disabled={save.isPending}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(true) : setConfirming(true))}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn content health reports off?"
        description={offConsequences}
        confirmLabel="Turn reports off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
