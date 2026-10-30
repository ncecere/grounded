/*
 * Parent sections of an embedding profile (parent/child retrieval, docs/parent-child-retrieval.md): one place for the field, its checks and its
 * wording, so the profile form, the profile page and the index preview say the same thing. Search still ranks small passages; an agent's model is
 * given the section around each match, up to a number of tokens. It has not been measured on a real knowledge base: the index preview is how to try it.
 */
import { Field } from "@/components/ui/field/field";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { PARENT_MAX } from "./parent-size";

const WHAT = "Search still ranks small passages, but an agent's model is given the whole section around each match, up to this many tokens.";
const LIMITS = `At least twice the passage size, at most ${PARENT_MAX}.`;
const UNMEASURED = "Not measured on a real knowledge base. The comparison in a preview measures which pages are found, not how good the answers are.";

type Props = {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  /** The index preview: empty keeps the current profile's, 0 turns parents off. */
  preview?: { current: number };
  disabled?: boolean;
};

/** The parent size field of the profile form and of the index preview. */
export function ParentSizeField({ value, onChange, error, preview, disabled }: Props) {
  const description = preview
    ? `${WHAT} Empty keeps the current setting, 0 turns it off. ${LIMITS} ${UNMEASURED}`
    : `${WHAT} Empty: off. ${LIMITS} Fixed once the profile exists: to try it on a knowledge base first, preview it under Migrations. ${UNMEASURED}`;
  return (
    <Field label="Parent sections" labelHint={preview ? "tokens" : "Optional, tokens"} description={description} error={error}>
      <NumberInput
        value={value}
        onValueChange={onChange}
        maximumFractionDigits={0}
        disabled={disabled}
        placeholder={preview ? (preview.current > 0 ? String(preview.current) : "Off") : "Off"}
      />
    </Field>
  );
}
