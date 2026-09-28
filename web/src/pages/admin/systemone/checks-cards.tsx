/* Citation checks and the scope check on Admin → SystemOne (docs/systemone.md §3-§4): the agents' defaults and their thresholds. */
import { SettingsSection } from "@/components/templates/settings-page";
import { Field } from "@/components/ui/field/field";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Switch } from "@/components/ui/switch/switch";
import type { SettingsForm } from "@/lib/systemone";
import s from "../../shared.module.css";
import so from "./systemone.module.css";
import { FeatureState } from "./state";

type Props = {
  form: SettingsForm;
  set: (patch: Partial<SettingsForm>) => void;
  problems: Record<string, string>;
  disabled: boolean;
  /** "Adds 180 ms (median, last 14 days)", from analytics. */
  latency?: string;
};

const citationModes = [
  {
    value: "annotate" as const,
    label: "Annotate",
    description: "Recommended. Citations get a check when the source supports the claim and a warning when it doesn't. The answer is not changed.",
  },
  {
    value: "enforce" as const,
    label: "Enforce",
    description: "Also removes citations whose source confidently doesn't support the claim. A strictly grounded agent none of whose claims is supported answers with its refusal instead.",
  },
];

export function CitationsCard({ form, set, problems, disabled, latency }: Props) {
  const c = form.citations;
  const patch = (p: Partial<SettingsForm["citations"]>) => set({ citations: { ...c, ...p } });
  return (
    <SettingsSection
      title="Citation checks"
      description="After an answer, the model reads each cited source and says whether it supports, contradicts or says nothing about the sentence citing it. Streamed chats show the marks a moment later; buffered and API answers wait for the check."
      actions={<FeatureState on={c.enabled} latency={latency} />}
    >
      <div className={so.judging}>
        <Switch
          label="Check citations for every agent"
          description="The default for agents. Editors can turn it on or off, and choose the mode, per agent in the agent's Build tab."
          checked={c.enabled}
          disabled={disabled}
          onCheckedChange={(v) => patch({ enabled: v })}
        />
        {c.enabled && (
          <>
            <RadioGroup legend="Mode" variant="card" disabled={disabled} value={c.mode} onValueChange={(v) => patch({ mode: v })} options={citationModes} />
            <div className={s.grid2}>
              <Field
                label="Auto-accept confidence (%)"
                description="Verdicts at or above it stand on their own: only these remove citations in enforce mode. Lower ones are counted for review in analytics."
                error={problems.autoAccept}
              >
                <NumberInput maximumFractionDigits={0} unit="%" disabled={disabled} value={c.autoAccept} onValueChange={(v) => patch({ autoAccept: v })} />
              </Field>
              <Field label="Timeout per answer (ms)" description="Claims not checked by then stay unmarked (500–60,000)." error={problems.citationTimeoutMs}>
                <NumberInput maximumFractionDigits={0} disabled={disabled} value={c.timeoutMs} onValueChange={(v) => patch({ timeoutMs: v })} />
              </Field>
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  );
}

export function ScopeCard({ form, set, problems, disabled, latency }: Props) {
  const c = form.scope;
  const patch = (p: Partial<SettingsForm["scope"]>) => set({ scope: { ...c, ...p } });
  return (
    <SettingsSection
      title="Scope check"
      description="Before searching, the model says whether the message is small talk and whether it's about the agent's subject. Small talk gets a short reply without a search; a strictly grounded agent refuses an out-of-scope question without a search."
      actions={<FeatureState on={c.enabled} latency={latency} />}
    >
      <div className={so.judging}>
        <Switch
          label="Check the scope for every agent"
          description="The default for agents; editors can turn it on or off per agent. If the check fails or times out, the message is answered normally."
          checked={c.enabled}
          disabled={disabled}
          onCheckedChange={(v) => patch({ enabled: v })}
        />
        {c.enabled && (
          <div className={so.thresholdGrid}>
            <Field label="Small talk (%)" description="At or above: answered as small talk, without a search." error={problems.smallTalk}>
              <NumberInput maximumFractionDigits={0} unit="%" disabled={disabled} value={c.smallTalk} onValueChange={(v) => patch({ smallTalk: v })} />
            </Field>
            <Field label="In scope (%)" description="Below: out of scope. Keep it low: a strict agent refuses these." error={problems.inScope}>
              <NumberInput maximumFractionDigits={0} unit="%" disabled={disabled} value={c.inScope} onValueChange={(v) => patch({ inScope: v })} />
            </Field>
            <Field label="Timeout (ms)" description="500–60,000." error={problems.scopeTimeoutMs}>
              <NumberInput maximumFractionDigits={0} disabled={disabled} value={c.timeoutMs} onValueChange={(v) => patch({ timeoutMs: v })} />
            </Field>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
