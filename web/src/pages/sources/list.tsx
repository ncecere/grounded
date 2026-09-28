/*
 * The data source list (W6, D5), shared by the team and shared-source pages:
 * a ListPage with type, status and classification facets and search in the
 * URL, a Content column, "Used by" (the team's knowledge bases) and a
 * relative "Last sync".
 */
import { Link } from "@tanstack/react-router";
import { Database, FileUp, Globe, Settings2 } from "lucide-react";
import { type ReactElement, type ReactNode, cloneElement } from "react";
import { ListPage, RelativeTime, type ListEmpty } from "@/components/templates/list-page";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { passagesCount } from "@/lib/terms";
import s from "../shared.module.css";
import { ClassificationBadge, type Classification, type ProfileOption, formatBytes, plural, profileName } from "../team/common";
import { crawlStatusLabels, isActiveCrawl } from "./crawls";
import { type DataSource, useSourceOwner } from "./owner";
import w from "./web.module.css";

/** A short text summary of a source's document states. */
export function documentSummary(c: DataSource["documents"]) {
  if (c.total === 0) return "No documents";
  const parts = [`${c.ready.toLocaleString()} ready`];
  if (c.pending + c.processing > 0) parts.push(`${(c.pending + c.processing).toLocaleString()} in progress`);
  if (c.failed > 0) parts.push(`${c.failed.toLocaleString()} failed`);
  if (c.skipped > 0) parts.push(`${c.skipped.toLocaleString()} skipped`);
  return parts.join(", ");
}

export function SourceStatusBadge({ status }: { status: DataSource["status"] }) {
  return status === "paused" ? <StatusBadge tone="warning">Paused</StatusBadge> : <StatusBadge tone="success">Active</StatusBadge>;
}

export function SourceTypeBadge({ type }: { type: DataSource["type"] }) {
  return type === "web" ? (
    <Badge variant="outline">
      <Globe aria-hidden className={w.badgeIcon} /> Website
    </Badge>
  ) : (
    <Badge variant="outline">
      <FileUp aria-hidden className={w.badgeIcon} /> Upload
    </Badge>
  );
}

/** "Synced 3 hours ago", "Crawl running", "Not synced yet"; uploads have no sync. */
function lastSync(src: DataSource): ReactNode {
  if (src.type !== "web") return <span className={s.muted}>—</span>;
  if (isActiveCrawl(src.activeCrawl)) return `Crawl ${crawlStatusLabels[src.activeCrawl.status].toLowerCase()}`;
  return src.lastSyncAt ? <RelativeTime value={src.lastSyncAt} /> : "Not synced yet";
}

type KBRef = { id: string; name: string };

function UsedBy({ kbs, team }: { kbs: KBRef[] | undefined; team?: string }) {
  if (!kbs || kbs.length === 0) return <span className={s.muted}>No knowledge base</span>;
  const names = kbs.map((k) => k.name).join(", ");
  const first = kbs[0]!;
  return (
    <CellText
      primary={plural(kbs.length, "knowledge base")}
      secondary={
        <span title={names} className={w.oneLine}>
          {team ? <TextLink render={<Link to="/teams/$team/kbs/$kbId" params={{ team, kbId: first.id }} />}>{first.name}</TextLink> : first.name}
          {kbs.length > 1 && ` and ${kbs.length - 1} more`}
        </span>
      }
    />
  );
}

type Props = {
  sources: DataSource[];
  levels?: Classification[];
  profiles?: ProfileOption[];
  caption?: string;
  /** Source id → the knowledge bases that search it (team sources). */
  usedBy?: Map<string, KBRef[]>;
  title?: ReactNode;
  description?: ReactNode;
  primaryAction?: ReactNode;
  notices?: ReactNode;
  empty?: ListEmpty;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
};

