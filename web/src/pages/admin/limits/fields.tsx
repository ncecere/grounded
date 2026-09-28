/* Table cells shared by the platform limits page and the team limits card. */
import type { ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { Field } from "@/components/ui/field/field";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { type LimitUnit, inputUnit, periodSuffix } from "@/lib/limits";
import s from "../../shared.module.css";
import l from "./limits.module.css";

type AmountInputProps = {
  label: string;
  unit: LimitUnit;
  period: Schemas["LimitPeriod"];
  value: string;
  placeholder: string;
  error?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
};

/** A number input (thousands separators while not editing) with its unit (GiB for storage) and period after it. */
export function AmountInput({ label, unit, period, value, placeholder, error, disabled, onChange }: AmountInputProps) {
  const suffix = [inputUnit(unit), periodSuffix(period).trim()].filter(Boolean).join(" ");
  return (
    <Field label={suffix ? `${label} (${suffix})` : label} hideLabel error={error} className={l.amountField}>
      <span className={l.amount}>
        <NumberInput
          size="sm"
          maximumFractionDigits={unit === "bytes" ? 3 : 0}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          className={l.amountInput}
        />
        {/* A fixed-width unit column keeps the inputs aligned across rows. */}
        <span aria-hidden className={l.unit}>
          {suffix}
        </span>
      </span>
    </Field>
  );
}

export function LimitName({ label, description, children }: { label: string; description: string; children?: ReactNode }) {
  return (
    <>
      <span className={s.primary}>{label}</span>
      <span className={s.secondary}>{description}</span>
      {children}
    </>
  );
}
