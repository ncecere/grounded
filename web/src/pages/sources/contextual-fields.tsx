import type { Schemas } from "../../api/client";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import type { ContextualErrors, ContextualForm } from "./contextual-form";
import c from "./contextual.module.css";

type Props = {
  form: ContextualForm;
  errors: ContextualErrors;
  models: Schemas["Model"][];
  set: (patch: Partial<ContextualForm>) => void;
};

const budgetFields = [
  ["maxCalls", "Build call limit", "numeric"],
  ["maxCallsPerDay", "UTC-day call limit", "numeric"],
  ["maxTokens", "Build token limit", "numeric"],
  ["maxTokensPerDay", "UTC-day token limit", "numeric"],
  ["maxAmount", "Build configured-price amount", "decimal"],
  ["maxAmountPerDay", "UTC-day configured-price amount", "decimal"],
] as const;

export function ContextualFields({ form, errors, models, set }: Props) {
  return (
    <>
      <Field label="Context-writing chat model" error={errors.modelId} description="The server checks model, connection and classification clearance before generation.">
        <NativeSelect aria-required value={form.modelId} onChange={(e) => set({ modelId: e.target.value })}>
          <option value="">Choose a chat model</option>
          {form.modelId && !models.some((m) => m.id === form.modelId) && <option value={form.modelId}>Saved model (not currently available)</option>}
          {models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Unusable-reply policy" description="Admission limits always wait; they never silently choose plain text.">
        <NativeSelect value={form.failurePolicy} onChange={(e) => set({ failurePolicy: e.target.value as ContextualForm["failurePolicy"] })}>
          <option value="fail">Fail: leave this document unindexed for the set</option>
          <option value="plain">Plain: explicitly allow marked fallback</option>
        </NativeSelect>
      </Field>
      <p className={c.hint}>Token limits cover input plus output. UTC-day limits include build and live work across every profile of this source, including shared sources.</p>
      <div className={c.budgets}>
        {budgetFields.map(([key, label, mode]) => (
          <Field key={key} label={label} error={errors[key]}>
            <Input aria-required inputMode={mode} value={form[key]} onChange={(e) => set({ [key]: e.target.value })} />
          </Field>
        ))}
        <Field label="Configured-price currency" error={errors.currency} description="Match the installation's three-letter uppercase currency. No currency conversion is performed.">
          <Input aria-required maxLength={3} value={form.currency} onChange={(e) => set({ currency: e.target.value })} />
        </Field>
      </div>
      <p className={c.hint}>Enter explicit positive limits. Unknown prices block previews; unknown or in-flight usage retains reserved headroom. Configured-price amounts are local controls, not a provider invoice guarantee.</p>
    </>
  );
}
