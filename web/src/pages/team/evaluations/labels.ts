/* Evaluation words and pure helpers: scores, statuses, triggers, and what changed between runs (the chart's markers). Tested in src/test/evaluations-labels.test.ts. */
import type { EvalExpected, EvalQuestion, EvalResult, EvalRun } from "./queries";

/** 0.834 → "83%"; undefined → "—". */
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

/** MRR with two decimals. */
export const decimal = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

export const kindLabels: Record<EvalRun["kind"], string> = { retrieval: "Retrieval check", answer: "Full-answer check" };

export const triggerLabels: Record<EvalRun["trigger"], string> = {
  manual: "Started by hand",
  agent_published: "After a publish",
  profile_switched: "After a profile switch",
  nightly: "Nightly",
};

type Tone = "success" | "danger" | "warning" | "info" | "neutral";

export const runStatus: Record<EvalRun["status"], { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const resultStatus: Record<EvalResult["status"], { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "success" },
  fail: { label: "Fail", tone: "danger" },
  missing: { label: "Document deleted", tone: "warning" },
  error: { label: "Check failed", tone: "neutral" },
};

/** The run's headline score: recall@k (retrieval) or the pass rate (full answers). */
export const runScore = (r: Pick<EvalRun, "kind" | "summary">) => (r.kind === "answer" ? r.summary.passRate : r.summary.recall);

/** "Recall@4 83%" or "Pass rate 50%". */
export function scoreText(r: Pick<EvalRun, "kind" | "summary">) {
  return r.kind === "answer" ? `Pass rate ${pct(r.summary.passRate)}` : `Recall@${r.summary.k} ${pct(r.summary.recall)}`;
}

/** "3 questions point at documents that were deleted", or "". */
export function missingText(missing: number) {
  if (missing === 0) return "";
  return missing === 1 ? "1 question points at a document that was deleted." : `${missing} questions point at documents that were deleted.`;
}

/** What a run tested, for the chart markers: the version, the profiles and the results per search. */
function configParts(r: EvalRun) {
  const c = r.config;
  return {
    version: c.version === "published" && c.agentVersion ? `v${c.agentVersion}` : c.version === "draft" ? "draft" : "",
    profiles: c.kbs.map((k) => k.profile).join(", "),
    k: c.resultsPerSearch,
  };
}

/** What changed from one run to the next, e.g. ["agent v2 → v3", "results per search 4 → 1"]. */
export function configChanges(prev: EvalRun, next: EvalRun): string[] {
  const a = configParts(prev);
  const b = configParts(next);
  const out: string[] = [];
  if (a.version !== b.version && a.version && b.version) out.push(`agent ${a.version} → ${b.version}`);
  if (a.profiles !== b.profiles && a.profiles && b.profiles) out.push(`embedding profile ${a.profiles} → ${b.profiles}`);
  if (a.k !== b.k && a.k && b.k) out.push(`results per search ${a.k} → ${b.k}`);
  return out;
}

export type Marker = { runId: string; at: string; changes: string[] };

/** The runs of one kind with a score, oldest first, and the configuration changes between them. */
export function scoreSeries(runs: EvalRun[], kind: EvalRun["kind"]) {
  const scored = runs.filter((r) => r.kind === kind && r.status === "completed" && runScore(r) !== undefined).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const markers: Marker[] = [];
  scored.forEach((r, i) => {
    const changes = i > 0 ? configChanges(scored[i - 1]!, r) : [];
    if (changes.length > 0) markers.push({ runId: r.id, at: r.createdAt, changes });
  });
  return { runs: scored, markers };
}

/** The expected documents of a question in words: titles of picked documents, URLs and filenames. */
export function expectedList(q: Pick<EvalQuestion, "expected" | "expectedDocuments">): string[] {
  const title = new Map(q.expectedDocuments.map((d) => [d.id, d.title || d.filename || d.url]));
  return [...q.expected.documentIds.map((id) => title.get(id) ?? "Deleted document"), ...q.expected.urls, ...q.expected.filenames];
}

/** Splits typed expected values (URLs, URL prefixes ending in *, filenames) the way the CSV import does. */
export function splitExpected(values: string[], documentIds: string[]): EvalExpected {
  const urls: string[] = [];
  const filenames: string[] = [];
  for (const v of values.map((x) => x.trim()).filter(Boolean)) {
    if (/^https?:\/\//i.test(v)) urls.push(v);
    else filenames.push(v);
  }
  return { documentIds, urls, filenames };
}

/** The format of an import file, from its name. */
export const importFormat = (name: string): "csv" | "jsonl" => (/\.(jsonl|ndjson)$/i.test(name) ? "jsonl" : "csv");
