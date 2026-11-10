/*
 * Admin Overview › Features › Evaluations: the platform switch for evaluation
 * sets (docs/evaluations.md §5; under Admin → Limits › Evaluations until
 * v0.2.1, I2). On by default; while off, the Evaluations tabs are hidden and
 * the evaluation API answers 404. Sets and runs are kept. Platform admins
 * change it (If-Match, audited as platform.evaluations), confirming before
 * they turn it off; auditors see it disabled, with the reason.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { FeatureSwitch, useFeatureSave } from "./feature-switch";
import { evaluationSettingsQuery } from "./queries";

/** The evaluations setting and its save. */
export function useEvaluationsSetting() {
  const settings = useQuery(evaluationSettingsQuery());
  const save = useFeatureSave({
    put: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/settings/evaluations", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    queryKey: evaluationSettingsQuery().queryKey,
    alsoInvalidate: [["me"]],
    saved: (st) => (st.enabled ? "Evaluations are on" : "Evaluations are off"),
  });
  return { settings, save };
}

/** What evaluations do in their current state, for the Features row (short: the row shows it whole). */
export function evaluationsText(enabled: boolean) {
  return enabled
    ? "Team editors, admins and owners test knowledge bases and agents with question sets. Members never see them."
    : "Hidden from every team, and the evaluation API is closed. Sets and runs are kept.";
}

const offConsequences =
  "Every team's Evaluations tabs and pages disappear, the evaluation API is closed, and scheduled runs don't start. Sets, questions and past runs are kept, and come back when evaluations are turned on again.";

/** The switch: platform admins confirm before turning evaluations off; others see it read-only, with the reason. */
export function EvaluationsSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useEvaluationsSetting>; isAdmin: boolean }) {
  const { settings, save } = setting;
  return (
    <FeatureSwitch
      label="Allow evaluations"
      enabled={settings.data?.enabled}
      save={save}
      isAdmin={isAdmin}
      off={{ title: "Turn evaluations off for every team?", description: offConsequences, confirmLabel: "Turn evaluations off" }}
    />
  );
}
