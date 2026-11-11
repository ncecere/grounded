/*
 * The fields of a connector source: its settings (from the type's schema), its credentials and its schedule. Used by
 * the "New data source" page and the source's Settings tab.
 */
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import type { Schemas } from "../../api/client";
import type { SchemaField, SettingsValues } from "./schema-form";
import { type SourceTypeInfo, syncScheduleLabels } from "./types";

type SettingsProps = {
  fields: SchemaField[];
  values: SettingsValues;
  onChange: (values: SettingsValues) => void;
  errors: Record<string, string>;
  disabled?: boolean;
};

/** One field per property of the type's settings schema. */
export function SettingsFields({ fields, values, onChange, errors, disabled }: SettingsProps) {
  const set = (key: string, value: SettingsValues[string]) => onChange({ ...values, [key]: value });
  return (
    <>
      {fields.map((f) => {
        const error = errors[f.key];
        const hint = f.required ? undefined : "Optional";
        if (f.kind === "boolean")
          return (
            <Checkbox key={f.key} label={f.label} description={f.help} checked={values[f.key] === true} disabled={disabled} onCheckedChange={(on) => set(f.key, on === true)} />
          );
        if (f.kind === "list")
          return (
            <Field key={f.key} label={f.label} labelHint={hint} description={f.help} error={error}>
              <TagInput
                value={(values[f.key] as string[]) ?? []}
                onValueChange={(list) => set(f.key, list)}
                normalize={(t) => t.trim()}
                maxTagLength={500}
                noun={{ one: "entry", other: "entries" }}
                disabled={disabled}
                aria-required={f.required}
              />
            </Field>
          );
        const value = (values[f.key] as string) ?? "";
        return (
          <Field key={f.key} label={f.label} labelHint={hint} description={f.help} error={error}>
            {f.kind === "choice" ? (
              <NativeSelect value={value} disabled={disabled} aria-required={f.required} onChange={(e) => set(f.key, e.target.value)}>
                {!f.required && <option value="">Not set</option>}
                {f.required && value === "" && <option value="">Choose…</option>}
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </NativeSelect>
            ) : f.kind === "multiline" ? (
              <Textarea rows={4} value={value} disabled={disabled} aria-required={f.required} maxLength={f.property.maxLength} onChange={(e) => set(f.key, e.target.value)} />
            ) : f.kind === "number" ? (
              <NumberInput value={value} disabled={disabled} aria-required={f.required} maximumFractionDigits={f.integer ? 0 : 3} onValueChange={(v) => set(f.key, v)} />
            ) : (
              <Input value={value} disabled={disabled} aria-required={f.required} maxLength={f.property.maxLength} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </Field>
        );
      })}
    </>
  );
}

type CredentialProps = {
  type: SourceTypeInfo;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  errors: Record<string, string>;
  /** The credentials that already have a stored value (editing): leaving one empty keeps it. */
  stored?: string[];
  disabled?: boolean;
};

/** The type's credentials. A stored value is never shown; typing a new one replaces it. */
export function CredentialFields({ type, values, onChange, errors, stored, disabled }: CredentialProps) {
  return (
    <>
      {type.credentials.map((f) => {
        const has = stored?.includes(f.key) ?? false;
        const help = [f.help, has ? "A value is stored. Leave this empty to keep it." : ""].filter(Boolean).join(" ");
        return (
          <Field key={f.key} label={f.label} labelHint={f.required ? undefined : "Optional"} description={help || undefined} error={errors[f.key]}>
            <Input
              type={f.secret ? "password" : "text"}
              autoComplete={f.secret ? "new-password" : "off"}
              spellCheck={false}
              value={values[f.key] ?? ""}
              disabled={disabled}
              aria-required={f.required && !has}
              placeholder={has ? "Stored" : undefined}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            />
          </Field>
        );
      })}
    </>
  );
}

/** Which required credentials have no value (new sources, and stored ones being replaced by nothing). */
export function validateCredentials(type: SourceTypeInfo, values: Record<string, string>, stored: string[] = []): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of type.credentials) {
    if (f.required && !stored.includes(f.key) && !(values[f.key] ?? "").trim()) errors[f.key] = `Enter ${f.label.toLowerCase()}.`;
  }
  return errors;
}

/** The credentials to send: only the ones that were typed. */
export function credentialsBody(values: Record<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v.trim()) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

type Schedule = Schemas["SyncSchedule"];

export function ScheduleField({ value, onChange, disabled }: { value: Schedule; onChange: (v: Schedule) => void; disabled?: boolean }) {
  return (
    <Field label="Sync" description="How often the source fetches what changed. You can always sync it by hand.">
      <NativeSelect value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Schedule)}>
        {(Object.keys(syncScheduleLabels) as Schedule[]).map((k) => (
          <option key={k} value={k}>
            {syncScheduleLabels[k]}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
