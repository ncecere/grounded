/* Build → Model (a searchable model picker with display names: Q11) and Build → Knowledge (knowledge bases and pinned filters). */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Field, Fieldset } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { type ModelOption, ModelSelector } from "@/components/ui/model-selector/model-selector";
import { Loading } from "@/components/ui/spinner/spinner";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { FilterFields, cleanFilter, describeFilter } from "../../team/filters";
import { type KB, useClassificationLevels, useKBs, useTeam } from "../../team/common";
import { useChatModels } from "../common";
import a from "../agents.module.css";
import cf from "./build.module.css";
import { type ChatModel, type SectionProps, useReportInvalid } from "./section";

/** Chat models as model-selector options, grouped by the most sensitive level each may process. */
export function modelOptions(models: ChatModel[], levelName: (key: string) => string): ModelOption[] {
  return models.map((m) => ({
    id: m.id,
    name: m.displayName,
    provider: `Approved up to ${levelName(m.maxClassification)}`,
    description: m.description || undefined,
    contextWindow: m.contextWindow ?? undefined,
    capabilities: [...(m.supportsTools ? ["tools"] : []), ...(m.supportsReasoningEffort ? ["reasoning"] : [])],
  }));
}

export const capabilityLabels = { tools: "Tools", reasoning: "Reasoning" };

export function ModelSection({ c, set, errorFor, model, levelName }: SectionProps) {
  const models = useChatModels();
  if (models.isLoading) return <Loading label="Loading chat models…" block={false} />;
  const options = modelOptions(models.data ?? [], levelName);
  if (c.chatModelId && !model) options.unshift({ id: c.chatModelId, name: "Unavailable model", provider: "No longer available" });
  return (
    <Field
      label="Chat model"
      description={
        model
          ? `Approved up to ${levelName(model.maxClassification)}. ${model.supportsTools ? "Supports tools." : "No tool support."}${model.contextWindow ? ` Context window ${model.contextWindow.toLocaleString()} tokens.` : ""}`
          : "The model that writes the answers from what the knowledge bases return."
      }
      error={errorFor("chatModelId")}
    >
      <div id="agent-field-chatModelId" className={cf.modelPicker}>
        <ModelSelector
          label="Chat model"
          placeholder="Choose a model…"
          models={options}
          value={c.chatModelId ?? null}
          capabilityLabels={capabilityLabels}
          onValueChange={(id) => set({ chatModelId: id })}
        />
      </div>
    </Field>
  );
}

export function KnowledgeSection({ c, set, errorFor, model, levelName }: SectionProps) {
  return (
    <div className={a.stack}>
      <Fieldset legend="Knowledge bases" description="What the agent searches: up to 5. Results sets how many passages each one gives per search (1–20).">
        <KnowledgeBaseList c={c} set={set} errorFor={errorFor} model={model} levelName={levelName} />
        {errorFor("kbs") && <p className={s.dangerText}>{errorFor("kbs")}</p>}
      </Fieldset>
      <PinnedFilters c={c} set={set} />
    </div>
  );
}

function KnowledgeBaseList({ c, set, model, levelName }: SectionProps) {
  const { slug } = useTeam();
  const kbs = useKBs(slug);
  const unknownKBs = c.kbs.filter((k) => !kbs.data?.some((kb) => kb.id === k.kbId));
  return (
    <div id="agent-field-kbs" tabIndex={-1} className={cf.kbList}>
      {kbs.isLoading ? (
        <Loading label="Loading knowledge bases…" block={false} />
      ) : (kbs.data ?? []).length === 0 ? (
        <p className={s.note}>
          Your team has no knowledge bases. <TextLink render={<Link to="/teams/$team/kbs" params={{ team: slug }} />}>Create one</TextLink> first.
        </p>
      ) : (
        (kbs.data ?? []).map((kb) => <KnowledgeBaseRow key={kb.id} kb={kb} c={c} set={set} model={model} levelName={levelName} />)
      )}
      {unknownKBs.map((k) => (
        <Alert key={k.kbId} tone="warning" title="A knowledge base was deleted">
          The draft still lists it.{" "}
          <button type="button" className={a.problemLink} onClick={() => set({ kbs: c.kbs.filter((x) => x.kbId !== k.kbId) })}>
            Remove it from the draft
          </button>
        </Alert>
      ))}
    </div>
  );
}

