/* The analytics date range: presets and custom UTC dates. */
import { useState } from "react";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { daysAgo, iso } from "./format";
import an from "./analytics.module.css";

export type Range = { from: string; to: string };

/** The range state (default: the last 30 days) and whether it is usable. */
export function useRange() {
  const [range, setRange] = useState<Range>(() => ({ from: daysAgo(29), to: iso(new Date()) }));
  const invalid = !range.from || !range.to || range.from > range.to;
  return { range, setRange, invalid };
}

const presets = [
  { value: "6", label: "Last 7 days" },
  { value: "29", label: "Last 30 days" },
  { value: "89", label: "Last 90 days" },
  { value: "364", label: "Last 12 months" },
];

export function RangePicker({ range, onChange, invalid }: { range: Range; onChange: (r: Range) => void; invalid: boolean }) {
  const [preset, setPreset] = useState("29");
  return (
    <div className={an.rangeBar} role="group" aria-label="Date range">
      <Field label="Range" className={an.rangeField}>
        <NativeSelect
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            if (e.target.value !== "custom") onChange({ from: daysAgo(Number(e.target.value)), to: iso(new Date()) });
          }}
        >
          {presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </NativeSelect>
      </Field>
      <Field label="From (UTC)" className={an.rangeField}>
        <Input type="date" value={range.from} max={range.to} onChange={(e) => (setPreset("custom"), onChange({ ...range, from: e.target.value }))} />
      </Field>
      <Field label="To (UTC)" className={an.rangeField} error={invalid ? "Choose a start before the end." : undefined}>
        <Input type="date" value={range.to} min={range.from} onChange={(e) => (setPreset("custom"), onChange({ ...range, to: e.target.value }))} />
      </Field>
    </div>
  );
}
