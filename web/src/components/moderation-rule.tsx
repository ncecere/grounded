/* One moderation rule (action and threshold in %), used by the admin policy editor and the agent override. */
import { NativeSelect } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { actionLabels, type ModerationAction } from "@/lib/moderation";
import r from "./moderation-rule.module.css";

export type RuleForm = { action: ModerationAction; threshold: string };

type Props = {
  /** Accessible name prefix, for example "Violence, questions". */
  label: string;
  rule: RuleForm;
  disabled?: boolean;
  invalid?: boolean;
  /** The label of the off action ("Off", or "Platform" in an override). */
  offLabel?: string;
  /** Offer the support action (self-harm). */
  allowSupport?: boolean;
  onChange: (rule: RuleForm) => void;
};

export function ModerationRuleFields({ label, rule, disabled, invalid, offLabel = actionLabels.off, allowSupport, onChange }: Props) {
  return (
    <span className={r.rule}>
      <span className={r.action}>
        <NativeSelect
          aria-label={`${label}: action`}
          disabled={disabled}
          value={rule.action}
          onChange={(e) => onChange({ ...rule, action: e.target.value as ModerationAction })}
        >
          <option value="off">{offLabel}</option>
          <option value="flag">{actionLabels.flag}</option>
          <option value="block">{actionLabels.block}</option>
          {(allowSupport || rule.action === "support") && <option value="support">{actionLabels.support}</option>}
        </NativeSelect>
      </span>
      <NumberInput
        aria-label={`${label}: threshold (%)`}
        aria-invalid={invalid || undefined}
        className={r.threshold}
        maximumFractionDigits={0}
        disabled={disabled || rule.action === "off"}
        value={rule.threshold}
        onValueChange={(v) => onChange({ ...rule, threshold: v })}
      />
      <span className={r.unit} aria-hidden>
        %
      </span>
    </span>
  );
}
