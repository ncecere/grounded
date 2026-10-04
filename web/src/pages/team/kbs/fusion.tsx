/*
 * A knowledge base's hybrid fusion weights (W4): "Use the default" or its own
 * vector and keyword weights on sliders (0–1). The weights in effect and
 * where they come from are always shown; an invalid pair (both 0) is never
 * summarised as if it applied (F-26).
 */
import { Alert } from "@/components/ui/alert/alert";
import { Slider } from "@/components/ui/slider/slider";
import { Switch } from "@/components/ui/switch/switch";
import type { KB } from "../common";
import { type FusionForm, describeWeights, fusionErrors, weightsSourceLabel } from "./fusion-form";
import k from "./kbs.module.css";

type Props = { kb: KB; value: FusionForm; onChange: (next: FusionForm) => void };

const fallback = { vector: 1, keyword: 1 };

/** Weights are set in hundredths, so a default such as 0.02 can be shown and chosen again (BU-14); arrow keys move 0.01, Page Up/Down 0.1. */
const step = 0.01;
const hundredths = (n: number) => Math.round(n * 100) / 100;

const num = (t: string) => {
  const n = Number(t);
  return Number.isFinite(n) ? hundredths(Math.min(1, Math.max(0, n))) : 0;
};

/** The slider's value as the form's text, without floating-point noise ("0.02", not "0.019999999552965164"). */
export const sliderText = (v: number | readonly number[]) => String(hundredths(Array.isArray(v) ? (v[0] ?? 0) : (v as number)));

/** What the form would apply, or why it can't (F-26). */
export function fusionSummary(kb: KB, value: FusionForm): string {
  if (Object.keys(fusionErrors(value)).length > 0) return "Not saved: fix the highlighted field";
  if (value.useDefault) {
    // While the KB has its own weights, the default it would return to isn't known here.
    return kb.fusionWeights ? "The default weights (the embedding profile's, else the platform's)" : `${describeWeights(kb.effectiveFusionWeights ?? fallback)} (${weightsSourceLabel(kb.fusionWeightsSource)})`;
  }
  return `${describeWeights({ vector: num(value.vector), keyword: num(value.keyword) })} (this knowledge base's own weights)`;
}

/** The form differs from what the knowledge base uses now. */
const changed = (kb: KB, v: FusionForm) =>
  v.useDefault !== !kb.fusionWeights || (!v.useDefault && (num(v.vector) !== kb.fusionWeights?.vector || num(v.keyword) !== kb.fusionWeights?.keyword));

export function FusionSettings({ kb, value, onChange }: Props) {
  const errors = fusionErrors(value);
  const set = (patch: Partial<FusionForm>) => onChange({ ...value, ...patch });
  return (
    <div className={k.fusion}>
      <div>
        <h3 className={k.fusionTitle}>Fusion weights</h3>
        <p className={k.note}>
          Search combines vector (meaning) and keyword (exact words) results. A higher weight counts that kind of match more; a keyword weight of 0 makes search
          vector-only.
        </p>
      </div>
      <p className={k.effective}>
        <span className={k.effectiveLabel}>In effect now:</span> {describeWeights(kb.effectiveFusionWeights ?? fallback)} ({weightsSourceLabel(kb.fusionWeightsSource)})
      </p>
      <Switch
        label="Use the default"
        description="The embedding profile's weights, if it sets them, else the platform's."
        checked={value.useDefault}
        onCheckedChange={(useDefault) => set({ useDefault })}
      />
      {!value.useDefault && (
        <div className={k.sliders}>
          <Slider
            label="Vector weight"
            min={0}
            max={1}
            step={step}
            largeStep={0.1}
            value={num(value.vector)}
            onValueChange={(v) => set({ vector: sliderText(v) })}
            showValue
            formatValue={(_, vals) => (vals[0] ?? 0).toFixed(2)}
          />
          <Slider
            label="Keyword weight"
            min={0}
            max={1}
            step={step}
            largeStep={0.1}
            value={num(value.keyword)}
            onValueChange={(v) => set({ keyword: sliderText(v) })}
            showValue
            formatValue={(_, vals) => (vals[0] ?? 0).toFixed(2)}
          />
        </div>
      )}
      {errors.form ? (
        <Alert tone="danger">{errors.form}</Alert>
      ) : (
        <p className={k.note} aria-live="polite">
          {changed(kb, value) ? `After saving: ${fusionSummary(kb, value)}` : ""}
        </p>
      )}
    </div>
  );
}
