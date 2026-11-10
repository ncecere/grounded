/*
 * Admin Overview › Features › Saved answers: the platform switch for the
 * answer cache (docs/answer-cache.md). On by default; each agent also has
 * its own setting (on by default for public agents). While off, no agent
 * reuses an answer; saved answers are kept until they expire. Platform
 * admins change it (If-Match, audited as platform.answer_cache), confirming
 * before they turn it off; auditors see it disabled, with the reason.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { FeatureSwitch, useFeatureSave } from "./feature-switch";
import { answerCacheSettingsQuery } from "./queries";

/** The answer cache switch and its save. */
export function useAnswerCacheSetting() {
  const settings = useQuery(answerCacheSettingsQuery());
  const save = useFeatureSave({
    put: async (enabled: boolean) => unwrap(await api.PUT("/v1/admin/settings/answer-cache", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    queryKey: answerCacheSettingsQuery().queryKey,
    saved: (st) => (st.enabled ? "Saved answers are on" : "Saved answers are off"),
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
  return (
    <FeatureSwitch
      label="Allow saved answers"
      enabled={settings.data?.enabled}
      save={save}
      isAdmin={isAdmin}
      off={{ title: "Turn saved answers off for every agent?", description: offConsequences, confirmLabel: "Turn saved answers off" }}
    />
  );
}
