/* Evaluation words and pure helpers: scores, statuses, triggers, and what changed between runs (the chart's markers). Tested in src/test/evaluations-labels.test.ts. */
import { formatDate } from "@/lib/format";
import { plural } from "../common";
import type { EvalExpected, EvalQuestion, EvalResult, EvalRun, EvalSummary } from "./queries";

/** 0.834 → "83%"; undefined → "—". */
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

/** MRR with two decimals. */
export const decimal = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

/** Run kinds (no "check": that word is SystemOne's per-answer checks). */
export const kindLabels: Record<EvalRun["kind"], string> = { retrieval: "Retrieval", answer: "Full answer" };

/** "Retrieval run · Sep 28, 2026, 7:20 PM". */
export const runTitle = (r: Pick<EvalRun, "kind" | "createdAt">) => `${kindLabels[r.kind]} run · ${formatDate(r.createdAt)}`;

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
  missing: { label: "Not scored", tone: "warning" },
  error: { label: "Check failed", tone: "neutral" },
};

/** A full answer that passed on its citation alone: the question has no must-mention phrases. */
export const citedOnly = (r: Pick<EvalResult, "status" | "scores">) => r.status === "pass" && r.scores !== null && r.scores !== undefined && r.scores.mentions.length === 0;

/**
 * A result's label: a pass that only cited the right source says so, and a
 * question that wasn't scored says why (not in this knowledge base, or
 * deleted since; older results only knew it was missing).
 */
export function resultLabel(r: Pick<EvalResult, "status" | "scores" | "missingReason">): { label: string; tone: Tone } {
  if (citedOnly(r)) return { label: "Cited the right source (content not checked)", tone: "info" };
  if (r.status === "missing") {
    if (r.missingReason === "not_indexed") return { label: "Not in this knowledge base", tone: "warning" };
    if (r.missingReason === "deleted") return { label: "Document deleted", tone: "warning" };
    return { label: "Expected document missing", tone: "warning" };
  }
  return resultStatus[r.status];
}

/** The run's headline score: recall@k (retrieval) or the pass rate (full answers). */
export const runScore = (r: Pick<EvalRun, "kind" | "summary">) => (r.kind === "answer" ? r.summary.passRate : r.summary.recall);

/** The score's metric in words, for its tooltip. */
export function scoreHelp(r: Pick<EvalRun, "kind" | "summary">) {
  return r.kind === "answer"
    ? "Pass rate: the share of answers that cited an expected document and mentioned every must-mention phrase."
    : `Recall@${r.summary.k}: the share of questions whose expected document came back in the top ${r.summary.k} results.`;
}

/** "83% (recall@4)" or "50% (pass rate)", where the metric has to be in the text. */
export function scoreText(r: Pick<EvalRun, "kind" | "summary">) {
  return r.kind === "answer" ? `${pct(r.summary.passRate)} (pass rate)` : `${pct(r.summary.recall)} (recall@${r.summary.k})`;
}

/** What MRR means, where it's shown. */
export const mrrHelp = "Mean reciprocal rank: how high the first expected document comes back, on average (1 = always first, 0.5 = second).";

/** Why questions weren't scored: "1 question expects a document that isn't in the knowledge base. 1 points at a deleted document.", or "". */
export function missingText(s: Pick<EvalSummary, "missing" | "notIndexed">) {
  const never = Math.min(s.notIndexed ?? 0, s.missing);
  const gone = s.missing - never;
  const parts: string[] = [];
  if (never > 0) parts.push(never === 1 ? "1 question expects a document that isn't in the knowledge base." : `${never} questions expect documents that aren't in the knowledge base.`);
  if (gone > 0) parts.push(gone === 1 ? "1 question points at a document that was deleted." : `${gone} questions point at documents that were deleted.`);
  return parts.join(" ");
}

/** The run's result in one sentence: "1 of 2 questions found the right page." or "1 of 2 answers passed." */
export function outcomeText(r: Pick<EvalRun, "kind" | "summary" | "status" | "done" | "total">) {
  if (r.status === "queued") return "Waiting to start.";
  if (r.status === "running") return `Checking the questions: ${r.done} of ${r.total} done.`;
  const s = r.summary;
  const scored = s.passed + s.failed;
  if (scored === 0) return r.status === "completed" ? "No question could be scored." : "No question was scored.";
  if (r.kind === "retrieval") return `${s.passed} of ${plural(scored, "question")} found the right page.`;
  const only = s.citedOnly ? ` ${s.citedOnly} of them only cited the right source: add must-mention phrases to check what they say.` : "";
  return `${s.passed} of ${plural(scored, "answer")} passed.${only}`;
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

/** Who hears about a drop, and how (the "Run automatically" switch; notify catalog evaluation.regression). */
export const autoRunNotice =
  "If recall drops by more than 5 points or a question that passed now fails, the team's editors, admins and owners get an “Evaluation scores dropped” notification in the app, and by email where the platform sends email. Each person can turn it off in their notification settings.";