export function SourcesTable({ sources, levels, profiles, caption = "Data sources", usedBy, title, description, primaryAction, notices, empty, loading, error, onRetry }: Props) {
  const owner = useSourceOwner();
  const levelName = (key: string) => levels?.find((l) => l.key === key)?.name ?? key;
  const columns: DataTableColumn<DataSource>[] = [
    {
      id: "name",
      header: "Source",
      rowHeader: true,
      accessor: (src) => `${src.name} ${src.description}`,
      sortable: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      cell: (src) => (
        <CellText
          className={w.nameCell}
          primary={
            <TextLink render={owner.sourceLink(src.id)} className={s.primary}>
              {src.name}
            </TextLink>
          }
          secondary={src.description ? <span className={w.oneLine}>{src.description}</span> : undefined}
        />
      ),
    },
    // Hidden by default so the list fits at 1280 px: Content already says pages (website) or documents (upload), and Type is a filter.
    { id: "type", header: "Type", defaultHidden: true, accessor: (src) => (src.type === "web" ? "Website" : "Upload"), sortable: true, cell: (src) => <SourceTypeBadge type={src.type} /> },
    {
      id: "classification",
      header: "Classification",
      accessor: (src) => levels?.find((l) => l.key === src.classification)?.rank ?? 0,
      sortable: true,
      filterable: false,
      cell: (src) => <ClassificationBadge levels={levels} value={src.classification} />,
    },
    {
      id: "content",
      header: "Content",
      accessor: (src) => src.documents.total,
      sortable: true,
      filterable: false,
      cell: (src) => (
        <CellText
          primary={<span className={w.nowrap}>{plural(src.documents.total, src.type === "web" ? "page" : "document")}</span>}
          secondary={
            <>
              <span className={w.nowrap}>{formatBytes(src.documents.bytes)}</span>
              {src.documents.failed > 0 && (
                <>
                  {" "}
                  {/* The separator stays with what follows it, so a wrap never leaves "4.3 KB ·". */}
                  <span className={w.nowrap}>
                    · <span className={w.failedCount}>{src.documents.failed.toLocaleString()} failed</span>
                  </span>
                </>
              )}
            </>
          }
        />
      ),
    },
    { id: "passages", header: "Passages", numeric: true, defaultHidden: true, accessor: (src) => src.documents.chunks, sortable: true, filterable: false, cell: (src) => passagesCount(src.documents.chunks) },
    ...(usedBy
      ? [
          {
            id: "usedBy",
            header: "Used by",
            accessor: (src: DataSource) => usedBy.get(src.id)?.length ?? 0,
            sortable: true,
            filterable: false,
            cell: (src: DataSource) => <UsedBy kbs={usedBy.get(src.id)} team={owner.team} />,
          },
        ]
      : []),
    {
      id: "lastSync",
      header: "Last sync",
      accessor: (src) => (src.lastSyncAt ? new Date(src.lastSyncAt) : null),
      sortable: true,
      filterable: false,
      cell: (src) => <span className={w.nowrap}>{lastSync(src)}</span>,
    },
    { id: "profile", header: "Embedding profile", defaultHidden: true, accessor: (src) => profileName(profiles, src.embeddingProfileId), muted: true },
    { id: "status", header: "Status", accessor: (src) => src.status, sortable: true, filterable: false, cell: (src) => <SourceStatusBadge status={src.status} /> },
  ];
  const usedLevels = [...new Set(sources.map((src) => src.classification))];
  const facets: Facet<DataSource>[] = [
    { id: "type", label: "Type", type: "toggle", allLabel: "All", accessor: (src) => src.type, options: [{ value: "web", label: "Website" }, { value: "upload", label: "Upload" }] },
    { id: "status", label: "Status", type: "toggle", allLabel: "All", accessor: (src) => src.status, options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] },
    {
      id: "classification",
      label: "Classification",
      type: "select",
      placeholder: "Any classification",
      accessor: (src) => src.classification,
      options: (levels ?? []).filter((l) => usedLevels.includes(l.key)).map((l) => ({ value: l.key, label: levelName(l.key) })),
    },
  ];
  return (
    <ListPage<DataSource>
      id={owner.kind === "team" ? "team-sources" : "shared-sources"}
      title={title}
      description={description}
      primaryAction={primaryAction}
      notices={notices}
      caption={caption}
      columns={columns}
      data={sources}
      getRowId={(src) => src.id}
      rowLabel={(src) => src.name}
      facets={facets}
      search={{ label: "Search sources", placeholder: "Name or description" }}
      rowActions={(src) => [
        { label: "Open", icon: <Database aria-hidden />, render: owner.sourceLink(src.id) },
        { label: "Settings", icon: <Settings2 aria-hidden />, render: settingsLink(owner.sourceLink(src.id)), hidden: !owner.canEdit },
      ]}
      empty={empty}
      loading={loading}
      error={error}
      onRetry={onRetry}
      tableProps={{ defaultSort: { columnId: "name", direction: "ascending" } }}
    />
  );
}

/** The source link, opening its Settings tab. */
const settingsLink = (link: ReactElement) => cloneElement(link as ReactElement<{ search?: unknown }>, { search: { tab: "settings" } });
