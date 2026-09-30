/* Build → Answering: when to search, grounding and the refusal message, and citations. */

import { Field } from "@/components/ui/field/field";
import { NativeSelect, Textarea } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Switch } from "@/components/ui/switch/switch";
import s from "../../shared.module.css";
import { type AgentConfig, citationModeLabels } from "../common";
import a from "../agents.module.css";
import type { SectionProps } from "./section";

export function AnsweringSection({ c, set, errorFor, model }: SectionProps) {
  const toolsUnsupported = model !== undefined && !model.supportsTools;
  return (
    <div className={a.stack}>
      <div id="agent-field-retrievalMode">
        <RadioGroup
          legend="When to search"
          variant="card"
          value={c.retrievalMode}
          onValueChange={(v) => set({ retrievalMode: v })}
          error={errorFor("retrievalMode")}
          options={[
            {
              value: "always",
              label: "Search before every answer",
              description: "Fast and predictable: the question is searched once and the passages go to the model. A follow-up that depends on the conversation is rewritten to stand on its own first.",
            },
            {
              value: "tool",
              label: "Let the model decide when to search",
              description: toolsUnsupported
                ? `${model?.displayName} can't call tools, so this mode isn't available with it.`
                : "The model calls a search tool, possibly several times with its own queries. Better for multi-part questions; slower.",
              disabled: toolsUnsupported && c.retrievalMode !== "tool",
            },
          ]}
        />
      </div>
      <div id="agent-field-strictlyGrounded">
        <Switch
          label="Answer only from the sources"
          description="When the sources don't answer the question, reply with the refusal message instead of general knowledge. Recommended."
          checked={c.strictlyGrounded}
          onCheckedChange={(v) => set({ strictlyGrounded: v })}
        />
      </div>
      {c.strictlyGrounded ? (
        <Field label="Refusal message" description="Sent word for word when the sources have no answer." error={errorFor("refusalMessage")}>
          <Textarea id="agent-field-refusalMessage" rows={2} maxLength={500} value={c.refusalMessage} onChange={(e) => set({ refusalMessage: e.target.value })} />
        </Field>
      ) : (
        <p className={s.note}>Answers may use the model's general knowledge; it must say when something isn't from the sources.</p>
      )}
      <Field label="Citations" description="What people see for each source the answer cites. Uploaded files are cited by title only." error={errorFor("citationMode")}>
        <NativeSelect id="agent-field-citationMode" value={c.citationMode} onChange={(e) => set({ citationMode: e.target.value as AgentConfig["citationMode"] })}>
          {Object.entries(citationModeLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}
