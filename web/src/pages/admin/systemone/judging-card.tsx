/* Passage judging settings on Admin → SystemOne: the agents' default, candidates, mode, timeout and the routing thresholds. */
import { SettingsSection } from "@/components/templates/settings-page";
import { Field } from "@/components/ui/field/field";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Switch } from "@/components/ui/switch/switch";
import { thresholdFields, type SettingsForm } from "@/lib/systemone";
import s from "../../shared.module.css";
import so from "./systemone.module.css";
import { FeatureState } from "./state";

const modeOptions = [
  {
    value: "per_passage" as const,
    label: "One request per passage",
    description: "Recommended. Each passage is judged on its own; more requests, better separation.",
  },
  {
    value: "batched" as const,
    label: "One request for all passages",
    description: "For evaluation. Fewer requests, but less discriminating and not faster on a single GPU.",
  },
];

type Props = {
  form: SettingsForm;
  set: (patch: Partial<SettingsForm>) => void;
  problems: Record<string, string>;
  disabled: boolean;
  /** "Adds 180 ms (median, last 14 days)", from analytics. */
  latency?: string;
  /** Published agents it's on for (saved settings). */
  agents?: number;
};

export function JudgingCard({ form, set, problems, disabled, latency, agents }: Props) {
  return (
    <SettingsSection
      title="Passage judging"
      description="After retrieval, the model asks of each candidate passage: is it relevant, is it usable evidence, does it contradict the question, does it try to instruct the assistant? Passages are re-ranked, kept or dropped. A failed or slow request keeps its passage."
      actions={<FeatureState on={form.enabled} latency={latency} agents={agents} />}
    >
      <div className={so.judging}>
        <Switch
          label="Judge passages for every agent"
          description="The default for agents. Editors can turn it on or off per agent in the agent's Build tab."
          checked={form.enabled}
          disabled={disabled}
          onCheckedChange={(v) => set({ enabled: v })}
        />
        {form.enabled && (
          <>
            <div className={s.grid2}>
              <Field label="Candidates" description="How many fused passages are judged per search (1–50). Each is one request." error={problems.candidates}>
                <NumberInput maximumFractionDigits={0} disabled={disabled} value={form.candidates} onValueChange={(v) => set({ candidates: v })} />
              </Field>
              <Field label="Timeout per request (ms)" description="A slower request keeps its passage (500–60,000)." error={problems.timeoutMs}>
                <NumberInput maximumFractionDigits={0} disabled={disabled} value={form.timeoutMs} onValueChange={(v) => set({ timeoutMs: v })} />
              </Field>
            </div>
            <RadioGroup legend="Requests" variant="card" disabled={disabled} value={form.mode} onValueChange={(v) => set({ mode: v })} options={modeOptions} />
            <fieldset className={so.thresholds} disabled={disabled}>
              <legend className={so.legend}>Routing thresholds</legend>
              <p className={s.settingDescription}>Checked in this order; the first match decides.</p>
              <div className={so.thresholdGrid}>
                {thresholdFields.map((t) => (
                  <Field key={t.key} label={`${t.label} (%)`} description={t.description} error={problems[t.key]}>
                    <NumberInput maximumFractionDigits={0} unit="%" value={form.thresholds[t.key]} onValueChange={(v) => set({ thresholds: { ...form.thresholds, [t.key]: v } })} />
                  </Field>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
