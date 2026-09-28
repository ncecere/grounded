/*
 * The moderation test (Q8): a sheet that runs a provider on a text and shows
 * its normalised scores, and what the open tab's policy would do with them.
 * Nothing is stored.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Field, Form } from "@/components/ui/field/field";
import { NativeSelect, Textarea } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Sheet } from "@/components/ui/sheet/sheet";
import { audienceTabs, categoryLabel, fullRules, modelProviderName, type ModerationResult } from "@/lib/moderation";
import { CalibrationBadge, ScoreTable } from "./scores";
import md from "./moderation.module.css";

type Stage = "input" | "output";
type Policy = Schemas["ModerationPolicy"];

/** What the policy does with a result at a stage: the strongest action whose threshold is reached. */
export function policyVerdict(policy: Policy, result: ModerationResult, stage: Stage): { action: "block" | "flag" | "support" | "allow"; category?: string } {
  const rules = fullRules(policy.categories);
  const rank = { allow: 0, flag: 1, support: 2, block: 3 } as const;
  let best: { action: keyof typeof rank; category?: string } = { action: "allow" };
  for (const sc of result.scores) {
    const rule = rules[sc.category as keyof typeof rules]?.[stage];
    if (!sc.supported || !rule || rule.action === "off" || sc.probability < rule.threshold) continue;
    if (rank[rule.action] > rank[best.action]) best = { action: rule.action, category: sc.category };
  }
  return best;
}

const verdictText = { allow: "Allowed", flag: "Flagged", support: "Support message", block: "Blocked" } as const;
const verdictTone = { allow: "success", flag: "warning", support: "info", block: "danger" } as const;

export function TestSheet({ providers, policy, onClose }: { providers: Schemas["Model"][]; policy?: Policy; onClose: () => void }) {
  const [modelId, setModelId] = useState(policy?.modelId ?? providers[0]?.id ?? "");
  const [stage, setStage] = useState<Stage>("input");
  const [text, setText] = useState("");
  const run = useMutation({
    mutationFn: async (judged: Stage) => unwrap(await api.POST("/v1/admin/moderation/test", { body: { modelId, text, stage: judged } })),
  });
  const model = providers.find((m) => m.id === modelId);
  const audience = policy && audienceTabs.find((t) => t.value === policy.audience)?.label;
  const verdict = policy && run.data ? policyVerdict(policy, run.data, run.variables ?? stage) : undefined;

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Test a provider"
      description={
        audience
          ? `Run a provider on any text and see what the ${audience} policy would do. Nothing is stored.`
          : "Run a provider on any text and see its scores per category. Nothing is stored."
      }
    >
      <div className={md.testSheet}>
        <Form
          className={md.testForm}
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate(stage);
          }}
        >
          <Field label="Provider to test">
            <NativeSelect value={modelId} onChange={(e) => setModelId(e.target.value)}>
              {providers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({modelProviderName(m)})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <RadioGroup<Stage>
            legend="Judge the text as"
            orientation="horizontal"
            value={stage}
            onValueChange={setStage}
            options={[
              { value: "input", label: "A user's question" },
              { value: "output", label: "An assistant's answer" },
            ]}
          />
          <Field label="Text">
            <Textarea required rows={4} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div>
            <Button type="submit" loading={run.isPending} disabled={!modelId || !text.trim()}>
              Run test
            </Button>
          </div>
          <ErrorAlert error={run.error} />
        </Form>
        {run.data && (
          <div className={md.testOutcome}>
            <p className={md.testSummary} role="status">
              {verdict && audience && (
                <Badge tone={verdictTone[verdict.action]}>
                  {audience} policy: {verdictText[verdict.action]}
                  {verdict.category ? ` (${categoryLabel(verdict.category)})` : ""}
                </Badge>
              )}
              <span>
                {model?.displayName} answered in {run.data.latencyMs} ms
              </span>
              <CalibrationBadge calibrated={run.data.calibrated} />
              {run.data.severity != null && <span>Severity {run.data.severity.toFixed(1)} of 3</span>}
            </p>
            <ScoreTable result={run.data} caption="Scores for the test text" />
          </div>
        )}
      </div>
    </Sheet>
  );
}
