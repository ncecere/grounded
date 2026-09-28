/*
 * Shared sources › Used by (A6, DESIGN §4 rule 6): which teams and knowledge
 * bases attach each platform-shared source, as a list column, a sheet and
 * a "Used by" tab on the source's page, listing each team with its approved
 * classification.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap, type Schemas } from "@/api/client";
import { RecordSheet } from "@/components/templates/record-sheet";
import { timeColumn } from "@/components/templates/list-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../shared.module.css";
import { documentSummary, SourceStatusBadge, SourceTypeBadge } from "../sources/list";
import type { DataSource, SourceOwner } from "../sources/owner";
import { ClassificationBadge, type Classification, useLevelName } from "../team/common";
import a from "./shared-usage.module.css";

type Attachment = Schemas["SharedSourceAttachment"];

export function useSharedSourceUsage() {
  return useQuery({ queryKey: ["admin", "shared-source-usage"], queryFn: async () => unwrap(await api.GET("/v1/admin/shared-source-usage")) });
}

export function groupUsage(list: Attachment[]) {
  const out = new Map<string, Attachment[]>();
  for (const x of list) out.set(x.sourceId, [...(out.get(x.sourceId) ?? []), x]);
  return out;
}

/** "2 teams · 3 knowledge bases" ("" when unused). */
export function usageText(list: Attachment[] = []) {
  if (list.length === 0) return "";
  const teams = new Set(list.map((x) => x.teamSlug)).size;
  return `${teams} ${teams === 1 ? "team" : "teams"} · ${list.length} ${list.length === 1 ? "knowledge base" : "knowledge bases"}`;
}

export function sharedColumns(levels: Classification[] | undefined, usage: Map<string, Attachment[]>, owner: SourceOwner): DataTableColumn<DataSource>[] {
  return [
    {
      id: "name",
      header: "Source",
      accessor: "name",
      sortable: true,
      rowHeader: true,
      hideable: false,
      cell: (x) => <CellText primary={<TextLink render={owner.sourceLink(x.id)}>{x.name}</TextLink>} secondary={x.description || undefined} />,
    },
    { id: "type", header: "Type", accessor: "type", cell: (x) => <SourceTypeBadge type={x.type} /> },
    { id: "classification", header: "Classification", accessor: "classification", sortable: true, cell: (x) => <ClassificationBadge levels={levels} value={x.classification} /> },
    {
      id: "usedBy",
      header: "Used by",
      accessor: (x) => (usage.get(x.id) ?? []).length,
      sortable: true,
      cell: (x) => usageText(usage.get(x.id)) || <span className={s.muted}>Not attached</span>,
    },
    {
      id: "documents",
      header: "Documents",
      accessor: (x) => x.documents.total,
      numeric: true,
      sortable: true,
      cell: (x) => <CellText primary={x.documents.total.toLocaleString()} secondary={documentSummary(x.documents)} />,
    },
    timeColumn<DataSource>("lastSyncAt", "Last sync", (x) => x.lastSyncAt),
    { id: "status", header: "Status", accessor: "status", cell: (x) => <SourceStatusBadge status={x.status} /> },
  ];
}

type SheetProps = { source?: DataSource; open: boolean; loading: boolean; onClose: () => void; attachments: Attachment[] };

/** The teams (with their approved classification) and their knowledge bases that attach a shared source. */
export function SharedUsageList({ attachments }: { attachments: Attachment[] }) {
  const levelName = useLevelName();
  const teams = [...groupUsage(attachments.map((x) => ({ ...x, sourceId: x.teamSlug }))).values()];
  if (teams.length === 0) return <p className={s.muted}>No knowledge base attaches it yet.</p>;
  return (
    <ul className={a.teams}>
      {teams.map((kbs) => (
        <li key={kbs[0]!.teamSlug}>
          <span className={a.team}>
            <TextLink render={<Link to="/admin/teams/$team" params={{ team: kbs[0]!.teamSlug }} />}>{kbs[0]!.teamName}</TextLink>
            <span className={s.muted}>approved up to {levelName(kbs[0]!.teamMaxClassification)}</span>
          </span>
          <ul className={a.kbs}>
            {kbs.map((kb) => (
              <li key={kb.kbId}>{kb.kbName}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** A shared source's "Used by" tab (A6): the same list as the sheet, on its detail page. */
export function SharedUsageTab({ sourceId }: { sourceId: string }) {
  const usage = useSharedSourceUsage();
  const attachments = (usage.data ?? []).filter((x) => x.sourceId === sourceId);
  return (
    <Card
      title={usage.isLoading ? "Used by" : usageText(attachments) || "Not attached"}
      description="The teams and knowledge bases that attach this shared source. Raising its classification is refused while any of them is approved below the new level."
    >
      {usage.isLoading ? <SkeletonText lines={3} /> : usage.error ? <ErrorAlert error={usage.error} title="Couldn't load where it's used" /> : <SharedUsageList attachments={attachments} />}
    </Card>
  );
}

export function SharedUsageSheet({ source, open, loading, onClose, attachments }: SheetProps) {
  return (
    <RecordSheet
      open={open}
      onClose={onClose}
      title={source ? `Where ${source.name} is used` : "Shared source"}
      description="The teams and knowledge bases that attach this shared source. Raising its classification is refused while any of them is approved below the new level."
      loading={loading && !source}
      error={!loading && open && !source ? new Error("This shared source no longer exists.") : undefined}
      sections={source ? [{ title: usageText(attachments) || "Not attached", content: <SharedUsageList attachments={attachments} /> }] : []}
      footer={
        source && (
          <Button render={<Link to="/admin/shared-sources/$sourceId" params={{ sourceId: source.id }} search={{ tab: "used-by" }} />}>Open the source</Button>
        )
      }
    />
  );
}
