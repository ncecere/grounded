/* One model in a RecordPage (A5): details and stored health (E11), a test with its result in place, its prices (E2), what uses it, and edit/delete. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { FlaskConical, Pencil, Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Time } from "@/components/ui/time/time";
import { RecordPage } from "@/components/templates/record-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { providerName } from "@/lib/moderation";
import s from "../../shared.module.css";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import { ModerationSamples } from "../moderation/scores";
import { SystemOneSample } from "../systemone/sample";
import { RerankSample } from "./rerank-sample";
import { CompatSection, compatFacts } from "./compat-facts";
import { deleteBlockedReason, EnabledBadge, kindLabels, type Model, type ModelUsage, modelUsedBy, ProxyErrorText, TimingsText } from "./common";
import { type HealthCheck, healthFacts, refreshHealth } from "./health";
import m from "./models.module.css";
import { isPricedKind, ModelPricingSection } from "./pricing";

export function useModelTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (model: Model) => unwrap(await api.POST("/v1/admin/models/{modelId}/test", { params: { path: { modelId: model.id } } })),
    // The result is stored as the model's health.
    onSettled: () => refreshHealth(qc),
  });
}
type ModelTest = ReturnType<typeof useModelTest>;

/** The outcome of a model test, shown on the model's record page. */
export function ModelTestResult({ test }: { test: ModelTest }) {
  if (test.error) return <ErrorAlert error={test.error} />;
  if (!test.data) return null;
  if (!test.data.ok) {
    return (
      <Alert tone="danger" title="The test failed">
        <ProxyErrorText error={test.data.error} />
        {test.data.rerank && <RerankSample test={test.data.rerank} />}
        <TimingsText timings={test.data.timings} />
      </Alert>
    );
  }
  return (
    <Alert tone="success" title={`Answered in ${test.data.latencyMs.toLocaleString()} ms`}>
      {test.data.dimensions != null && `Returned ${test.data.dimensions.toLocaleString()} dimensions`}
      {test.data.dimensionsMatch === false && " (this does not match the configured dimensions; edit the model)"}
      {test.data.reply != null && `Reply: “${test.data.reply}”`}
      {test.data.moderation && <ModerationSamples test={test.data.moderation} />}
      {test.data.systemOne && <SystemOneSample test={test.data.systemOne} />}
      {test.data.rerank && <RerankSample test={test.data.rerank} />}
      {test.data.dimensions == null && test.data.reply == null && !test.data.moderation && !test.data.systemOne && !test.data.rerank && "The model responded."}
      <TimingsText timings={test.data.timings} />
    </Alert>
  );
}

/** What Test model does: a rerank model scores two passages; others answer one small request. */
const testText = (model: Model) =>
  model.kind === "rerank" ? "Scores a passage that answers a sample question and one that doesn't." : "Sends one small request through the connection.";

type Props = {
  model?: Model;
  /** Its latest stored health check (none: not tested yet). */
  health?: HealthCheck;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  connectionName: string;
  usage?: ModelUsage;
  isAdmin: boolean;
  test: ModelTest;
  onEdit: (m: Model) => void;
  onDelete: (m: Model) => void;
  /** The back link's target when the record was opened from another page (Costs). */
  back?: { label: string; href: string };
};

export function ModelRecordPage({ model, health, open, loading, onClose, connectionName, usage, isAdmin, test, onEdit, onDelete, back }: Props) {
  const levels = useClassificationLevels();
  const usedBy = modelUsedBy(usage);
  const blocked = isAdmin ? deleteBlockedReason(usage) : undefined;
  const blockedId = useId();
  const testedThis = test.variables?.id === model?.id;
  return (
    <RecordPage
      open={open}
      onClose={onClose}
      back={back}
      title={model?.displayName ?? "Model"}
      description="A model offered to teams through a connection."
      loading={loading && !model}
      error={!loading && open && !model ? new Error("This model no longer exists.") : undefined}
      facts={
        model
          ? [
              { label: "Kind", value: <Badge tone="info">{kindLabels[model.kind]}</Badge> },
              { label: "Provider", value: model.kind === "moderation" ? providerName(model.moderationProvider, model.moderationFamily) : undefined },
              { label: "Key", value: <code className={s.mono}>{model.key}</code> },
              { label: "Upstream model", value: <code className={s.mono}>{model.upstreamModel}</code> },
              { label: "Connection", value: connectionName },
              { label: "Max classification", value: <ClassificationBadge levels={levels.data} value={model.maxClassification} /> },
              { label: "Status", value: <EnabledBadge enabled={model.enabled} /> },
              ...healthFacts(health),
              { label: "Context window", value: model.contextWindow?.toLocaleString() },
              { label: "Max output tokens", value: model.maxOutputTokens?.toLocaleString() },
              { label: "Dimensions", value: model.dimensions?.toLocaleString() },
              { label: "Check timeout", value: model.moderationTimeoutSeconds ? `${model.moderationTimeoutSeconds} s per attempt` : undefined },
              { label: "Description", value: model.description || undefined },
              { label: "Updated", value: <Time value={model.updatedAt} /> },
            ].filter((f) => f.value !== undefined)
          : []
      }
      sections={
        model
          ? [
              {
                title: "Test",
                hidden: !isAdmin,
                content: (
                  <div className={m.testRow}>
                    {isAdmin && (
                      <Button size="sm" variant="secondary" loading={test.isPending && testedThis} onClick={() => test.mutate(model)}>
                        <FlaskConical aria-hidden /> Test model
                      </Button>
                    )}
                    {testedThis ? <ModelTestResult test={test} /> : <span className={s.muted}>{testText(model)}</span>}
                  </div>
                ),
              },
              // Read-only, for everyone who can open the record, auditors included (AD-09).
              { title: "Compatibility", hidden: compatFacts(model).length === 0, content: <CompatSection model={model} /> },
              { title: "Pricing", hidden: !isPricedKind(model.kind), content: <ModelPricingSection modelId={model.id} isAdmin={isAdmin} /> },
              {
                title: "Used by",
                content: usedBy.length ? (
                  <>
                    <ul className={m.usedBy}>
                      {usedBy.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                    {blocked && (
                      <p id={blockedId} className={s.muted}>
                        {blocked}
                      </p>
                    )}
                  </>
                ) : (
                  <p className={s.muted}>Nothing uses this model yet.</p>
                ),
              },
            ]
          : []
      }
      actions={
        model &&
        isAdmin && (
          <>
            <Button variant="danger" disabled={Boolean(blocked)} aria-describedby={blocked ? blockedId : undefined} onClick={() => onDelete(model)}>
              <Trash2 aria-hidden /> Delete
            </Button>
            <Button onClick={() => onEdit(model)}>
              <Pencil aria-hidden /> Edit
            </Button>
          </>
        )
      }
    />
  );
}
