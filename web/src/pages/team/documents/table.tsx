/*
 * The documents (or pages) of a source (Q4, W3) on the ListPage template:
 * one-line titles (the full title as a tooltip), the URL path only (the host
 * is in the page's facts line), Kind · Size, status, a relative Updated
 * date and a fixed-width "…" row menu. Status, kind and tag facets and the
 * search text live in the URL and are applied by the server; 50 per page
 * with Previous / Next; bulk Retry and Delete. A row opens the document
 * record page (?record=).
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Eye, FileText, Globe, RotateCcw, Tags, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { ListPage, RelativeTime, timeColumn, useListFilters } from "@/components/templates/list-page";
import { useRecordParam } from "@/components/templates/record-page";
import { rangeText, useCursorPager } from "@/components/pager";
import { Button } from "@/components/ui/button/button";
import type { DataTableColumn } from "@/components/ui/data-table/data-table";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { maintenanceReason, useMaintenance } from "@/lib/maintenance";
import { terms } from "@/lib/terms";
import { useDebounced } from "../../admin/hooks";
import { type DataSource, type DocKind, useSourceOwner } from "../../sources/owner";
import { type Doc, type DocStatus, formatBytes, plural } from "../common";
import d from "./documents.module.css";
import { canRetry, useDocumentMutations } from "./mutations";
import { DocumentRecordPage } from "./record";
import { DocStatusBadge, docName, docStatusLabels, documentError, isInProgress, kindLabel } from "./status";

const pageSize = 50;
const statuses: DocStatus[] = ["ready", "processing", "queued", "failed", "skipped"];
const kinds: DocKind[] = ["pdf", "docx", "pptx", "html", "markdown", "text"];

/** "/assets/fees.pdf" for a page's URL (the host is on the page already); the text as is when it isn't a URL. */
export function urlPath(url: string) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

function facetsFor(tags: string[]): Facet<Doc>[] {
  return [
    {
      id: "status",
      label: "Status",
      type: "toggle",
      allLabel: "All",
      options: statuses.map((v) => ({ value: v, label: docStatusLabels[v] })),
    },
    { id: "kind", label: "Kind", type: "select", placeholder: "Any kind", options: kinds.map((k) => ({ value: k, label: kindLabel(k) })) },
    ...(tags.length > 0 ? [{ id: "tag", label: "Tag", type: "select" as const, placeholder: "Any tag", options: tags.map((t) => ({ value: t, label: t })) }] : []),
  ];
}

function columns(web: boolean, open: (doc: Doc) => void): DataTableColumn<Doc>[] {
  return [
    {
      id: "title",
      header: web ? "Page" : "Document",
      rowHeader: true,
      accessor: (doc) => docName(doc),
      cell: (doc) => <DocumentName doc={doc} web={web} onOpen={() => open(doc)} />,
    },
    { id: "kind", header: "Kind · Size", cell: (doc) => <span className={d.nowrap}>{[doc.kind && kindLabel(doc.kind), formatBytes(doc.sizeBytes)].filter(Boolean).join(" · ")}</span>, muted: true },
    {
      id: "status",
      header: "Status",
      cell: (doc) => (
        <span className={d.status}>
          <DocStatusBadge status={doc.status} />
          {canRetry(doc) && documentError(doc) && (
            <span className={d.statusError} title={documentError(doc)}>
              {documentError(doc)}
            </span>
          )}
        </span>
      ),
    },
    { id: "passages", header: terms.Passages, numeric: true, cell: (doc) => (doc.status === "ready" ? doc.chunkCount.toLocaleString() : "—"), defaultHidden: web },
    { id: "tags", header: "Tags", defaultHidden: true, cell: (doc) => (doc.tags.length ? doc.tags.join(", ") : "—"), muted: true },
    { ...timeColumn<Doc>("updated", "Updated", (doc) => doc.updatedAt), sortable: false, cell: (doc) => <span className={d.nowrap}><RelativeTime value={doc.updatedAt} /></span> },
  ];
}

