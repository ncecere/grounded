/* One audience's moderation policy: provider, output mode, fail-closed, notice and per-category rules for questions and answers. */
import { adminOnly } from "@/lib/terms";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { SettingsPage } from "@/components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Switch } from "@/components/ui/switch/switch";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { actionLabels, modelProviderName, moderationCategories, severityOptions, supportCategories, type ModerationAction } from "@/lib/moderation";
import s from "../../shared.module.css";
import { changedCount, formProblems, policyForm, policyInput, type Policy, type PolicyForm, type RuleForm } from "./policy-form";
import md from "./moderation.module.css";

type Model = Schemas["Model"];
type Stage = "input" | "output";

const modeOptions = [
  { value: "stream_retract" as const, label: "Stream, then retract", description: "Answers appear as they are written; a failing answer is replaced by the notice." },
  { value: "buffer" as const, label: "Buffer", description: "Answers are checked before anyone sees them. Meanwhile people see what the agent is doing, then the whole answer at once." },
];

function useSavePolicy(policy: Policy, onSaved: (p: Policy) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: PolicyForm) =>
      unwrap(
        await api.PUT("/v1/admin/moderation/policies/{audience}", {
          params: { path: { audience: policy.audience }, header: ifMatch(policy.revision) },
          body: policyInput(form),
        }),
      ),
    onSuccess: (saved) => {
      qc.setQueryData(["admin", "moderation", "policy", saved.audience], saved);
      toast.success("Moderation policy saved");
      onSaved(saved);
    },
  });
}

