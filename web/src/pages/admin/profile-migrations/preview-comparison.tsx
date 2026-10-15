/*
 * An index preview's comparison (#18): per evaluation set of the knowledge base, the current index beside the new one (recall, MRR, questions
 * ranked first, and how many questions got better, worse or stayed). Numbers only: evaluation sets are the team's, so the questions are on the
 * knowledge base's page for the team's editors. "Compare again" asks for a fresh pair of runs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { type Comparison, type Migration, mrrText, percentText, previewKey, previewQuery } from "./common";
import p from "./profile-migrations.module.css";

type Set = Comparison["sets"][number];

/** "93% → 94%": the current index, then the new one, for a screen reader too. */
function Pair({ now, next }: { now: string; next: string }) {
  return (
    <span className={p.route}>
      {now} <ArrowRight aria-label="to" /> {next}
    </span>
  );
}

function Changes({ better, worse, same }: { better: number; worse: number; same: number }) {
  return (
    <span className={p.nowrap}>
      {better > 0 && <Badge tone="success" size="sm">{better} better</Badge>}{" "}
      {worse > 0 && <Badge tone="danger" size="sm">{worse} worse</Badge>}{" "}
      {better === 0 && worse === 0 ? `${same} unchanged` : same > 0 ? `${same} same` : null}
    </span>
  );
}

function setRow(x: Set) {
  const done = x.live && x.candidate && x.live.status === "completed" && x.candidate.status === "completed";
  return (
    <Tr key={x.setId}>
      <Td>{x.name}</Td>
      {done ? (
        <>
          <Td numeric>{x.questions.toLocaleString()}</Td>
          <Td numeric>
            <Pair now={percentText(x.live?.summary.recall)} next={percentText(x.candidate?.summary.recall)} />
          </Td>
          <Td numeric>
            <Pair now={mrrText(x.live?.summary.mrr)} next={mrrText(x.candidate?.summary.mrr)} />
          </Td>
          <Td numeric>
            <Pair now={String(x.live?.firstPlace ?? 0)} next={String(x.candidate?.firstPlace ?? 0)} />
          </Td>
          <Td>
            <Changes better={x.better} worse={x.worse} same={x.same} />
          </Td>
        </>
      ) : (
        <Td muted colSpan={5}>
          {x.live?.status === "failed" || x.candidate?.status === "failed" ? "The comparison failed. Compare again." : "Comparing…"}
        </Td>
      )}
    </Tr>
  );
}

export function PreviewComparison({ m, isAdmin }: { m: Migration; isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ ...previewQuery(m.id), enabled: m.status !== "running" });
  const again = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/profile-migrations/{migrationId}/evaluate", { params: { path: { migrationId: m.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: previewKey(m.id) });
      toast.success("Comparing the two indexes again");
    },
  });
  if (m.status === "running") {
    return <Alert tone="info" title="The new index is still being built">The comparison starts by itself when it is ready.</Alert>;
  }
  if (q.isLoading) return <Loading label="Loading the comparison…" />;
  const c = q.data;
  const finished = c?.sets.filter((x) => x.live?.status === "completed" && x.candidate?.status === "completed") ?? [];
  return (
    <Stack gap={4}>
      <ErrorAlert error={q.error ?? again.error} title="Couldn't load the comparison" />
      {c && c.sets.length === 0 && (
        <Alert tone="info" title="Nothing to compare">
          This knowledge base has no evaluation sets with questions. Ask the team to add some (Evaluations), then compare again. You can still switch, or
          discard, on the passages and the cost alone.
        </Alert>
      )}
      {c?.running && (
        <Alert tone="info" title="Comparing the two indexes…">
          {finished.length > 0 ? "The numbers below are from the last comparison that finished." : "The numbers appear here when the first comparison finishes."}
        </Alert>
      )}
      {c && c.sets.length > 0 && (
        <>
          <Table
            caption="Current index → new index, per evaluation set (retrieval only)"
            columns={["Evaluation set", { label: "Questions", numeric: true }, { label: "Recall", numeric: true }, { label: "MRR", numeric: true }, { label: "Ranked first", numeric: true }, "Questions"]}
            density="compact"
          >
            {c.sets.map(setRow)}
            {finished.length > 1 && (
              <Tr>
                <Td>All sets</Td>
                <Td numeric>{c.totals.questions.toLocaleString()}</Td>
                <Td numeric>
                  <Pair now={percentText(c.totals.live.recall)} next={percentText(c.totals.candidate.recall)} />
                </Td>
                <Td numeric>
                  <Pair now={mrrText(c.totals.live.mrr)} next={mrrText(c.totals.candidate.mrr)} />
                </Td>
                <Td numeric>
                  <Pair now={String(c.totals.liveFirstPlace)} next={String(c.totals.candidateFirstPlace)} />
                </Td>
                <Td>
                  <Changes better={c.totals.better} worse={c.totals.worse} same={c.totals.same} />
                </Td>
              </Tr>
            )}
          </Table>
          <p className={s.settingDescription}>
            Better and worse count questions whose expected page ranked higher or lower, or that one index found and the other did not. Differences of
            one or two questions are within noise. Evaluation sets are the team&apos;s, so the questions are on the knowledge base&apos;s page, for its editors.
          </p>
        </>
      )}
      {isAdmin && m.status === "ready" && (
        <div>
          <Button variant="secondary" onClick={() => again.mutate()} loading={again.isPending} disabled={c?.running}>
            <RefreshCw aria-hidden /> Compare again
          </Button>
        </div>
      )}
    </Stack>
  );
}
