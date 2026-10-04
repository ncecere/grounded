/*
 * Compare two runs (docs/evaluations.md §4): the questions that got better,
 * got worse or stayed the same. The other run is ?compare=<run id>; by
 * default the previous completed run of the same kind.
 */
import { StatusBadge } from "@/components/ui/badge/badge";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { useSearchParams } from "@/lib/url-search";
import s from "../../shared.module.css";
import { useTeam } from "../common";
import { resultStatus, runOptionLabel } from "./labels";
import { type EvalRun, type EvalSet, useEvalComparison } from "./queries";

const changeLabels = { better: "Better", worse: "Worse", same: "Same", only_a: "Only in the other run", only_b: "New in this run" } as const;
const changeTones = { better: "success", worse: "danger", same: "neutral", only_a: "neutral", only_b: "info" } as const;
const order = { worse: 0, better: 1, only_b: 2, only_a: 3, same: 4 } as const;

/** Says that two retrieval runs were scored at different k (an agent changed its results per search, for example). */
export function differentK(then: number, now: number) {
  return `The runs checked a different number of results per search (${then}, then ${now}), so the ranks aren't directly comparable.`;
}

/** Completed runs of the same kind other than this one, newest first; the default is the latest one before it. */
export function comparable(run: EvalRun, runs: EvalRun[]) {
  const others = runs.filter((r) => r.id !== run.id && r.kind === run.kind && r.status === "completed").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { others, fallback: others.find((r) => r.createdAt < run.createdAt) ?? others[0] };
}

export function Comparison({ set, run, runs }: { set: EvalSet; run: EvalRun; runs: EvalRun[] }) {
  const { slug } = useTeam();
  const [params, setParams] = useSearchParams();
  const { others, fallback } = comparable(run, runs);
  const other = others.find((r) => r.id === params.get("compare")) ?? fallback;
  const cmp = useEvalComparison(slug, set.id, other?.id, run.id);
  if (!other) return <p className={s.muted}>There is no other completed run of this kind to compare with yet.</p>;
  const items = [...(cmp.data?.items ?? [])].sort((a, b) => order[a.change] - order[b.change]);
  return (
    <Stack gap={4}>
      <Field label="Compare with">
        <NativeSelect
          value={other.id}
          onChange={(ev) =>
            setParams(
              (p) => {
                const out = new URLSearchParams(p);
                out.set("compare", ev.target.value);
                return out;
              },
              { replace: true },
            )
          }
        >
          {others.map((r) => (
            <option key={r.id} value={r.id}>
              {runOptionLabel(r)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {cmp.data && (
        <p role="status">
          Since that run: {cmp.data.better} better, {cmp.data.worse} worse, {cmp.data.same} the same.
          {run.kind === "retrieval" && other.config.resultsPerSearch !== run.config.resultsPerSearch && (
            <> {differentK(other.config.resultsPerSearch, run.config.resultsPerSearch)}</>
          )}
        </p>
      )}
      {items.length > 0 && (
        <Table caption="Questions compared with the other run" columns={["Question", "Change", "Then", "Now"]}>
          {items.map((it, i) => (
            <Tr key={it.questionId ?? `q${i}`}>
              <Td>{it.question}</Td>
              <Td>
                <StatusBadge tone={changeTones[it.change]}>{changeLabels[it.change]}</StatusBadge>
              </Td>
              <Td>{it.a ? `${resultStatus[it.a.status].label}${it.a.rank ? ` (rank ${it.a.rank})` : ""}` : "—"}</Td>
              <Td>{it.b ? `${resultStatus[it.b.status].label}${it.b.rank ? ` (rank ${it.b.rank})` : ""}` : "—"}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </Stack>
  );
}
