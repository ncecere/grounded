import type { Schemas } from "../../api/client";

type State = Pick<Schemas["ContextualChunks"], "enabled" | "modelId" | "failurePolicy" | "maxCalls" | "maxCallsPerDay" | "admission">;
export type ContextualInput = Schemas["ContextualSettingsInput"];
export type ContextualForm = {
  enabled: boolean;
  modelId: string;
  failurePolicy: "fail" | "plain";
  maxCalls: string;
  maxCallsPerDay: string;
  maxTokens: string;
  maxTokensPerDay: string;
  maxAmount: string;
  maxAmountPerDay: string;
  currency: string;
};
export type ContextualErrors = Partial<Record<keyof ContextualForm, string>>;

/** Missing budgets stay empty: opening a form never invents spending consent. */
export function contextualFormOf(state: State): ContextualForm {
  const a = state.admission;
  return {
    enabled: state.enabled,
    modelId: state.modelId ?? "",
    failurePolicy: state.failurePolicy,
    maxCalls: String(state.maxCalls),
    maxCallsPerDay: String(state.maxCallsPerDay),
    maxTokens: a ? String(a.maxTokens) : "",
    maxTokensPerDay: a ? String(a.maxTokensPerDay) : "",
    maxAmount: a?.maxAmount ?? "",
    maxAmountPerDay: a?.maxAmountPerDay ?? "",
    currency: a?.currency ?? "",
  };
}

function integer(value: string, max: number): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= max;
}

/** Money is validated as decimal text, never parsed through floating point. */
function positiveAmount(value: string): boolean {
  return /^[0-9]{1,14}(\.[0-9]{1,6})?$/.test(value) && /[1-9]/.test(value);
}

export function validateContextualForm(form: ContextualForm): ContextualErrors {
  const errors: ContextualErrors = {};
  for (const field of ["maxCalls", "maxCallsPerDay"] as const) {
    if (!integer(form[field], 100000)) errors[field] = "Enter a whole number from 1 to 100,000.";
  }
  if (!form.enabled) return errors;
  if (!form.modelId) errors.modelId = "Choose the chat model that writes context.";
  for (const field of ["maxTokens", "maxTokensPerDay"] as const) {
    if (!integer(form[field], 1000000000)) errors[field] = "Enter a whole number from 1 to 1,000,000,000.";
  }
  for (const field of ["maxAmount", "maxAmountPerDay"] as const) {
    if (!positiveAmount(form[field])) errors[field] = "Enter a positive decimal amount with up to six decimal places.";
  }
  if (!/^[A-Z]{3}$/.test(form.currency)) errors.currency = "Enter the matching three-letter uppercase price currency.";
  return errors;
}

export function contextualInputOf(form: ContextualForm): ContextualInput {
  return {
    enabled: form.enabled,
    modelId: form.enabled ? form.modelId : null,
    failurePolicy: form.failurePolicy,
    maxCalls: Number(form.maxCalls),
    maxCallsPerDay: Number(form.maxCallsPerDay),
    admission: form.enabled
      ? {
          maxTokens: Number(form.maxTokens),
          maxTokensPerDay: Number(form.maxTokensPerDay),
          maxAmount: form.maxAmount,
          maxAmountPerDay: form.maxAmountPerDay,
          currency: form.currency,
        }
      : null,
  };
}
