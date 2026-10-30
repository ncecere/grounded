/*
 * One report (docs/content-health.md): when and how it was made, a card per signal with what it counts and what it does not mean,
 * the findings of the chosen signal, and what the report knew about each source. A signal that could not be measured says so;
 * a count of zero is shown only for a signal that was measured.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Stack } from "@/components/ui/layout/layout";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import { Time } from "@/components/ui/time/time";
import { useTeam } from "../common";
import { Findings } from "./findings";
import { SourceCoverage } from "./source-coverage";
import s from "./content-health.module.css";
import { type Report, type ReportList, type Signal, type SignalName, failureText, healthKey, reasonText, reportKey, reportQuery, signalOrder, signalWords, statusLabel, stateLabel, stateTone, activeStatus } from "./queries";

export function ReportView({ team, report, limits }: { team: string; report: Report; limits: ReportList["limits"] }) {
  const { archived } = useTeam();
  const qc = useQueryClient();
  const detail = useQuery(reportQuery(team, report.id));
  const live = detail.data?.report ?? report;
  const [shown, setShown] = useState<SignalName>();
  const [deleting, setDeleting] = useState<Report | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: healthKey(team) });
    void qc.invalidateQueries({ queryKey: reportKey(team, report.id) });
  };
  const cancel = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/teams/{team}/content-health/reports/{reportId}/cancel", { params: { path: { team, reportId: report.id } } })),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: async () => {
      const r = await api.DELETE("/v1/teams/{team}/content-health/reports/{reportId}", { params: { path: { team, reportId: report.id } } });
      if (r.error) throw r.error;
    },
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: healthKey(team) });
    },
  });
  const bySignal = new Map(live.signals.map((x) => [x.signal, x]));
  return (
    <Stack>
      <Card
        title="Report"
        titleAs="h2"
        actions={
          activeStatus(live.status) ? (
            <Button variant="secondary" loading={cancel.isPending} disabled={archived} onClick={() => cancel.mutate()}>
              Cancel report
            </Button>
          ) : (
            <Button variant="danger" disabled={archived} onClick={() => setDeleting(live)}>
              Delete report
            </Button>
          )
        }
      >
        <ApiErrorAlert error={cancel.error} title="Couldn't cancel the report" />
        <Facts report={live} limits={limits} />
        {activeStatus(live.status) && (
          <Alert tone="info" title={statusLabel[live.status]}>
            The report is made in the background. This page updates by itself; you can leave it.
          </Alert>
        )}
        {live.status === "failed" && <Alert tone="danger">{failureText[live.errorCode] ?? failureText.internal}</Alert>}
        {live.status === "cancelled" && <Alert tone="info">This report was cancelled. Nothing was stored.</Alert>}
      </Card>
      {live.status === "completed" && (
        <>
          <ul className={s.signals} aria-label="Signals">
            {signalOrder.map((name) => {
              const sig = bySignal.get(name);
              return sig ? <SignalCard key={name} signal={sig} shown={shown === name} onShow={() => setShown(name)} /> : null;
            })}
          </ul>
          {shown ? <Findings key={`${live.id}:${shown}`} team={team} report={live} signal={shown} /> : <Alert tone="info">Choose "Show findings" on a signal to see which documents or addresses it found.</Alert>}
          {detail.data ? <SourceCoverage sources={detail.data.sources} team={team} /> : <Skeleton height="4rem" />}
        </>
      )}
      <ConfirmMutationDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={del}
        onConfirm={() => del.mutate()}
        title="Delete this report?"
        description="The report and its findings are removed. Your documents and sources are not touched. You can make a new report."
        confirmLabel="Delete report"
      />
    </Stack>
  );
}

function Facts({ report, limits }: { report: Report; limits: ReportList["limits"] }) {
  return (
    <dl className={s.facts}>
      <div>
        <dt>Status</dt>
        <dd>
          <Badge tone={report.status === "completed" ? "success" : report.status === "failed" ? "danger" : "neutral"}>{statusLabel[report.status]}</Badge>
        </dd>
      </div>
      <div>
        <dt>As of</dt>
        <dd>{report.asOf ? <Time value={report.asOf} format="long" fallback="—" /> : "Not started yet"}</dd>
      </div>
      <div>
        <dt>Not processed for</dt>
        <dd>{report.staleDays.toLocaleString()} days or more</dd>
      </div>
      <div>
        <dt>Citation window</dt>
        <dd>up to {report.citationWindowDays.toLocaleString()} days (needs at least {limits.minAnswers} kept answers)</dd>
      </div>
      <div>
        <dt>Scope</dt>
        <dd>{report.sourceId ? "One source" : report.knowledgeBaseId ? "One knowledge base's sources" : "All of the team's sources"}</dd>
      </div>
      {report.expiresAt && (
        <div>
          <dt>Kept until</dt>
          <dd>
            <Time value={report.expiresAt} format="long" fallback="—" />
          </dd>
        </div>
      )}
    </dl>
  );
}

function SignalCard({ signal, shown, onShow }: { signal: Signal; shown: boolean; onShow: () => void }) {
  const w = signalWords[signal.signal];
  const measured = signal.state === "measured";
  return (
    <li className={s.signal} data-shown={shown || undefined}>
      <h3 className={s.signalTitle}>{w.title}</h3>
      <Badge tone={stateTone[signal.state]}>{stateLabel[signal.state]}</Badge>
      {measured ? (
        <p className={s.count}>
          <strong>{signal.found.toLocaleString()}</strong> {signal.signal === "duplicate" ? (signal.found === 1 ? "group" : "groups") : "found"}
          {signal.truncated && <span className={s.muted}>, showing the first {signal.listed.toLocaleString()}</span>}
          {!signal.truncated && signal.listed < signal.found && <span className={s.muted}>, {signal.listed.toLocaleString()} still listed (some were deleted since)</span>}
        </p>
      ) : (
        <p className={s.count}>{reasonText[signal.reason] ?? "Not measured."}</p>
      )}
      <p className={s.muted}>{w.measures}</p>
      {signal.signal === "never_cited" && measured && <NeverCitedNotes signal={signal} />}
      <Disclosure title="What this does not mean">
        <p>{w.notMeans}</p>
      </Disclosure>
      <Button variant="secondary" size="sm" aria-pressed={shown} disabled={!measured || signal.listed === 0} onClick={onShow}>
        Show findings
        <span className={s.visuallyHidden}>: {w.title}</span>
      </Button>
      {measured && signal.listed === 0 && signal.found === 0 && <p className={s.muted}>{w.empty}</p>}
    </li>
  );
}

function NeverCitedNotes({ signal }: { signal: Signal }) {
  const c = signal.counts;
  return (
    <p className={s.muted}>
      Looked at {(c.answers ?? 0).toLocaleString()} kept answers since <Time value={signal.observedSince} format="long" fallback="—" />; judged {(c.judged ?? 0).toLocaleString()}{" "}
      documents, and left out {(c.tooNew ?? 0).toLocaleString()} that are too new to judge.
    </p>
  );
}
