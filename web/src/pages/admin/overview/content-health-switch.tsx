/*
 * Admin → Settings › Features › Content health reports (docs/content-health.md): the platform switch, off by default. Platform admins
 * change it (If-Match, audited as platform.content_health); auditors see it read-only. Platform staff see nothing of what teams'
 * reports hold. Off means no report can be made; reports that exist are kept and come back when it is turned on.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { FeatureSwitch, useFeatureSave } from "./feature-switch";

const settingsQuery = () => ({
  queryKey: ["admin", "content-health-settings"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/content-health")),
  staleTime: 30_000,
});

/** The content health setting and its save. */
export function useContentHealthSetting() {
  const settings = useQuery(settingsQuery());
  const save = useFeatureSave({
    put: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/settings/content-health", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    queryKey: settingsQuery().queryKey,
    alsoInvalidate: [["team"]],
    saved: (st) => (st.enabled ? "Content health reports are on" : "Content health reports are off"),
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
  return (
    <FeatureSwitch
      label="Allow content health reports"
      enabled={settings.data?.enabled}
      save={save}
      isAdmin={isAdmin}
      off={{ title: "Turn content health reports off?", description: offConsequences, confirmLabel: "Turn reports off" }}
    />
  );
}
