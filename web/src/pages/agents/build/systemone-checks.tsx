/*
 * Build → SystemOne checks (docs/systemone.md §2-§4): the
 * agent's overrides of passage judging, citation checks and the scope
 * check. Shown only when a SystemOne model is configured; thresholds stay
 * platform-only.
 */
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { useSystemOneStatus } from "@/lib/systemone";
import s from "../../shared.module.css";
import type { AgentConfig } from "../common";
import cf from "./build.module.css";
import { NumberField } from "./number-field";
import type { SectionProps } from "./section";

type Override = NonNullable<AgentConfig["systemOne"]>;
type Switch = NonNullable<Override["judging"]>;

/** The override without empty fields, or undefined when it follows the platform entirely. */
function compact(o: Override): Override | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Override;
  return Object.keys(out).length ? out : undefined;
}

function OnOff({ id, label, value, platform, error, onChange }: { id: string; label: string; value?: string; platform: boolean; error?: string; onChange: (v?: Switch) => void }) {
  return (
    <Field label={label} error={error}>
      <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as Switch | undefined)}>
        <option value="">Platform default ({platform ? "on" : "off"})</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </NativeSelect>
    </Field>
  );
}

export function SystemOneChecks({ c, set, errorFor }: Pick<SectionProps, "c" | "set" | "errorFor">) {
  const status = useSystemOneStatus();
  if (!status.data?.available) return null;
  const platform = status.data;
  const o = c.systemOne ?? {};
  const update = (patch: Partial<Override>) => set({ systemOne: compact({ ...o, ...patch }) });
  return (
    <fieldset id="agent-field-systemOne" className={cf.systemOne}>
      <legend>
        <VisuallyHidden>SystemOne checks</VisuallyHidden>
      </legend>
      <p className={s.settingDescription}>
        A SystemOne model can judge each retrieved passage (re-rank, keep conflicting passages apart, drop prompt injections), check each citation against its source after the
        answer, and spot small talk and questions outside this agent's subject before searching. Each adds a little time per answer.
      </p>
      <div className={s.grid2}>
        <OnOff
          id="agent-field-systemOne.judging"
          label="Passage judging"
          value={o.judging}
          platform={platform.judging.enabled}
          error={errorFor("systemOne.judging")}
          onChange={(v) => update({ judging: v })}
        />
        <NumberField
          id="agent-field-systemOne.candidates"
          label="Passages to check"
          description={`Per search (1–50). Blank uses the platform's ${platform.judging.candidates}.`}
          value={o.candidates}
          onChange={(v) => update({ candidates: v })}
          min={1}
          max={50}
          optional
          error={errorFor("systemOne.candidates")}
        />
        <OnOff
          id="agent-field-systemOne.citations"
          label="Citation checks"
          value={o.citations}
          platform={platform.citations.enabled}
          error={errorFor("systemOne.citations")}
          onChange={(v) => update({ citations: v })}
        />
        <Field
          label="Citation mode"
          description="Annotate marks citations; enforce also removes unsupported ones, and a strictly grounded agent with nothing supported refuses."
          error={errorFor("systemOne.citationMode")}
        >
          <NativeSelect
            id="agent-field-systemOne.citationMode"
            value={o.citationMode ?? ""}
            onChange={(e) => update({ citationMode: (e.target.value || undefined) as Override["citationMode"] })}
          >
            <option value="">Platform default ({platform.citations.mode})</option>
            <option value="annotate">Annotate</option>
            <option value="enforce">Enforce</option>
          </NativeSelect>
        </Field>
        <OnOff
          id="agent-field-systemOne.scope"
          label="Scope check"
          value={o.scope}
          platform={platform.scope.enabled}
          error={errorFor("systemOne.scope")}
          onChange={(v) => update({ scope: v })}
        />
      </div>
    </fieldset>
  );
}
