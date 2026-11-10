/*
 * Admin → Settings › Features › Webhooks (v0.6.0, F3): the platform switch for webhooks, off by default. Platform admins change it (If-Match,
 * audited as platform.webhooks), confirming before they turn it off; auditors see it read-only, with the reason. Off means no new webhooks,
 * no events recorded and nothing sent; the webhooks that exist are kept, and turning it on again resumes them.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { webhookSettingsQuery } from "../../webhooks/api";
import { FeatureSwitch, useFeatureSave } from "./feature-switch";

/** The webhook setting and its save. */
export function useWebhookSettings() {
  const settings = useQuery(webhookSettingsQuery());
  const save = useFeatureSave({
    put: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/settings/webhooks", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    queryKey: webhookSettingsQuery().queryKey,
    // Team settings shows its Webhooks tab by the capability.
    alsoInvalidate: [["me"]],
    saved: (st) => (st.enabled ? "Webhooks are on" : "Webhooks are off"),
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
  return (
    <FeatureSwitch
      label="Allow webhooks"
      enabled={settings.data?.enabled}
      save={save}
      isAdmin={isAdmin}
      off={{ title: "Turn webhooks off?", description: offConsequences, confirmLabel: "Turn webhooks off" }}
    />
  );
}
