/* SystemOne models (ADR-0020, docs/systemone.md): the status editors read, labels, and the admin settings form (pure, unit-tested). */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../api/client";

export type SystemOneStatus = Schemas["SystemOneStatus"];
export type SystemOneSettings = Schemas["SystemOneSettings"];
export type SystemOneJudging = Schemas["SystemOneJudging"];
export type PassageJudgment = Schemas["PassageJudgment"];
export type CitationVerification = NonNullable<Schemas["Citation"]["verification"]>;

/** Whether a usable SystemOne model is configured; everything SystemOne is hidden until it is. */
export function useSystemOneStatus() {
  return useQuery({
    queryKey: ["systemone", "status"],
    queryFn: async () => unwrap(await api.GET("/v1/systemone/status")),
    staleTime: 60_000,
  });
}

export const routeLabels: Record<PassageJudgment["route"], string> = {
  evidence: "Evidence",
  conflicting: "Conflicting",
  dropped: "Dropped",
};

export const reasonLabels: Record<NonNullable<PassageJudgment["reason"]>, string> = {
  injection: "prompt injection",
  irrelevant: "not relevant",
  not_usable: "nothing usable",
};

export const modeLabels: Record<SystemOneJudging["mode"], string> = {
  per_passage: "One request per passage",
  batched: "One request for all passages",
};

