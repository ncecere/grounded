/* One model in a RecordSheet (A5): details, a test with its result in place, what uses it, and edit/delete. */
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Pencil, Trash2 } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { RelativeTime } from "@/components/templates/list-page";
import { RecordSheet } from "@/components/templates/record-sheet";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { providerName } from "@/lib/moderation";
import s from "../../shared.module.css";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import { ModerationSamples } from "../moderation/scores";
import { SystemOneSample } from "../systemone/sample";
import { EnabledBadge, kindLabels, type Model, type ModelUsage, modelUsedBy, ProxyErrorText, TimingsText } from "./common";
import m from "./models.module.css";

export function useModelTest() {
  return useMutation({ mutationFn: async (model: Model) => unwrap(await api.POST("/v1/admin/models/{modelId}/test", { params: { path: { modelId: model.id } } })) });
}
type ModelTest = ReturnType<typeof useModelTest>;

/** The outcome of a model test, shown in the model's sheet. */
export function ModelTestResult({ test }: { test: ModelTest }) {
  if (test.error) return <ErrorAlert error={test.error} />;
  if (!test.data) return null;
  if (!test.data.ok) {
    return (
      <Alert tone="danger" title="The test failed">
        <ProxyErrorText error={test.data.error} />
        <TimingsText timings={test.data.timings} />
      </Alert>
    );
  }
  return (
    <Alert tone="success" title={`Answered in ${test.data.latencyMs} ms`}>
      {test.data.dimensions != null && `Returned ${test.data.dimensions} dimensions`}
      {test.data.dimensionsMatch === false && " (this does not match the configured dimensions; edit the model)"}
      {test.data.reply != null && `Reply: “${test.data.reply}”`}
      {test.data.moderation && <ModerationSamples test={test.data.moderation} />}
      {test.data.systemOne && <SystemOneSample test={test.data.systemOne} />}
      {test.data.dimensions == null && test.data.reply == null && !test.data.moderation && !test.data.systemOne && "The model responded."}
      <TimingsText timings={test.data.timings} />
    </Alert>
  );
}

type Props = {
  model?: Model;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  connectionName: string;
  usage?: ModelUsage;
  isAdmin: boolean;
  test: ModelTest;
  onEdit: (m: Model) => void;
  onDelete: (m: Model) => void;
};

export function ModelSheet({ model, open, loading, onClose, connectionName, usage, isAdmin, test, onEdit, onDelete }: Props) {
  const levels = useClassificationLevels();
  const usedBy = modelUsedBy(usage);
  const testedThis = test.variables?.id === model?.id;
  return (
    <RecordSheet
      open={open}
      onClose={onClose}
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
              { label: "Context window", value: model.contextWindow?.toLocaleString() },
              { label: "Max output tokens", value: model.maxOutputTokens?.toLocaleString() },
              { label: "Dimensions", value: model.dimensions?.toLocaleString() },
              { label: "Check timeout", value: model.moderationTimeoutSeconds ? `${model.moderationTimeoutSeconds} s per attempt` : undefined },
              { label: "Description", value: model.description || undefined },
              { label: "Updated", value: <RelativeTime value={model.updatedAt} /> },
            ].filter((f) => f.value !== undefined)
          : []
      }
      sections={
        model
          ? [
              {
                title: "Test",
                content: (
                  <div className={m.testRow}>
                    {isAdmin && model.kind !== "rerank" && (
                      <Button size="sm" variant="secondary" loading={test.isPending && testedThis} onClick={() => test.mutate(model)}>
                        <FlaskConical aria-hidden /> Test model
                      </Button>
                    )}
                    {testedThis ? <ModelTestResult test={test} /> : <span className={s.muted}>Sends one small request through the connection.</span>}
                  </div>
                ),
              },
              {
                title: "Used by",
                content: usedBy.length ? (
                  <ul className={m.usedBy}>
                    {usedBy.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.muted}>Nothing uses this model yet.</p>
                ),
              },
            ]
          : []
      }
      footer={
        model &&
        isAdmin && (
          <>
            <Button variant="danger" disabled={usedBy.length > 0} title={usedBy.length ? "Models in use can't be deleted; disable them instead." : undefined} onClick={() => onDelete(model)}>
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