export function PolicyEditor({ policy, providers, isAdmin }: { policy: Policy; providers: Model[]; isAdmin: boolean }) {
  const [form, setForm] = useState(() => policyForm(policy));
  const [submitted, setSubmitted] = useState(false);
  const save = useSavePolicy(policy, (p) => setForm(policyForm(p)));
  const problems = formProblems(form);
  const changes = changedCount(policy, form);
  const isPublic = policy.audience === "public";
  const uncalibrated = providers.find((m) => m.id === form.modelId)?.moderationProvider === "chat_classifier";
  const set = (patch: Partial<PolicyForm>) => setForm((f) => ({ ...f, ...patch }));
  const setRule = (c: keyof PolicyForm["rules"], stage: Stage, r: RuleForm) =>
    setForm((f) => ({ ...f, rules: { ...f.rules, [c]: { ...f.rules[c], [stage]: r } } }));
  const onSave = () => {
    setSubmitted(true);
    if (Object.keys(problems).length === 0) save.mutate(form);
  };
  const invalid = submitted && Object.keys(problems).length > 0;

  return (
    <SettingsPage
      dirty={changes > 0}
      canEdit={isAdmin} readOnlyNote={adminOnly}
      saving={save.isPending}
      error={save.error}
      saveLabel="Save policy"
      message={invalid ? `Not saved: ${Object.values(problems)[0]}` : changes === 1 ? "1 unsaved change" : `${changes} unsaved changes`}
      onSave={onSave}
      onDiscard={() => setForm(policyForm(policy))}
    >
      <p className={md.summary}>{policySummary(form, providers)}</p>
      {isPublic && !policy.modelId && (
        <Alert tone="warning" title="Public agents can't be published yet">
          Moderation is required for the public audience. Choose a provider and save.
        </Alert>
      )}
      <Card title="Provider and behaviour" description={isPublic ? "Public moderation always fails closed." : "Moderation is optional for this audience."}>
        <div className={md.behaviour}>
          <Field label="Provider" error={submitted ? problems.modelId : undefined} description="Moderation and SystemOne models from Admin → Models.">
            <NativeSelect disabled={!isAdmin} value={form.modelId} onChange={(e) => set({ modelId: e.target.value })}>
              <option value="">None</option>
              {providers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({modelProviderName(m)}){m.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {/* With no provider nothing is checked (m9): the rest only matters once one is chosen. */}
          {form.modelId === "" ? (
            <p className={s.muted}>Moderation is off for this audience. Choose a provider to set how answers are checked, the notice and the category rules.</p>
          ) : (
            <>
              <RadioGroup
                legend="Answers"
                orientation="horizontal"
                variant="card"
                disabled={!isAdmin}
                value={form.outputMode}
                onValueChange={(v) => set({ outputMode: v })}
                options={modeOptions}
              />
              <Switch
                label="Fail closed"
                description="If the provider fails or times out (after one retry), refuse the message with “The safety check is unavailable right now. Please try again.” instead of answering unchecked."
                checked={form.failClosed}
                disabled={!isAdmin || isPublic}
                onCheckedChange={(v) => set({ failClosed: v })}
              />
              <Field
                label="Block threshold for uncalibrated providers"
                description={
                  uncalibrated
                    ? `This provider isn't calibrated: block rules only flag scores below ${form.uncalibratedBlock || "?"}%.`
                    : "Chat classifiers (and guardrails without log-probabilities) give rough scores: below this, their block rules only flag. 0% treats them like calibrated scores."
                }
                error={submitted ? problems.uncalibratedBlock : undefined}
              >
                <Input inputMode="numeric" disabled={!isAdmin} value={form.uncalibratedBlock} onChange={(e) => set({ uncalibratedBlock: e.target.value })} />
              </Field>
              <Field label="Notice" description="Replaces a blocked question's answer or a blocked answer." error={submitted ? problems.notice : undefined}>
                <Textarea rows={2} disabled={!isAdmin} value={form.notice} onChange={(e) => set({ notice: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      </Card>
      {form.modelId !== "" && (
        <SystemOneExtras form={form} set={set} isAdmin={isAdmin} systemOne={providers.find((m) => m.id === form.modelId)?.kind === "systemone"} problems={submitted ? problems : {}} />
      )}
      {/* Without a provider the rules only show while some are still on, so they can be turned off. */}
      {(form.modelId !== "" || rulesActive(form)) && (
        <>
          <Card
            title="Categories"
            description="Flag records a match; block refuses the question or withholds the answer; support (self-harm) answers with the support message. Thresholds are probabilities (0–100%)."
            flush
          >
            <Table caption="Category rules" columns={["Category", "Questions", "Answers"]}>
              {moderationCategories.map((cat) => (
                <Tr key={cat.value}>
                  <Td>
                    <span className={s.primary}>{cat.label}</span>
                    <span className={s.secondary}>{cat.hint}</span>
                  </Td>
                  {(["input", "output"] as const).map((stage) => (
                    <Td key={stage}>
                      <RuleFields
                        label={`${cat.label}, ${stage === "input" ? "questions" : "answers"}`}
                        rule={form.rules[cat.value][stage]}
                        disabled={!isAdmin}
                        allowSupport={supportCategories.includes(cat.value)}
                        invalid={submitted && !!problems[`${cat.value}.${stage}`]}
                        onChange={(r) => setRule(cat.value, stage, r)}
                      />
                    </Td>
                  ))}
                </Tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </SettingsPage>
  );
}

/** Some category rule is on. */
const rulesActive = (f: PolicyForm) => Object.values(f.rules).some((r) => r.input.action !== "off" || r.output.action !== "off");

/** "Provider: X · Buffer · Fails closed · 3 categories blocking" (Q8). */
function policySummary(form: PolicyForm, providers: Model[]) {
  const provider = providers.find((m) => m.id === form.modelId);
  const rules = Object.values(form.rules).flatMap((r) => [r.input, r.output]);
  const blocking = Object.values(form.rules).filter((r) => r.input.action === "block" || r.output.action === "block").length;
  const flagging = rules.filter((r) => r.action === "flag").length;
  if (!provider) return "No provider: moderation is off";
  return [
    `Provider: ${provider.displayName}`,
    form.outputMode === "buffer" ? "Buffers answers" : "Streams, then retracts",
    form.failClosed ? "Fails closed" : "Fails open",
    `${blocking} ${blocking === 1 ? "category" : "categories"} blocking`,
    flagging ? `${flagging} ${flagging === 1 ? "rule" : "rules"} flagging` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

type RuleProps = { label: string; rule: RuleForm; disabled: boolean; invalid: boolean; allowSupport: boolean; onChange: (r: RuleForm) => void };

/** One rule: the action, and its threshold only when the action isn't Off (Q8). */
function RuleFields({ label, rule, disabled, invalid, allowSupport, onChange }: RuleProps) {
  return (
    <span className={md.rule}>
      <span className={md.ruleAction}>
        <NativeSelect aria-label={`${label}: action`} disabled={disabled} value={rule.action} onChange={(e) => onChange({ ...rule, action: e.target.value as ModerationAction })}>
          <option value="off">{actionLabels.off}</option>
          <option value="flag">{actionLabels.flag}</option>
          <option value="block">{actionLabels.block}</option>
          {(allowSupport || rule.action === "support") && <option value="support">{actionLabels.support}</option>}
        </NativeSelect>
      </span>
      {rule.action !== "off" && (
        <>
          <NumberInput
            aria-label={`${label}: threshold (%)`}
            aria-invalid={invalid || undefined}
            className={md.ruleThreshold}
            maximumFractionDigits={0}
            disabled={disabled}
            value={rule.threshold}
            onValueChange={(v) => onChange({ ...rule, threshold: v })}
          />
          <span className={md.ruleUnit} aria-hidden>
            %
          </span>
        </>
      )}
    </span>
  );
}

type ExtrasProps = { form: PolicyForm; set: (patch: Partial<PolicyForm>) => void; isAdmin: boolean; systemOne: boolean; problems: Record<string, string> };

/** The severity threshold (SystemOne providers only) and the support message. */
function SystemOneExtras({ form, set, isAdmin, systemOne, problems }: ExtrasProps) {
  const known = severityOptions.some((o) => o.value === form.severityBlock);
  return (
    <Card title="Severity and support" description="A SystemOne model also rates how much harm complying would do. The support action answers with the support message instead of a refusal.">
      <div className={md.behaviour}>
        <Field
          label="Block by severity"
          description={systemOne ? "Blocks questions and answers at or above this severity, whatever their category." : "Only SystemOne models rate severity; other providers ignore this setting."}
          error={problems.severityBlock}
        >
          <NativeSelect disabled={!isAdmin} value={form.severityBlock} onChange={(e) => set({ severityBlock: e.target.value })}>
            {severityOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {!known && <option value={form.severityBlock}>Severity {form.severityBlock} or worse</option>}
          </NativeSelect>
        </Field>
        <Field label="Support message" description="Replaces a self-harm question's answer (or an answer) when its rule is set to support. Add your crisis resources." error={problems.supportMessage}>
          <Textarea rows={3} disabled={!isAdmin} value={form.supportMessage} onChange={(e) => set({ supportMessage: e.target.value })} />
        </Field>
      </div>
    </Card>
  );
}