export function DocumentsTable({ source, onUpload }: { source: DataSource; onUpload?: () => void }) {
  const owner = useSourceOwner();
  const maintenance = useMaintenance(owner.canEdit);
  const web = source.type === "web";
  const noun = web ? "pages" : "documents";
  const record = useRecordParam();
  const tagList = useQuery({ queryKey: [...owner.keys.source(source.id), "tags"], queryFn: () => owner.api.tags(source.id) });
  const facets = facetsFor(tagList.data ?? []);
  const filters = useListFilters(facets);
  const q = useDebounced(filters.query.trim(), 300);
  const first = (id: string) => (filters.values[id] as string[] | undefined)?.[0];
  const query = { status: first("status") as DocStatus | undefined, kind: first("kind") as DocKind | undefined, tag: first("tag"), q: q || undefined };
  const signature = JSON.stringify(query);
  const pager = useCursorPager();
  const [lastSignature, setLastSignature] = useState(signature);
  // New filters start again at the first page.
  useEffect(() => {
    if (signature !== lastSignature) {
      pager.reset();
      setLastSignature(signature);
    }
  }, [signature, lastSignature, pager]);
  const docs = useQuery({
    queryKey: [...owner.keys.documents(source.id), query, pager.cursor],
    queryFn: () => owner.api.documents(source.id, { ...query, cursor: pager.cursor, limit: pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: (qq) => (qq.state.data?.items.some((doc) => isInProgress(doc.status)) ? 2000 : false),
  });
  const mutations = useDocumentMutations(source.id);
  const [deleting, setDeleting] = useState<Doc[] | null>(null);
  const items = docs.data?.items ?? [];
  const byId = new Map(items.map((doc) => [doc.id, doc]));
  const filtered = Boolean(query.status || query.kind || query.tag || query.q);
  const total = !filtered ? source.documents.total : query.status && !query.kind && !query.tag && !query.q ? countFor(source, query.status) : undefined;

  return (
    <>
      <ListPage<Doc>
        id={web ? "source-pages" : "source-documents"}
        caption={web ? "Pages" : "Documents"}
        columns={columns(web, (doc) => record.open(doc.id))}
        data={items}
        getRowId={(doc) => doc.id}
        rowLabel={docName}
        facets={facets}
        search={{ label: web ? "Search pages" : "Search documents", placeholder: web ? "Title or URL" : "Title or file name" }}
        manual
        loading={docs.isFetching && !docs.data}
        error={docs.error}
        onRetry={() => void docs.refetch()}
        onRowClick={(doc) => record.open(doc.id)}
        rowActions={(doc) => [
          { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(doc.id) },
          { label: "Edit tags", icon: <Tags aria-hidden />, onSelect: () => record.open(doc.id), hidden: !owner.canEdit },
          {
            label: "Retry",
            icon: <RotateCcw aria-hidden />,
            onSelect: () => mutations.retry.mutate([doc]),
            hidden: !owner.canEdit || !canRetry(doc),
            disabled: Boolean(maintenance),
            disabledReason: maintenance ? maintenanceReason(maintenance, "Retrying") : undefined,
          },
          { label: "Delete…", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setDeleting([doc]), hidden: !owner.canEdit },
        ]}
        empty={{
          icon: web ? <Globe /> : <FileText />,
          title: filtered ? `No ${noun} match these filters.` : `No ${noun} yet.`,
          description: filtered ? undefined : web ? "Pages appear here as the crawler fetches them." : undefined,
          action:
            !filtered && onUpload ? (
              <Button variant="secondary" onClick={onUpload}>
                <Upload aria-hidden /> Upload files
              </Button>
            ) : undefined,
        }}
        tableProps={{
          selectable: owner.canEdit,
          selectedLabel: (n) => `${plural(n, web ? "page" : "document")} selected`,
          bulkActions: owner.canEdit
            ? (ids, clear) => {
                const picked = ids.map((id) => byId.get(id)).filter((doc): doc is Doc => Boolean(doc));
                const retryable = picked.filter(canRetry);
                return (
                  <>
                    <Button size="sm" variant="secondary" disabled={retryable.length === 0 || Boolean(maintenance)} loading={mutations.retry.isPending} onClick={() => mutations.retry.mutate(retryable, { onSuccess: clear })}>
                      <RotateCcw aria-hidden /> Retry{retryable.length > 0 && retryable.length < picked.length ? ` ${retryable.length}` : ""}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setDeleting(picked)}>
                      <Trash2 aria-hidden /> Delete
                    </Button>
                  </>
                );
              }
            : undefined,
          cursor: {
            hasPrevious: pager.page > 0,
            hasNext: Boolean(docs.data?.nextCursor),
            onPrevious: pager.prev,
            onNext: () => docs.data?.nextCursor && pager.next(docs.data.nextCursor),
            label: rangeText(pager.page, pageSize, items.length, total),
          },
          paginationLabel: web ? "Pages list navigation" : "Documents list navigation",
          facetCounts: false,
        }}
      />
      <DocumentRecordPage sourceId={source.id} web={web} docId={record.id} onClose={record.close} mutations={mutations} />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            mutations.remove.reset();
          }
        }}
        title={deleting?.length === 1 ? `Delete ${docName(deleting[0]!)}?` : `Delete ${plural(deleting?.length ?? 0, web ? "page" : "document")}?`}
        description={
          web
            ? "The pages and their passages are removed from this source and every knowledge base that uses it. The next crawl adds them again if they're still on the site."
            : "The documents and their passages are removed from this source and every knowledge base that uses it."
        }
        confirmLabel={deleting && deleting.length > 1 ? "Delete documents" : "Delete document"}
        busy={mutations.remove.isPending}
        error={mutations.remove.error}
        onConfirm={() => deleting && mutations.remove.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
    </>
  );
}

/** How many documents a status filter matches, from the source's counts. */
function countFor(source: DataSource, status: DocStatus) {
  const c = source.documents;
  if (status === "queued" || status === "pending") return undefined;
  return c[status];
}

/** A one-line title (full text as a tooltip) that opens the record page, and the URL path or file name under it. */
function DocumentName({ doc, web, onOpen }: { doc: Doc; web: boolean; onOpen: () => void }) {
  const name = docName(doc);
  const secondary = web && doc.url ? urlPath(doc.url) : doc.title && doc.filename !== doc.title ? doc.filename : "";
  return (
    <span className={d.docName}>
      {web ? <Globe aria-hidden className={d.docIcon} /> : <FileText aria-hidden className={d.docIcon} />}
      <span className={d.docText}>
        <button type="button" className={d.docTitle} title={name} onClick={onOpen}>
          {name}
        </button>
        {secondary && (
          <span className={d.docSecondary} title={web ? doc.url : secondary}>
            {secondary}
            {doc.version > 1 && ` · version ${doc.version}`}
          </span>
        )}
      </span>
    </span>
  );
}
