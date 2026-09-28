/* The moderation policy editor's form state and its conversion to the API body (pure, unit-tested). */
import type { Schemas } from "@/api/client";
import { fullRules, moderationCategories, parseThreshold, type ModerationCategory } from "@/lib/moderation";

export type Policy = Schemas["ModerationPolicy"];
export type PolicyInput = Schemas["ModerationPolicyInput"];

import type { RuleForm } from "@/components/moderation-rule";

export type { RuleForm };
export type PolicyForm = {
  modelId: string;
  outputMode: Schemas["ModerationOutputMode"];
  failClosed: boolean;
  notice: string;
  /** "" (off) or a severity 0–3, as typed. */
  severityBlock: string;
  supportMessage: string;
  /** The block floor for uncalibrated providers, in percent as typed. */
  uncalibratedBlock: string;
  rules: Record<ModerationCategory, { input: RuleForm; output: RuleForm }>;
};

const ruleForm = (r: Schemas["ModerationRule"]): RuleForm => ({ action: r.action, threshold: String(Math.round(r.threshold * 100)) });

export function policyForm(p: Policy): PolicyForm {
  const rules = {} as PolicyForm["rules"];
  for (const [c, r] of Object.entries(fullRules(p.categories))) {
    rules[c as ModerationCategory] = { input: ruleForm(r.input), output: ruleForm(r.output) };
  }
  return {
    modelId: p.modelId ?? "",
    outputMode: p.outputMode,
    failClosed: p.failClosed,
    notice: p.notice,
    severityBlock: p.severityBlock == null ? "" : String(p.severityBlock),
    supportMessage: p.supportMessage ?? "",
    uncalibratedBlock: String(Math.round((p.uncalibratedBlockThreshold ?? 0.95) * 100)),
    rules,
  };
}

/** Fields with an invalid value, by id (for example violence.input). */
export function formProblems(f: PolicyForm): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { value, label } of moderationCategories) {
    for (const stage of ["input", "output"] as const) {
      const r = f.rules[value][stage];
      if (r.action !== "off" && parseThreshold(r.threshold) === undefined) out[`${value}.${stage}`] = `${label}: enter a threshold from 0 to 100%.`;
    }
  }
  const active = Object.values(f.rules).some((r) => r.input.action !== "off" || r.output.action !== "off");
  if (active && !f.modelId) out.modelId = "Choose a provider, or turn every category off.";
  if (f.notice.length > 500) out.notice = "Keep the notice under 500 characters.";
  if (f.supportMessage.length > 1000) out.supportMessage = "Keep the support message under 1,000 characters.";
  const sev = Number(f.severityBlock);
  if (f.severityBlock !== "" && (!Number.isFinite(sev) || sev < 0 || sev > 3)) out.severityBlock = "Choose a severity from 0 to 3.";
  if (parseThreshold(f.uncalibratedBlock) === undefined) out.uncalibratedBlock = "Enter a threshold from 0 to 100%.";
  return out;
}

/** The PUT body. Thresholds of rules that are off keep their last valid value (or 50%). */
export function policyInput(f: PolicyForm): PolicyInput {
  const categories: PolicyInput["categories"] = {};
  const rule = (r: RuleForm) => ({ action: r.action, threshold: parseThreshold(r.threshold) ?? 0.5 });
  for (const [c, r] of Object.entries(f.rules)) categories[c] = { input: rule(r.input), output: rule(r.output) };
  return {
    modelId: f.modelId || null,
    categories,
    outputMode: f.outputMode,
    failClosed: f.failClosed,
    notice: f.notice.trim(),
    severityBlock: f.severityBlock === "" ? null : Number(f.severityBlock),
    supportMessage: f.supportMessage.trim(),
    uncalibratedBlockThreshold: parseThreshold(f.uncalibratedBlock) ?? 0.95,
  };
}

/** How many settings differ from the saved policy. */
export function changedCount(saved: Policy, f: PolicyForm) {
  const a = policyInput(policyForm(saved));
  const b = policyInput(f);
  let n = 0;
  if (a.modelId !== b.modelId) n++;
  if (a.outputMode !== b.outputMode) n++;
  if (a.failClosed !== b.failClosed) n++;
  if (a.notice !== b.notice) n++;
  if (a.severityBlock !== b.severityBlock) n++;
  if (a.supportMessage !== b.supportMessage) n++;
  if (a.uncalibratedBlockThreshold !== b.uncalibratedBlockThreshold) n++;
  for (const c of Object.keys(a.categories)) {
    for (const stage of ["input", "output"] as const) {
      const x = a.categories[c]![stage];
      const y = b.categories[c]![stage];
      if (x.action !== y.action || (x.action !== "off" && x.threshold !== y.threshold)) n++;
    }
  }
  return n;
}