type RowProps = Pick<SectionProps, "c" | "set" | "model" | "levelName"> & { kb: KB };

/** A knowledge base checkbox, and its results per search while selected. */
function KnowledgeBaseRow({ kb, c, set, model, levelName }: RowProps) {
  const levels = useClassificationLevels();
  const ref = c.kbs.find((k) => k.kbId === kb.id);
  const r = levels.data?.find((l) => l.key === kb.effectiveClassification)?.rank;
  const max = levels.data?.find((l) => l.key === model?.maxClassification)?.rank;
  const tooHigh = r !== undefined && max !== undefined && r > max;
  const setOn = (on: boolean) => set({ kbs: on ? [...c.kbs, { kbId: kb.id, topK: 6 }] : c.kbs.filter((k) => k.kbId !== kb.id) });
  return (
    <div className={cf.kbRow}>
      <Checkbox
        label={kb.name}
        description={
          (kb.effectiveClassification ? levelName(kb.effectiveClassification) : "No sources") +
          ` · ${kb.sources.length} source${kb.sources.length === 1 ? "" : "s"}` +
          (tooHigh ? ` · above what ${model?.displayName} may process` : "")
        }
        checked={Boolean(ref)}
        disabled={!ref && c.kbs.length >= 5}
        onCheckedChange={setOn}
      />
      {ref && <TopK kb={kb} value={ref.topK ?? 6} onChange={(topK) => set({ kbs: c.kbs.map((k) => (k.kbId === kb.id ? { ...k, topK } : k)) })} />}
    </div>
  );
}

/** Results per search: text that isn't 1–20 stays on screen, marked, and holds the save status (F-26). */
function TopK({ kb, value, onChange }: { kb: KB; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const invalid = !(Number.isInteger(n) && n >= 1 && n <= 20);
  useReportInvalid(`agent-field-kbs.${kb.id}`, invalid);
  return (
    <label className={cf.topKLabel}>
      <span aria-hidden>Results</span>
      <Input
        type="number"
        size="sm"
        min={1}
        max={20}
        className={cf.topKInput}
        aria-label={`Results per search from ${kb.name}`}
        aria-invalid={invalid || undefined}
        title={invalid ? "Enter a whole number from 1 to 20." : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (Number.isInteger(v) && v >= 1 && v <= 20) onChange(v);
        }}
      />
    </label>
  );
}

/** Filters pinned to every search, over the sources of the selected knowledge bases. */
function PinnedFilters({ c, set }: Pick<SectionProps, "c" | "set">) {
  const { slug } = useTeam();
  const kbs = useKBs(slug);
  const [open, setOpen] = useState(Boolean(cleanFilter(c.filters)));
  const kbIds = new Set(c.kbs.map((k) => k.kbId));
  const attachedSources = (kbs.data ?? [])
    .filter((kb) => kbIds.has(kb.id))
    .flatMap((kb) => kb.sources)
    .filter((src, i, all) => all.findIndex((x) => x.id === src.id) === i);
  return (
    <div id="agent-field-filters">
      <Disclosure title="Pinned filters" summary={describeFilter(c.filters)} open={open} onOpenChange={setOpen}>
        <p className={s.settingDescription}>Restrict every search to part of the knowledge bases, for example one source or pages under a URL.</p>
        <FilterFields value={c.filters} sources={attachedSources} onChange={(f) => set({ filters: cleanFilter(f) })} />
      </Disclosure>
    </div>
  );
}
