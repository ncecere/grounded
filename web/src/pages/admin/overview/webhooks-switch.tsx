/*
 * Admin → Settings › Features › Webhooks (v0.6.0, F3): the platform switch for webhooks, off by default. Platform admins change it (If-Match,
 * audited as platform.webhooks), confirming before they turn it off; auditors see it read-only, with the reason. Off means no new webhooks,
 * no events recorded and nothing sent; the webhooks that exist are kept, and turning it on again resumes them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { webhookSettingsQuery } from "../../webhooks/api";
import { lockedSwitch } from "./locked-switch";

/** The webhook setting and its save. */
export function useWebhookSettings() {
  const qc = useQueryClient();
  const settings = useQuery(webhookSettingsQuery());
  const save = useMutation({
    mutationFn: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/settings/webhooks", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    onSuccess: (st) => {
      qc.setQueryData(webhookSettingsQuery().queryKey, st);
      // Team settings shows its Webhooks tab by the capability.
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(st.enabled ? "Webhooks are on" : "Webhooks are off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: webhookSettingsQuery().queryKey }),
  });
  return { settings, save };
}

/** What webhooks do in their current state, for the Features row. */
export const webhooksText = (enabled: boolean) =>
  enabled
    ? "Team admins and owners can send their team's events to approved HTTPS destinations (Team settings → Webhooks), and platform admins can send platform events (Admin → Webhooks). Every webhook and change is audited."
    : "Off: no webhooks can be made, no events are recorded and nothing is sent. Webhooks that already exist are kept.";

const offConsequences =
  "Webhooks stop at once: no new ones can be made, no events are recorded and nothing is sent, including by webhooks that exist. The Webhooks tab leaves Team settings. Existing webhooks and their delivery logs are kept, and turning webhooks on again resumes them.";

/** The switch: platform admins confirm before turning webhooks off; others see it read-only, with the reason. */
export function WebhooksSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useWebhookSettings>; isAdmin: boolean }) {
  const { settings, save } = setting;
  const [confirming, setConfirming] = useState(false);
  if (!settings.data) return null;
  return (
    <>
      <Switch
        label="Allow webhooks"
        labelPosition="start"
        checked={settings.data.enabled}
        disabled={save.isPending}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(true) : setConfirming(true))}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn webhooks off?"
        description={offConsequences}
        confirmLabel="Turn webhooks off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
