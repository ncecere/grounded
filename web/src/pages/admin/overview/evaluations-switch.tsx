/*
 * Admin Overview › Features › Evaluations: the platform switch for evaluation
 * sets (docs/evaluations.md §5; under Admin → Limits › Evaluations until
 * v0.2.1, I2). On by default; while off, the Evaluations tabs are hidden and
 * the evaluation API answers 404. Sets and runs are kept. Platform admins
 * change it (If-Match, audited as platform.evaluations); auditors see its state.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { evaluationSettingsQuery } from "./queries";

/** The evaluations setting and its save. */
export function useEvaluationsSetting() {
  const qc = useQueryClient();
  const settings = useQuery(evaluationSettingsQuery());
  const save = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await api.PUT("/v1/admin/settings/evaluations", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    onSuccess: (st) => {
      qc.setQueryData(evaluationSettingsQuery().queryKey, st);
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(st.enabled ? "Evaluations are on" : "Evaluations are off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: evaluationSettingsQuery().queryKey }),
  });
  return { settings, save };
}

/** What evaluations do in their current state, for the Features row. */
export function evaluationsText(enabled: boolean) {
  return enabled
    ? "Team editors, admins and owners build sets of test questions for their knowledge bases and agents, and run them to catch regressions. Members never see them."
    : "The Evaluations tabs are hidden and the evaluation API is closed. Existing sets and runs are kept and come back when you turn this on; automatic runs don't start meanwhile.";
}

/** The switch for platform admins (auditors see the state as a badge); the Features card shows a failed save. */
export function EvaluationsSwitch({ setting }: { setting: ReturnType<typeof useEvaluationsSetting> }) {
  const { settings, save } = setting;
  if (!settings.data) return null;
  return <Switch label="Allow evaluations" labelPosition="start" checked={settings.data.enabled} disabled={save.isPending} onCheckedChange={(v) => save.mutate(v)} />;
}