/** "20 passages checked, 5 used" for the chat's search steps. */
export function judgedSummary(j: { judged: number; kept: number }) {
  // "kept", not "used": beside "Used 1 source" (a source can give several passages), "2 used" read as a contradiction (US-18).
  return `${j.judged} ${j.judged === 1 ? "passage" : "passages"} checked, ${j.kept} kept`;
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * The agent editor's cost of a SystemOne check (docs/v0.4.1.md §4), from the platform's median added time over the
 * last 14 days ("Adds about 0.4 s per answer (platform median, last 14 days)."); undefined without data.
 */
export function addedTime(ms: number | null | undefined) {
  if (ms == null) return undefined;
  const v = ms < 100 ? "under 0.1 s" : `about ${(ms / 1000).toFixed(1)} s`;
  return `Adds ${v} per answer (platform median, last 14 days).`;
}

const verificationText: Record<CitationVerification, string> = {
  verified: "Verified: the source supports this",
  unsupported: "Not supported by this source",
  contradicted: "Contradicted by this source",
  unchecked: "Not checked",
};

/** The chat's explanation of a citation check, with the model's confidence ("Not supported by this source (92% confidence)"). */
export function verificationLabel(v: CitationVerification, confidence?: number | null) {
  return confidence == null || v === "unchecked" ? verificationText[v] : `${verificationText[v]} (${pct(confidence)} confidence)`;
}

/** The worst verification among cited sources (a group marker [1][2]): contradicted, unsupported, verified; undefined when none was checked. */
export function worstVerification(vs: (CitationVerification | undefined)[]): Exclude<CitationVerification, "unchecked"> | undefined {
  for (const v of ["contradicted", "unsupported", "verified"] as const) if (vs.includes(v)) return v;
  return undefined;
}

/** The admin form: numbers as typed. */
export type SettingsForm = {
  modelId: string;
  enabled: boolean;
  candidates: string;
  mode: SystemOneJudging["mode"];
  timeoutMs: string;
  /** Passage judging time limit, in seconds ("1.5"). */
  timeLimit: string;
  thresholds: Record<keyof Schemas["SystemOneThresholds"], string>;
  citations: { enabled: boolean; mode: Schemas["SystemOneCitations"]["mode"]; autoAccept: string; timeoutMs: string };
  scope: { enabled: boolean; smallTalk: string; inScope: string; timeoutMs: string };
};

const percent = (p: number) => String(Math.round(p * 100));

export const thresholdFields: { key: keyof Schemas["SystemOneThresholds"]; label: string; description: string }[] = [
  { key: "injection", label: "Injection", description: "At or above: dropped as prompt injection (checked first)." },
  { key: "relevant", label: "Relevant", description: "Below: dropped as not relevant." },
  { key: "contradicts", label: "Contradicts", description: "At or above: kept as conflicting evidence." },
  { key: "evidence", label: "Evidence", description: "At or above: kept as evidence. Otherwise dropped as nothing usable." },
];

export function settingsForm(s: SystemOneSettings): SettingsForm {
  const t = s.judging.thresholds;
  return {
    modelId: s.modelId ?? "",
    enabled: s.judging.enabled,
    candidates: String(s.judging.candidates),
    mode: s.judging.mode,
    timeoutMs: String(s.judging.timeoutMs),
    timeLimit: String((s.judging.timeLimitMs ?? defaultTimeLimitMs) / 1000),
    thresholds: { injection: percent(t.injection), relevant: percent(t.relevant), contradicts: percent(t.contradicts), evidence: percent(t.evidence) },
    citations: { enabled: s.citations.enabled, mode: s.citations.mode, autoAccept: percent(s.citations.autoAccept), timeoutMs: String(s.citations.timeoutMs) },
    scope: { enabled: s.scope.enabled, smallTalk: percent(s.scope.smallTalk), inScope: percent(s.scope.inScope), timeoutMs: String(s.scope.timeoutMs) },
  };
}

/** The judging time limit when the server doesn't send one (docs/systemone.md §2). */
const defaultTimeLimitMs = 1500;

/** Seconds as typed ("1.5") in milliseconds, when from min to max seconds. */
const secondsMs = (v: string, min: number, max: number) => {
  const n = Number(v.trim().replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1000) : undefined;
};

const int = (v: string, min: number, max: number) => {
  const n = Number(v.trim().replace(/[,\s]/g, ""));
  return v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/** Fields with an invalid value, by field name. */
export function settingsProblems(f: SettingsForm): Record<string, string> {
  const out: Record<string, string> = {};
  if (int(f.candidates, 1, 50) === undefined) out.candidates = "Enter 1 to 50 candidates.";
  if (int(f.timeoutMs, 500, 60000) === undefined) out.timeoutMs = "Enter a timeout from 500 to 60,000 ms.";
  if (secondsMs(f.timeLimit, 0.5, 10) === undefined) out.timeLimit = "Enter a time limit from 0.5 to 10 seconds.";
  for (const { key, label } of thresholdFields) {
    if (int(f.thresholds[key], 0, 100) === undefined) out[key] = `${label}: enter 0 to 100%.`;
  }
  if (int(f.citations.autoAccept, 0, 100) === undefined) out.autoAccept = "Auto-accept: enter 0 to 100%.";
  if (int(f.citations.timeoutMs, 500, 60000) === undefined) out.citationTimeoutMs = "Enter a citation-check timeout from 500 to 60,000 ms.";
  if (int(f.scope.smallTalk, 0, 100) === undefined) out.smallTalk = "Small talk: enter 0 to 100%.";
  if (int(f.scope.inScope, 0, 100) === undefined) out.inScope = "In scope: enter 0 to 100%.";
  if (int(f.scope.timeoutMs, 500, 60000) === undefined) out.scopeTimeoutMs = "Enter a scope-check timeout from 500 to 60,000 ms.";
  if ((f.enabled || f.citations.enabled || f.scope.enabled) && !f.modelId) out.modelId = "Choose a SystemOne model to turn a SystemOne feature on.";
  return out;
}

/** The PUT body (call after settingsProblems is empty). */
export function settingsInput(f: SettingsForm): Schemas["SystemOneSettingsInput"] {
  const t = (k: keyof SettingsForm["thresholds"]) => (int(f.thresholds[k], 0, 100) ?? 0) / 100;
  return {
    modelId: f.modelId || null,
    judging: {
      enabled: f.enabled,
      candidates: int(f.candidates, 1, 50) ?? 10,
      mode: f.mode,
      timeoutMs: int(f.timeoutMs, 500, 60000) ?? 5000,
      timeLimitMs: secondsMs(f.timeLimit, 0.5, 10) ?? defaultTimeLimitMs,
      thresholds: { injection: t("injection"), relevant: t("relevant"), contradicts: t("contradicts"), evidence: t("evidence") },
    },
    citations: {
      enabled: f.citations.enabled,
      mode: f.citations.mode,
      autoAccept: (int(f.citations.autoAccept, 0, 100) ?? 80) / 100,
      timeoutMs: int(f.citations.timeoutMs, 500, 60000) ?? 20000,
    },
    scope: {
      enabled: f.scope.enabled,
      smallTalk: (int(f.scope.smallTalk, 0, 100) ?? 50) / 100,
      inScope: (int(f.scope.inScope, 0, 100) ?? 20) / 100,
      timeoutMs: int(f.scope.timeoutMs, 500, 60000) ?? 5000,
    },
  };
}

/** How many settings differ from the saved ones. */
export function settingsChanges(saved: SystemOneSettings, f: SettingsForm) {
  const a = settingsForm(saved);
  let n = 0;
  if (a.modelId !== f.modelId) n++;
  if (a.enabled !== f.enabled) n++;
  if (a.candidates !== f.candidates.trim()) n++;
  if (a.mode !== f.mode) n++;
  if (a.timeoutMs !== f.timeoutMs.trim()) n++;
  if (secondsMs(a.timeLimit, 0, Infinity) !== secondsMs(f.timeLimit, 0, Infinity)) n++;
  for (const { key } of thresholdFields) if (a.thresholds[key] !== f.thresholds[key].trim()) n++;
  for (const k of ["enabled", "mode", "autoAccept", "timeoutMs"] as const) if (String(a.citations[k]).trim() !== String(f.citations[k]).trim()) n++;
  for (const k of ["enabled", "smallTalk", "inScope", "timeoutMs"] as const) if (String(a.scope[k]).trim() !== String(f.scope[k]).trim()) n++;
  return n;
}
