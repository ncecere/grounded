/*
 * While content health reports are switched off, the reports that are still kept are listed as metadata only (no signal, count or
 * finding) so the team can stop or delete them (docs/content-health.md). They come back, findings and all, if the switch is turned on.
 */
import { useState } from "react";
import { ApiErrorAlert } from "@/components/errors";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { RelativeTime } from "@/components/templates/list-page";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { useTeam } from "../common";
import { useReportActions } from "./report-actions";
import { type Report, activeStatus, statusLabel } from "./queries";

function RetainedRow({ team, report, onDelete }: { team: string; report: Report; onDelete: (r: Report) => void }) {
  const { archived } = useTeam();
  const { cancel } = useReportActions(team, report.id);
  return (
    <Tr>
      <Td>
        <RelativeTime value={report.createdAt} />
      </Td>
      <Td>
        <Badge tone="neutral">{statusLabel[report.status]}</Badge>
      </Td>
      <Td muted>{report.expiresAt ? <RelativeTime value={report.expiresAt} /> : "When it ends"}</Td>
      <Td>
        {activeStatus(report.status) ? (
          <Button variant="secondary" size="sm" loading={cancel.isPending} disabled={archived} onClick={() => cancel.mutate()}>
            Cancel report
          </Button>
        ) : (
          <Button variant="danger" size="sm" disabled={archived} onClick={() => onDelete(report)}>
            Delete report
          </Button>
        )}
        <ApiErrorAlert error={cancel.error} title="Couldn't cancel the report" />
      </Td>
    </Tr>
  );
}

export function RetainedReports({ team, reports }: { team: string; reports: Report[] }) {
  const [deleting, setDeleting] = useState<Report | null>(null);
  const { del } = useReportActions(team, deleting?.id ?? "", () => setDeleting(null));
  if (reports.length === 0) return null;
  return (
    <Card title="Reports still kept" titleAs="h2" description="Switched off, so what they found is hidden. You can still stop a report that is being made and delete the ones that are kept.">
      <Table caption="Reports still kept" stack columns={["Made", "Status", "Kept until", "Action"]}>
        {reports.map((r) => (
          <RetainedRow key={r.id} team={team} report={r} onDelete={setDeleting} />
        ))}
      </Table>
      <ConfirmMutationDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={del}
        onConfirm={() => del.mutate()}
        title="Delete this report?"
        description="The report and its findings are removed. Your documents and sources are not touched."
        confirmLabel="Delete report"
      />
    </Card>
  );
}
