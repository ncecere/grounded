/*
 * Questions that need attention (docs/evaluations.md §1, docs/v0.4.1.md §2):
 * the question form's check, run by the server for every question of the
 * set when the page opens (expected documents not in the knowledge base,
 * must-mention phrases in no source), and "out of reach" (the expected
 * page wasn't in the top 50 in each of the last 3 retrieval runs). They
 * show as a count in the set's header, a "Needs attention" filter and
 * column on the Questions tab, a note on the question's record page, and
 * the run dialog's "can't pass" count. Warnings only: nothing is blocked.
 */
import { Link } from "@tanstack/react-router";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { plural } from "../common";
import { checkWarnings } from "./question-fields";
import type { EvalProblem, EvalQuestion, EvalRun } from "./queries";
import e from "./evaluations.module.css";

/** The out-of-reach warning: "Expected page not found in the top 50 (last 3 runs)." */
export const outOfReachText = (p: NonNullable<EvalProblem["outOfReach"]>) => `Expected page not found in the top ${p.depth} (last ${p.runs} runs).`;

/** The problems by question. */
export const problemsById = (list: EvalProblem[] | undefined) => new Map((list ?? []).map((p) => [p.questionId, p]));

/** A question's problems in words, as the question form says them, then out of reach. */
export function problemTexts(p: EvalProblem, where: string, answers: boolean): string[] {
  const w = checkWarnings({ expected: p.expected, mustMention: p.mustMention.map((phrase) => ({ phrase, found: false })) }, where, answers);
  return [...w.expected, ...w.phrases, ...(p.outOfReach ? [outOfReachText(p.outOfReach)] : [])];
}

/** A question that can't pass a run of this kind: no expected document is indexed, or (full answers) a must-mention phrase is in no source. */
export const cantPass = (p: EvalProblem, kind: EvalRun["kind"]) => p.missingReason !== null || (kind === "answer" && p.mustMention.length > 0);

/** The run dialog's warning: "4 questions can't pass: their expected pages aren't indexed. …", or undefined when every question can. */
export function cantPassText(list: EvalProblem[] | undefined, kind: EvalRun["kind"]) {
  const blocked = (list ?? []).filter((p) => cantPass(p, kind));
  if (blocked.length === 0) return undefined;
  const one = blocked.length === 1;
  const pages = blocked.some((p) => p.missingReason !== null);
  const phrases = kind === "answer" && blocked.some((p) => p.missingReason === null);
  const why = [
    pages ? (one ? "none of its expected pages is indexed" : "their expected pages aren't indexed") : "",
    phrases ? "a must-mention phrase is in no source" : "",
  ]
    .filter(Boolean)
    .join(", or ");
  return `${plural(blocked.length, "question")} can't pass: ${why}. You can still start the run.`;
}

/** The Questions tab's filter: All or Needs attention (?attention=needs). */
export function attentionFacet(problems: Map<string, EvalProblem>): Facet<EvalQuestion> {
  return {
    id: "attention",
    label: "Show",
    type: "toggle",
    allLabel: "All questions",
    accessor: (q) => (problems.has(q.id) ? "needs" : "ok"),
    options: [{ value: "needs", label: "Needs attention" }],
  };
}

/** A link to the latest result's diagnosis (the Runs tab with the run and the result open). */
export function LatestResultLink({ outOfReach }: { outOfReach: NonNullable<EvalProblem["outOfReach"]> }) {
  const search = ((prev: Record<string, unknown>) => ({ ...prev, tab: "runs", record: outOfReach.runId, result: outOfReach.resultId, attention: undefined })) as never;
  return <TextLink render={<Link to="." search={search} />}>See the latest result</TextLink>;
}

/** The Needs attention column: what's wrong, in words, and for out of reach a link to the latest result. */
export function AttentionCell({ problem, where, answers }: { problem: EvalProblem | undefined; where: string; answers: boolean }) {
  if (!problem) return null;
  return (
    <ul className={e.attention}>
      {problemTexts(problem, where, answers).map((t) => (
        <li key={t}>{t}</li>
      ))}
      {problem.outOfReach && (
        <li>
          <LatestResultLink outOfReach={problem.outOfReach} />
        </li>
      )}
    </ul>
  );
}
