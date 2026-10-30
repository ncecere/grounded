/*
 * The team's Content health page (docs/content-health.md, ADR-0027): a report of where the team's knowledge may need attention, made
 * in the background on request. Editors, admins and owners; others get the not-found page (members are told it is for editors).
 * Opening the page reads stored reports only: nothing is computed, fetched or checked until someone asks for a report.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { NotFoundState } from "@/components/not-found";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { NativeSelect } from "@/components/ui/input/input";
import { Field } from "@/components/ui/field/field";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import sh from "../../shared.module.css";
import { EditorsOnlyState } from "../access";
import { useTeam } from "../common";
import { MakeReport } from "./make-report";
import { ReportView } from "./report-view";
import { RetainedReports } from "./retained-reports";
import { reportsQuery } from "./queries";

export const contentHealthDescription =
  "Where your knowledge may need attention: documents not processed in a long time, links a crawl saw fail, the same file in two sources, documents with no retained citation evidence, and documents that failed to parse. It is a list of places to look, not a score of quality.";

export function TeamContentHealthPage() {
  const { slug, role } = useTeam();
  const editor = role === "editor" || role === "admin" || role === "owner";
  if (role === "member") return <EditorsOnlyState title="Content health" what="content health reports" />;
  if (!editor) return <NotFoundState />;
  return (
    <Stack gap={6} className={sh.page}>
      <PageHeader title="Content health" description={contentHealthDescription} />
      <Body team={slug} />
    </Stack>
  );
}

function Body({ team }: { team: string }) {
  const q = useQuery(reportsQuery(team));
  const [chosen, setChosen] = useState<string>();
  if (q.error) return <ErrorAlert error={q.error} title="Couldn't load the reports" />;
  if (!q.data) return <Skeleton height="8rem" />;
  if (!q.data.enabled)
    return (
      <>
        <Card>
          <EmptyState
            icon={<HeartPulse />}
            title="Content health reports are switched off."
            description="A platform admin can turn them on in Admin → Settings → Features. Nothing is checked while they are off."
          />
        </Card>
        <RetainedReports team={team} reports={q.data.reports} />
      </>
    );
  const { reports, limits } = q.data;
  const current = reports.find((r) => r.id === chosen) ?? reports[0];
  return (
    <>
      <Alert tone="info" title="How the report works">
        It is made in the background from what Grounded already knows about this team's own sources. No website is fetched, no AI model is used, and nothing is changed or deleted. Documents from shared platform sources are not included. Reports are kept
        for {limits.retentionDays} days, the latest {limits.keepReports} per team, and findings disappear when their document or source is deleted.
      </Alert>
      <MakeReport team={team} limits={limits} active={reports.some((r) => r.status === "queued" || r.status === "running")} onMade={setChosen} />
      {reports.length > 1 && (
        <Field label="Report" description="Older reports are kept for a while so you can compare.">
          <NativeSelect value={current?.id} onChange={(e) => setChosen(e.target.value)}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleString()} · {r.status}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {current ? (
        <ReportView team={team} report={current} limits={limits} />
      ) : (
        <Card>
          <EmptyState
            icon={<HeartPulse />}
            title="No report yet."
            description="Make one above. Until then nothing is measured, so this page shows no counts: an empty list is never shown as healthy."
          />
        </Card>
      )}
    </>
  );
}
