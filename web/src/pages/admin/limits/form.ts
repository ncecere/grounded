/* Form state for the limits pages and what it means to save it (pure, unit-tested). */
import type { Schemas } from "@/api/client";
import { type LimitKey, formatLimit, fromInput, toInput } from "@/lib/limits";

type PlatformLimit = Schemas["PlatformLimit"];
type TeamOverride = Schemas["TeamLimitOverride"];

// ---- platform defaults and ceilings ---------------------------------------------

export type PlatformRow = { def: string; ceil: string };
export type PlatformForm = Record<string, PlatformRow>;

export function platformForm(items: PlatformLimit[]): PlatformForm {
  return Object.fromEntries(items.map((it) => [it.key, { def: toInput(it.unit, it.default), ceil: toInput(it.unit, it.ceiling) }]));
}

export function platformErrors(it: PlatformLimit, f: PlatformRow) {
  const def = fromInput(it.unit, f.def);
  const ceil = fromInput(it.unit, f.ceil);
  const out: { def?: string; ceil?: string } = {};
  const bad = it.unit === "bytes" ? "Enter a size in GiB, or leave empty." : "Enter a whole number, or leave empty.";
  if (def === undefined) out.def = bad;
  if (ceil === undefined) out.ceil = bad;
  const tooMuch = `Enter at most ${it.max}, the most Grounded allows.`;
  if (it.max !== undefined && def != null && def > it.max) out.def = tooMuch;
  if (it.max !== undefined && ceil != null && ceil > it.max) out.ceil = tooMuch;
  if (def !== undefined && ceil !== undefined && ceil !== null && (def === null || def > ceil)) {
    out.def = "The default can't be above the ceiling.";
  }
  return out;
}

/** The rows that differ from the server and parse (invalid rows are skipped). */
export function platformChanges(items: PlatformLimit[], form: PlatformForm | null) {
  if (!form) return [];
  return items.flatMap((it) => {
    const f = form[it.key]!;
    const def = fromInput(it.unit, f.def);
    const ceil = fromInput(it.unit, f.ceil);
    if (def === undefined || ceil === undefined || (def === it.default && ceil === it.ceiling)) return [];
    return [{ key: it.key, default: def, ceiling: ceil }];
  });
}

export function platformInvalid(items: PlatformLimit[], form: PlatformForm | null) {
  return form ? items.some((it) => Object.keys(platformErrors(it, form[it.key]!)).length > 0) : false;
}

// ---- one team's overrides -------------------------------------------------------

export type OverrideMode = "inherit" | "custom" | "blocked";
export type OverrideRow = { mode: OverrideMode; value: string };
export type OverrideForm = Record<string, OverrideRow>;

export function overrideForm(items: TeamOverride[]): OverrideForm {
  return Object.fromEntries(
    items.map((it) => [
      it.key,
      it.override === null
        ? { mode: "inherit", value: "" }
        : it.override === 0
          ? { mode: "blocked", value: "" }
          : { mode: "custom", value: toInput(it.unit, it.override) },
    ]),
  );
}

/** The override a row asks for: null (inherit), 0 (blocked), a number, or undefined when invalid. */
export function desired(it: TeamOverride, f: OverrideRow): number | null | undefined {
  if (f.mode === "inherit") return null;
  if (f.mode === "blocked") return 0;
  const v = fromInput(it.unit, f.value);
  return v === null || v === 0 ? undefined : v;
}

export function overrideError(it: TeamOverride, f: OverrideRow) {
  if (f.mode !== "custom") return undefined;
  const v = desired(it, f);
  if (v === undefined) return it.unit === "bytes" ? "Enter a size in GiB above 0." : "Enter a whole number above 0.";
  if (v !== null && it.max !== undefined && v > it.max) return `Enter at most ${it.max}, the most Grounded allows.`;
  if (v !== null && it.ceiling !== null && v > it.ceiling && v !== it.override) {
    return `The platform ceiling is ${formatLimit(it.unit, it.period, it.ceiling)}.`;
  }
  return undefined;
}

export function overrideChanges(items: TeamOverride[], form: OverrideForm | null) {
  if (!form) return [];
  return items.flatMap((it) => {
    const v = desired(it, form[it.key]!);
    return v === undefined || v === it.override ? [] : [{ key: it.key as LimitKey, value: v }];
  });
}

export function overrideInvalid(items: TeamOverride[], form: OverrideForm | null) {
  return form ? items.some((it) => overrideError(it, form[it.key]!) !== undefined) : false;
}

/** The value that would apply if the row were saved: the override or default, capped by the ceiling and the maximum. */
export function effectiveLimit(it: TeamOverride, f: OverrideRow) {
  const next = desired(it, f);
  if (next === undefined) return it.effective;
  const base = next === null ? it.default : next;
  const capped = it.ceiling !== null && (base === null || base > it.ceiling) ? it.ceiling : base;
  return it.max !== undefined && (capped === null || capped > it.max) ? it.max : capped;
}

/** The save bar's message: "Unsaved changes · 1 limit". */
export const unsaved = (n: number) => `Unsaved changes · ${n === 1 ? "1 limit" : `${n} limits`}`;
