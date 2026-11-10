/*
 * Admin → Settings › Features › Document permissions (B6, #41; docs/document-permissions.md): the platform switch, off by
 * default because a server of the previous release ignores restrictions. Platform admins turn it on once every server
 * runs this release (If-Match, audited as platform.document_permissions); auditors see it read-only. It can't be turned
 * off while any document is restricted (409 documents_restricted), so the switch is shown locked then.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { Switch } from "@/components/ui/switch/switch";
import { useFeatureSave } from "./feature-switch";
import { lockedSwitch } from "./locked-switch";

export const documentAccessQuery = () =>
  queryOptions({
    queryKey: ["admin", "document-access"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/document-access")),
  });

export function useDocumentAccessSetting() {
  const settings = useQuery(documentAccessQuery());
  const save = useFeatureSave({
    put: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/document-access", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    queryKey: documentAccessQuery().queryKey,
    // Reloaded, as before: the count of restricted documents comes with it.
    store: "invalidate",
    saved: (st) => (st.enabled ? "Document permissions are on" : "Document permissions are off"),
  });
  return { settings, save };
}

export const documentAccessText = (enabled: boolean, restricted: number) =>
  enabled
    ? restricted > 0
      ? `Editors can restrict a source to some groups and people (its Access tab). ${restricted.toLocaleString()} ${restricted === 1 ? "document is" : "documents are"} restricted now; remove every restriction before turning this off.`
      : "Editors can restrict a source to some groups and people (its Access tab). Its documents are then searched, used in answers and opened only for them."
    : "Off: no source can be restricted. Turn it on once every server runs this release: a server of an earlier release would ignore restrictions.";

export function DocumentAccessSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useDocumentAccessSetting>; isAdmin: boolean }) {
  const { settings, save } = setting;
  if (!settings.data) return null;
  const pinned = settings.data.enabled && settings.data.restrictedDocuments > 0;
  return (
    <Switch
      label="Allow document permissions"
      labelPosition="start"
      checked={settings.data.enabled}
      disabled={save.isPending || (isAdmin && pinned)}
      {...lockedSwitch(isAdmin)}
      onCheckedChange={(v) => save.mutate(v)}
    />
  );
}
