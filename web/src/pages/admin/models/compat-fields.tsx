/* The model dialog's "Compatibility" disclosure: per-server quirks of the chat completions and embeddings APIs (DESIGN.md §10). */
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Field } from "@/components/ui/field/field";
import { NativeSelect, Textarea } from "@/components/ui/input/input";
import s from "../../shared.module.css";
import { extraBodyExample, type ModelForm } from "./model-form";

type SetField = <K extends keyof ModelForm>(k: K, v: ModelForm[K]) => void;

/** "" = default (not set), else true or false. */
const tri = (v: boolean | undefined) => (v === undefined ? "" : v ? "yes" : "no");
const fromTri = (v: string) => (v === "" ? undefined : v === "yes");

type Props = { form: ModelForm; set: SetField; extraBodyError?: string };

/** Chat completion quirks, for chat models and chat-classifier moderation models. */
export function ChatCompatFields({ form, set, extraBodyError }: Props) {
  // Open when something is set; always open while a field is invalid, so its error is visible.
  const [open, setOpen] = useState(() => Boolean(form.extraBody || form.supportsToolChoice));
  return (
    <Disclosure title="Compatibility" open={open || Boolean(extraBodyError)} onOpenChange={setOpen}>
      <div className={s.grid2}>
        <Field label="Output limit parameter">
          <NativeSelect value={form.maxTokensField} onChange={(e) => set("maxTokensField", e.target.value as typeof form.maxTokensField)}>
            <option value="">Default (max_tokens)</option>
            <option value="max_tokens">max_tokens</option>
            <option value="max_completion_tokens">max_completion_tokens</option>
          </NativeSelect>
        </Field>
        <Field label="System prompt role" description="Some servers (e.g. SGLang) reject the developer role.">
          <NativeSelect
            value={form.supportsDeveloperRole === undefined ? "" : form.supportsDeveloperRole ? "developer" : "system"}
            onChange={(e) => set("supportsDeveloperRole", e.target.value === "" ? undefined : e.target.value === "developer")}
          >
            <option value="">Default (system)</option>
            <option value="system">system</option>
            <option value="developer">developer</option>
          </NativeSelect>
        </Field>
        <Field label="Honours tool_choice" description="Send tool_choice (e.g. required) only if the server honours it.">
          <NativeSelect value={tri(form.supportsToolChoice)} onChange={(e) => set("supportsToolChoice", fromTri(e.target.value))}>
            <option value="">Default (not sent)</option>
            <option value="yes">Yes, send it</option>
            <option value="no">No</option>
          </NativeSelect>
        </Field>
        <Field
          label="Extra request fields (JSON)"
          labelHint="Optional"
          className={s.span2}
          description={
            <>
              A JSON object added to every chat request, for server extensions. For example, <code className={s.mono}>{extraBodyExample}</code> turns off Qwen3 thinking on SGLang or vLLM. It
              can&apos;t set fields Grounded sends itself, such as model, messages, stream or tools.
            </>
          }
          error={extraBodyError}
        >
          <Textarea className={s.mono} rows={3} spellCheck={false} placeholder={extraBodyExample} value={form.extraBody} onChange={(e) => set("extraBody", e.target.value)} />
        </Field>
      </div>
    </Disclosure>
  );
}

/** Embedding quirks: whether the server shortens vectors itself. */
export function EmbeddingCompatFields({ form, set }: Props) {
  return (
    <Checkbox
      className={s.span2}
      label="Server accepts the dimensions parameter"
      description="For Matryoshka models used by profiles with fewer output dimensions. Otherwise Grounded shortens and renormalises the vectors itself."
      checked={form.supportsDimensionsParam}
      onCheckedChange={(v) => set("supportsDimensionsParam", v)}
    />
  );
}
