/* Queries and labels for SSO group mapping (Admin → Group mapping, and a team's Group mapping tab). */
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";

export type GroupRule = Schemas["GroupRule"];
export type GroupRuleChange = Schemas["GroupRuleChange"];
export type PreviewRequest = Schemas["GroupRulePreviewRequest"];

/** Every rule query starts with this key, so one invalidation refreshes them all. */
export const groupRulesRoot = ["admin", "group-mapping"] as const;

/** The rules; with a team (slug), only that team's. */
export const groupRulesQuery = (team?: string) =>
  queryOptions({
    queryKey: [...groupRulesRoot, "rules", team ?? ""],
    queryFn: async () =>
      unwrap(
        await api.GET("/v1/admin/group-mapping/rules", {
          params: { query: { team: team || undefined } },
        }),
      ),
  });

export const groupMappingStatusQuery = () =>
  queryOptions({
    queryKey: [...groupRulesRoot, "status"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/group-mapping")),
  });

/** The dry run of a rule change (changes nothing; auditors may run it too). */
export const groupRulePreviewQuery = (body: PreviewRequest, enabled = true) =>
  queryOptions({
    queryKey: [...groupRulesRoot, "preview", body],
    queryFn: async () => unwrap(await api.POST("/v1/admin/group-mapping/preview", { body })),
    enabled,
  });

/** What a change does to one person, as a sentence fragment after their name. */
export const changeLabels: Record<GroupRuleChange["kind"], string> = {
  add: "Added",
  raise: "Role raised",
  lower: "Role lowered",
  remove: "Removed",
  manual: "Left alone: added by hand",
  last_owner: "Kept: the team's last owner",
};

/** Kinds that change a membership (the others are listed for information). */
export const changingKinds: GroupRuleChange["kind"][] = ["add", "raise", "lower", "remove"];

/** "2 added, 1 removed" for the changes that do something. */
export function summarizeChanges(changes: GroupRuleChange[]) {
  const words: Record<string, string> = {
    add: "added",
    raise: "raised",
    lower: "lowered",
    remove: "removed",
  };
  const parts = changingKinds
    .map((k) => [k, changes.filter((c) => c.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${words[k]}`);
  return parts.length ? parts.join(", ") : "No one changes";
}
