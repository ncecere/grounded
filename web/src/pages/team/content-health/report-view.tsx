/*
 * One report (docs/content-health.md): when and how it was made, a card per signal with what it counts and what it does not mean,
 * the findings of the chosen signal, and what the report knew about each source. A signal that could not be measured says so;
 * a count of zero is shown only for a signal that was measured.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { useReportActions } from "./report-actions";
import { SourceCoverage } from "./source-coverage";
import s from "./content-health.module.css";
import { type Report, type ReportList, type Signal, type SignalName, failureText, reasonText, reportQuery, signalOrder, signalWords, statusLabel, stateLabel, stateTone, activeStatus } from "./queries";

export function ReportView({ team, report, limits }: { team: string; report: Report; limits: ReportList["limits"] }) {
  const { archived } = useTeam();
  const detail = useQuery(reportQuery(team, report.id));
  const live = detail.data?.report ?? report;
  const [shown, setShown] = useState<SignalName>();
  const [deleting, setDeleting] = useState<Report | null>(null);
  const { cancel, del } = useReportActions(team, report.id, () => setDeleting(null));
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
          <Alert tone="info" title="As of the report">
            The counts on the cards and in the source table are as of when the report was made. The findings are checked against your sources each time you open them, so a deleted document, a source that left the report's scope, or an address whose
            source or crawl changed is no longer listed, and "still listed" can be lower than "found".
          </Alert>
          <ul className={s.signals} aria-label="Signals">
            {signalOrder.map((name) => {
              const sig = bySignal.get(name);
              return sig ? <SignalCard key={name} signal={sig} shown={shown === name} onShow={() => setShown(name)} /> : null;
            })}
          </ul>
          {shown ? <Findings key={`${live.id}:${shown}`} team={team} report={live} signal={shown} /> : <Alert tone="info">Choose "Show findings" on a signal to see which documents or addresses it found.</Alert>}
          {detail.data ? <SourceCoverage sources={detail.data.sources} team={team} minAnswers={limits.minAnswers} /> : <Skeleton height="4rem" />}
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
        <dd>
          Team-wide, up to {report.citationWindowDays.toLocaleString()} days, from the team's first kept answer (needs at least {limits.minAnswers} kept answers that could have cited something)
        </dd>
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
          {!signal.truncated && signal.listed < signal.found && (
            <span className={s.muted}>
              , {signal.listed.toLocaleString()} {signal.signal === "duplicate" ? (signal.listed === 1 ? "group" : "groups") : ""} still listed now (the rest were deleted, left the report's scope, or no longer hold: a source or crawl changed)
            </span>
          )}
        </p>
      ) : (
        <p className={s.count}>{reasonText[signal.reason] ?? "Not measured."}</p>
      )}
      <p className={s.muted}>{w.measures}</p>
      {signal.signal === "never_cited" && (measured || signal.reason === "no_exposure") && <NeverCitedNotes signal={signal} />}
      {signal.signal === "stale" && measured && (signal.counts.recentlyConfirmed ?? 0) > 0 && (
        <p className={s.muted}>
          {signal.counts.recentlyConfirmed?.toLocaleString()} of these were seen again by a crawl within the threshold: they are old by processing date, not necessarily neglected.
        </p>
      )}
      {(signal.counts.vanished ?? 0) > 0 && <p className={s.muted}>{signal.counts.vanished?.toLocaleString()} found while it ran were deleted or moved before the report was stored and are not counted.</p>}
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
      <strong>Not a quality or fair-exposure claim.</strong> Team-wide window since <Time value={signal.observedSince} format="long" fallback="—" />, the team's first kept answer in the window, not
      the time any document became reachable. {(c.answers ?? 0).toLocaleString()} kept answers could have cited something. Judged {(c.judged ?? 0).toLocaleString()} documents; left out{" "}
      {(c.notServed ?? 0).toLocaleString()} that no published agent reaches, {(c.fewAnswers ?? 0).toLocaleString()} whose source saw too few answers since it became reachable, and{" "}
      {(c.tooNew ?? 0).toLocaleString()} added after that.
    </p>
  );
}
