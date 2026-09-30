/*
 * Admin Overview › Features › Evaluations: the platform switch for evaluation
 * sets (docs/evaluations.md §5; under Admin → Limits › Evaluations until
 * v0.2.1, I2). On by default; while off, the Evaluations tabs are hidden and
 * the evaluation API answers 404. Sets and runs are kept. Platform admins
 * change it (If-Match, audited as platform.evaluations), confirming before
 * they turn it off; auditors see it disabled, with the reason.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { AlertDialog } from "@/components/ui/dialog/dialog";
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

/** What evaluations do in their current state, for the Features row (short: the row shows it whole). */
export function evaluationsText(enabled: boolean) {
  return enabled
    ? "Team editors, admins and owners test knowledge bases and agents with question sets. Members never see them."
    : "Hidden from every team, and the evaluation API is closed. Sets and runs are kept.";
}

const offConsequences =
  "Every team's Evaluations tabs and pages disappear, the evaluation API is closed, and scheduled runs don't start. Sets, questions and past runs are kept, and come back when evaluations are turned on again.";

/** The switch: platform admins confirm before turning evaluations off; others see it disabled, with the reason. */
export function EvaluationsSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useEvaluationsSetting>; isAdmin: boolean }) {
  const { settings, save } = setting;
  const [confirming, setConfirming] = useState(false);
  if (!settings.data) return null;
  return (
    <>
      <Switch
        label="Allow evaluations"
        labelPosition="start"
        checked={settings.data.enabled}
        disabled={!isAdmin || save.isPending}
        description={isAdmin ? undefined : "Only platform admins can turn this on or off."}
        onCheckedChange={(v) => (v ? save.mutate(true) : setConfirming(true))}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn evaluations off for every team?"
        description={offConsequences}
        confirmLabel="Turn evaluations off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
