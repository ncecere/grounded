/*
 * Metadata filter fields (spec §3): sources, document kinds, tags, URL
 * prefixes and an updated-date range. Used by the agent editor (pinned
 * filters) and the knowledge base retrieval playground.
 */
import { useId, useState } from "react";
import type { Schemas } from "../../api/client";
import { Checkbox, CheckboxGroup } from "@/components/ui/checkbox/checkbox";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import s from "../shared.module.css";
import f from "./filters.module.css";

export type MetadataFilter = Schemas["MetadataFilter"];
type Kind = NonNullable<MetadataFilter["kinds"]>[number];

const kindOptions: { value: Kind; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "pptx", label: "PowerPoint" },
  { value: "html", label: "Web page / HTML" },
  { value: "md", label: "Markdown" },
  { value: "txt", label: "Plain text" },
];

/** Drops empty lists and dates so an unused filter isn't sent. */
export function cleanFilter(v: MetadataFilter | undefined): MetadataFilter | undefined {
  if (!v) return undefined;
  const out: MetadataFilter = {};
  if (v.sourceIds?.length) out.sourceIds = v.sourceIds;
  if (v.kinds?.length) out.kinds = v.kinds;
  if (v.tags?.length) out.tags = v.tags;
  if (v.urlPrefixes?.length) out.urlPrefixes = v.urlPrefixes;
  if (v.updatedAfter) out.updatedAfter = v.updatedAfter;
  if (v.updatedBefore) out.updatedBefore = v.updatedBefore;
  return Object.keys(out).length ? out : undefined;
}

/** "3 filters: sources, tags, dates", or "None". */
export function describeFilter(v: MetadataFilter | undefined) {
  const c = cleanFilter(v);
  if (!c) return "None";
  const parts = [
    c.sourceIds && `${c.sourceIds.length} source${c.sourceIds.length === 1 ? "" : "s"}`,
    c.kinds && c.kinds.map((k) => kindOptions.find((o) => o.value === k)?.label ?? k).join(", "),
    c.tags && `tags: ${c.tags.join(", ")}`,
    c.urlPrefixes && `${c.urlPrefixes.length} URL prefix${c.urlPrefixes.length === 1 ? "" : "es"}`,
    (c.updatedAfter || c.updatedBefore) && "date range",
  ].filter(Boolean);
  return parts.join(" · ");
}

/** RFC 3339 at UTC midnight for a yyyy-mm-dd input, and back. */
const dateToRFC3339 = (d: string) => (d ? `${d}T00:00:00Z` : undefined);
const rfc3339ToDate = (v?: string) => (v ? v.slice(0, 10) : "");

function badPrefix(p: string) {
  try {
    const u = new URL(p);
    return !(u.protocol === "https:" || u.protocol === "http:");
  } catch {
    return true;
  }
}

export function FilterFields({
  value,
  onChange,
  sources,
  idPrefix,
  disabled,
}: {
  value: MetadataFilter | undefined;
  onChange: (next: MetadataFilter) => void;
  /** Sources that can be chosen (e.g. those attached to the knowledge bases). */
  sources: { id: string; name: string }[];
  idPrefix?: string;
  disabled?: boolean;
}) {
  const v = value ?? {};
  const set = (patch: Partial<MetadataFilter>) => onChange({ ...v, ...patch });
  const auto = useId();
  const id = idPrefix ?? auto;
  // URL prefixes are edited as text, one per line; only valid lines are applied.
  const [prefixText, setPrefixText] = useState((v.urlPrefixes ?? []).join("\n"));
  const prefixLines = prefixText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bad = prefixLines.filter(badPrefix);
  const after = rfc3339ToDate(v.updatedAfter);
  const before = rfc3339ToDate(v.updatedBefore);
  const dateError = after && before && before <= after ? "The end date must be after the start date." : undefined;

  return (
    <div className={f.fields} id={id}>
      {sources.length > 0 && (
        <CheckboxGroup
          legend="Sources"
          description="Only search these sources. None checked means every source."
          value={v.sourceIds ?? []}
          onValueChange={(ids) => set({ sourceIds: ids as string[] })}
          disabled={disabled}
        >
          {sources.map((src) => (
            <Checkbox key={src.id} value={src.id} label={src.name} />
          ))}
        </CheckboxGroup>
      )}
      <CheckboxGroup
        legend="Document kinds"
        description="None checked means every kind."
        orientation="horizontal"
        value={v.kinds ?? []}
        onValueChange={(kinds) => set({ kinds: kinds as Kind[] })}
        disabled={disabled}
      >
        {kindOptions.map((k) => (
          <Checkbox key={k.value} value={k.value} label={k.label} />
        ))}
      </CheckboxGroup>
      <Field label="Tags" description="Documents with any of these tags. Press Enter after each tag.">
        <TagInput value={v.tags ?? []} onValueChange={(tags) => set({ tags })} maxTags={50} disabled={disabled} />
      </Field>
      <Field
        label="URL prefixes"
        description="Web pages whose address starts with one of these, one per line, e.g. https://registrar.example.edu/records/."
        error={bad.length ? `Not a web address: ${bad.slice(0, 2).join(", ")}` : undefined}
      >
        <Textarea
          rows={2}
          spellCheck={false}
          className={s.mono}
          value={prefixText}
          disabled={disabled}
          onChange={(e) => {
            setPrefixText(e.target.value);
            const lines = e.target.value
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean);
            if (!lines.some(badPrefix)) set({ urlPrefixes: lines });
          }}
        />
      </Field>
      <div className={s.grid2}>
        <Field label="Updated on or after" labelHint="Optional">
          <Input type="date" value={after} disabled={disabled} onChange={(e) => set({ updatedAfter: dateToRFC3339(e.target.value) })} />
        </Field>
        <Field label="Updated before" labelHint="Optional" error={dateError}>
          <Input type="date" value={before} disabled={disabled} onChange={(e) => set({ updatedBefore: dateToRFC3339(e.target.value) })} />
        </Field>
      </div>
    </div>
  );
}
