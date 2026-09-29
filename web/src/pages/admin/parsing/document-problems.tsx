/*
 * Admin → Parsing & OCR › Documents that failed or need OCR (owner decision 3 of docs/v0.2.0.md §7): counts by team,
 * source and reason with the oldest date, never a document's name or text (admins can't read a team's documents).
 * Platform admins retry a group ("Retry these", which needs OCR on for scans and OCR errors) or tell the team's owners
 * ("Notify owners"); auditors read.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellRing, FileCheck2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Card } from "@/components/ui/card/card";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { documentsCount } from "@/lib/parsing";
import { problemOcrBlock, problemReasonLabels, retryDescription } from "@/lib/document-problems";
import s from "../../shared.module.css";

type Group = Schemas["DocumentProblemGroup"];

export const documentProblemsKey = ["admin", "parsing", "document-problems"];

const rowId = (g: Group) => `${g.sourceId}:${g.reason}`;

const columns: DataTableColumn<Group>[] = [
  {
    id: "team",
    header: "Team",
    accessor: (g) => g.teamName || "Shared sources",
    cell: (g) =>
      g.teamSlug ? (
        <CellText primary={<TextLink render={<Link to="/admin/teams/$team" params={{ team: g.teamSlug }} />}>{g.teamName}</TextLink>} secondary={g.teamSlug} />
      ) : (
        <span className={s.muted}>Shared sources</span>
      ),
  },
  { id: "source", header: "Source", accessor: (g) => g.sourceName, rowHeader: true },
  {
    id: "reason",
    header: "Reason",
    accessor: (g) => problemReasonLabels[g.reason],
    cell: (g) => <CellText primary={problemReasonLabels[g.reason]} secondary={problemOcrBlock(g) ?? undefined} />,
  },
  { id: "documents", header: "Documents", accessor: (g) => g.documents, numeric: true, cell: (g) => g.documents.toLocaleString() },
  { id: "oldest", header: "Oldest", accessor: (g) => new Date(g.oldestAt), cell: (g) => <RelativeTime value={g.oldestAt} /> },
];

type Pending = { kind: "retry" | "notify"; group: Group };

export function DocumentProblemsSection({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: documentProblemsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/parsing/document-problems")) });
  const [pending, setPending] = useState<Pending | null>(null);
  const act = useMutation({
    mutationFn: async ({ kind, group }: Pending) => {
      const body = { sourceId: group.sourceId, reason: group.reason };
      if (kind === "retry") return unwrap(await api.POST("/v1/admin/parsing/document-problems/retry", { body }));
      return unwrap(await api.POST("/v1/admin/parsing/document-problems/notify", { body }));
    },
    onSuccess: (res, { kind, group }) => {
      if ("retried" in res) toast.success(`Queued ${documentsCount(res.retried)} again`, group.sourceName);
      else
        toast.success(
          `Told ${res.owners === 1 ? "1 owner" : `${res.owners} owners`} of ${group.teamName}`,
          `${documentsCount(res.documents)} in ${group.sourceName}`,
        );
      if (kind === "retry") qc.invalidateQueries({ queryKey: ["admin", "parsing"] });
      setPending(null);
    },
  });
  const items = q.data?.items ?? [];
  const total = items.reduce((n, g) => n + g.documents, 0);
  return (
    <Card
      id="document-problems"
      title="Documents that failed or need OCR"
      description="By team and source, without file names or text: platform admins can't read a team's documents. Retry these queues a group again; Notify owners tells the team's owners, with a link to the documents."
      flush
    >
      <ListPage<Group>
        id="admin-document-problems"
        caption={`Documents that failed or need OCR (${documentsCount(total)})`}
        columns={columns}
        data={items}
        getRowId={rowId}
        rowLabel={(g) => `${g.sourceName}: ${problemReasonLabels[g.reason]}`}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowActions={
          isAdmin
            ? (g) => [
                {
                  label: "Retry these",
                  icon: <RotateCcw aria-hidden />,
                  onSelect: () => setPending({ kind: "retry", group: g }),
                  disabled: problemOcrBlock(g) !== null,
                  disabledReason: problemOcrBlock(g) ?? undefined,
                },
                { label: "Notify owners", icon: <BellRing aria-hidden />, onSelect: () => setPending({ kind: "notify", group: g }), hidden: !g.teamId },
              ]
            : undefined
        }
        empty={{ icon: <FileCheck2 />, title: "No documents failed or need OCR." }}
      />
      <ConfirmMutationDialog
        target={pending}
        onClose={() => setPending(null)}
        mutation={act}
        onConfirm={(p) => act.mutate(p)}
        tone="primary"
        title={
          pending?.kind === "notify"
            ? `Notify the owners of ${pending.group.teamName}?`
            : `Retry ${documentsCount(pending?.group.documents ?? 0)} in ${pending?.group.sourceName ?? "this source"}?`
        }
        description={
          pending?.kind === "notify"
            ? `They get a notification in the app and by email, which they can't turn off: ${documentsCount(pending.group.documents)} in ${pending.group.sourceName} (${problemReasonLabels[pending.group.reason].toLowerCase()}), with a link to the source's documents. It names no documents.`
            : pending
              ? retryDescription(pending.group)
              : ""
        }
        confirmLabel={pending?.kind === "notify" ? "Notify owners" : "Retry these"}
      />
    </Card>
  );
}
