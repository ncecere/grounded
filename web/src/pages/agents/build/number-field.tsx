import { useState } from "react";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Field } from "@/components/ui/field/field";
import { useReportInvalid } from "./section";

type NumberFieldProps = {
  id?: string;
  label: string;
  description?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  optional?: boolean;
  placeholder?: string;
  integer?: boolean;
  error?: string;
};

/** Why a number input's text isn't a valid value, or undefined when it is. */
function numberError(text: string, { min, max, optional, integer = true }: Pick<NumberFieldProps, "min" | "max" | "optional" | "integer">) {
  const n = Number(text);
  if (text.trim() === "") return optional ? undefined : "Enter a value.";
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) return `Enter ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`;
  return undefined;
}

/** A number input that only reports valid values; blank means "not set" when optional. */
export function NumberField({ id, label, description, value, onChange, min, max, optional, placeholder, integer = true, error }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const local = numberError(text, { min, max, optional, integer });
  useReportInvalid(id, Boolean(local));
  return (
    <Field label={label} labelHint={optional ? "Optional" : undefined} description={description} error={local ?? error}>
      <NumberInput
        id={id}
        maximumFractionDigits={integer ? 0 : 3}
        placeholder={placeholder}
        value={text}
        onValueChange={(t) => {
          setText(t);
          const v = Number(t);
          if (t.trim() === "" && optional) onChange(undefined);
          else if (t.trim() !== "" && Number.isFinite(v) && (!integer || Number.isInteger(v)) && v >= min && v <= max) onChange(v);
        }}
      />
    </Field>
  );
}
