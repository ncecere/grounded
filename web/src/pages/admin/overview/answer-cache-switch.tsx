/*
 * Admin Overview › Features › Saved answers: the platform switch for the
 * answer cache (docs/answer-cache.md). On by default; each agent also has
 * its own setting (on by default for public agents). While off, no agent
 * reuses an answer; saved answers are kept until they expire. Platform
 * admins change it (If-Match, audited as platform.answer_cache), confirming
 * before they turn it off; auditors see it disabled, with the reason.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { lockedSwitch } from "./locked-switch";
import { answerCacheSettingsQuery } from "./queries";

/** The answer cache switch and its save. */
export function useAnswerCacheSetting() {
  const qc = useQueryClient();
  const settings = useQuery(answerCacheSettingsQuery());
  const save = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await api.PUT("/v1/admin/settings/answer-cache", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    onSuccess: (st) => {
      qc.setQueryData(answerCacheSettingsQuery().queryKey, st);
      toast.success(st.enabled ? "Saved answers are on" : "Saved answers are off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: answerCacheSettingsQuery().queryKey }),
  });
  return { settings, save };
}

/** What the answer cache does in its current state, for the Features row. */
export function answerCacheText(enabled: boolean) {
  return enabled
    ? "Agents reuse a recent answer to the same question: at once, at no model cost. On by default for public agents; each agent has its own setting."
    : "No agent reuses an answer: every question is answered afresh. Saved answers expire as usual.";
}

const offConsequences =
  "Every agent answers each question afresh, at the usual model cost and speed. Saved answers aren't used and expire as usual; agents' own settings are kept.";

/** The switch: platform admins confirm before turning it off; others see it read-only, with the reason. */
export function AnswerCacheSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useAnswerCacheSetting>; isAdmin: boolean }) {
  const { settings, save } = setting;
  const [confirming, setConfirming] = useState(false);
  if (!settings.data) return null;
  return (
    <>
      <Switch
        label="Allow saved answers"
        labelPosition="start"
        checked={settings.data.enabled}
        disabled={save.isPending}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(true) : setConfirming(true))}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn saved answers off for every agent?"
        description={offConsequences}
        confirmLabel="Turn saved answers off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
