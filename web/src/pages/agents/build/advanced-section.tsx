/* Build → Advanced: sampling, answer length, reasoning effort, retrieval budget, query rewriting, follow-up suggestions and reranking. */
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { useRerankStatus } from "@/lib/rerank";
import s from "../../shared.module.css";
import a from "../agents.module.css";
import type { AgentConfig } from "../common";
import { NumberField } from "./number-field";
import type { SectionProps } from "./section";

export function AdvancedSection({ c, set, errorFor, model }: SectionProps) {
  return (
    <div className={a.stack}>
      <div className={s.grid2}>
        <NumberField
          id="agent-field-temperature"
          label="Temperature"
          description="0 is focused and repeatable, 2 is varied. Blank uses the model's default."
          value={c.temperature}
          onChange={(v) => set({ temperature: v })}
          min={0}
          max={2}
          integer={false}
          optional
          error={errorFor("temperature")}
        />
        <NumberField
          id="agent-field-maxOutputTokens"
          label="Maximum answer length (tokens)"
          description={model?.maxOutputTokens ? `The model allows up to ${model.maxOutputTokens.toLocaleString()}.` : "Blank uses the model's limit."}
          value={c.maxOutputTokens}
          onChange={(v) => set({ maxOutputTokens: v })}
          min={1}
          max={model?.maxOutputTokens ?? 1_000_000}
          optional
          error={errorFor("maxOutputTokens")}
        />
        {model && <ReasoningEffortField c={c} set={set} errorFor={errorFor} model={model} />}
        <NumberField
          id="agent-field-contextTokenBudget"
          label="Source token budget"
          description="Passages are trimmed to about this many tokens (500–32,000)."
          value={c.contextTokenBudget}
          onChange={(v) => v !== undefined && set({ contextTokenBudget: v })}
          min={500}
          max={32000}
          error={errorFor("contextTokenBudget")}
        />
        {c.retrievalMode === "tool" && (
          <NumberField
            id="agent-field-maxTurns"
            label="Maximum searches"
            description="Model turns that may search (1–8). The last turn must answer."
            value={c.maxTurns}
            onChange={(v) => v !== undefined && set({ maxTurns: v })}
            min={1}
            max={8}
            error={errorFor("maxTurns")}
          />
        )}
        <NumberField
          id="agent-field-minSimilarity"
          label="Minimum similarity"
          description="Drop passages less similar than this (0–1). 0 turns it off."
          value={c.minSimilarity}
          onChange={(v) => v !== undefined && set({ minSimilarity: v })}
          min={0}
          max={1}
          integer={false}
          error={errorFor("minSimilarity")}
        />
      </div>
      <div id="agent-field-queryRewrite">
        <Switch
          label="Rewrite follow-up questions"
          description="In a conversation, turn “what about summer?” into a question that stands on its own before searching. Adds a short model call."
          checked={c.queryRewrite}
          onCheckedChange={(v) => set({ queryRewrite: v })}
        />
      </div>
      <div id="agent-field-followUpSuggestions">
        <Switch
          label="Suggest follow-up questions"
          description="After an answer with sources, offer up to 3 questions its sources can answer. Adds a short model call after the answer."
          checked={c.followUpSuggestions ?? true}
          onCheckedChange={(v) => set({ followUpSuggestions: v })}
        />
      </div>
      <Reranking c={c} set={set} errorFor={errorFor} />
    </div>
  );
}

/** The agent's reranking (docs/v0.4.0.md §3), shown once the platform has a rerank model. */
function Reranking({ c, set, errorFor }: Pick<SectionProps, "c" | "set" | "errorFor">) {
  const status = useRerankStatus();
  if (!status.data?.available) return null;
  const on = c.rerank ?? true;
  return (
    <div className={s.grid2}>
      <div id="agent-field-rerank">
        <Switch
          label="Rerank passages"
          description="A rerank model reads the question with each passage found and keeps the best. More precise, and SystemOne judges fewer passages."
          checked={on}
          onCheckedChange={(v) => set({ rerank: v })}
        />
      </div>
      {on && (
        <NumberField
          id="agent-field-rerankTopN"
          label="Passages kept after reranking"
          description={`The best passages of each search given to the model (1–20). The default is ${status.data.defaultTopN}.`}
          value={c.rerankTopN ?? status.data.defaultTopN}
          onChange={(v) => v !== undefined && set({ rerankTopN: v })}
          min={1}
          max={20}
          error={errorFor("rerankTopN")}
        />
      )}
    </div>
  );
}

/** Why an effort can't be chosen with this model ("" when it can), naming the Admin → Models setting it needs. */
function effortReasons(model: { displayName: string; supportsReasoningEffort: boolean; supportsThinkingOff: boolean }) {
  const off = model.supportsThinkingOff ? "" : `Off needs "How to turn thinking off" set for ${model.displayName} in Admin → Models.`;
  const levels = model.supportsReasoningEffort ? "" : `Low, Medium and High need "Accepts reasoning effort" turned on for ${model.displayName} in Admin → Models.`;
  return { off, levels };
}

/**
 * Model default (the audience's effort when a platform admin set one, Public: Low), Off, Low, Medium or High. Off and the
 * levels each need the model set up for them; options that can't be chosen are disabled and the description says why.
 */
type EffortProps = Pick<SectionProps, "c" | "set" | "errorFor"> & { model: NonNullable<SectionProps["model"]> };

function ReasoningEffortField({ c, set, errorFor, model }: EffortProps) {
  const why = effortReasons(model);
  const none = !model.supportsReasoningEffort && !model.supportsThinkingOff;
  const intro = "How long the model thinks before answering. Lower starts answering sooner. Default uses the audience's setting (Low for public agents unless a platform admin changed it), else the model's.";
  return (
    <Field label="Reasoning effort" labelHint="Optional" description={[intro, why.off, why.levels].filter(Boolean).join(" ")} disabled={none} error={errorFor("reasoningEffort")}>
      <NativeSelect
        id="agent-field-reasoningEffort"
        value={c.reasoningEffort ?? ""}
        disabled={none}
        onChange={(e) => set({ reasoningEffort: (e.target.value || undefined) as AgentConfig["reasoningEffort"] })}
      >
        <option value="">Default</option>
        <option value="off" disabled={Boolean(why.off)}>
          Off
        </option>
        {(["low", "medium", "high"] as const).map((v) => (
          <option key={v} value={v} disabled={Boolean(why.levels)}>
            {v[0]!.toUpperCase() + v.slice(1)}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
