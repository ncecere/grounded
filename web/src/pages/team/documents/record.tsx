/*
 * A document's record page (W3, D4), opened from the documents table with
 * ?record=<documentId>: its facts, status and friendly error (the parser's
 * text on demand, P-06), passage previews, tags, and Retry / Re-fetch
 * (a web page, fetched again now) / Delete. The
 * document is fetched by id, so a pasted link opens the page directly.
 */
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { RelativeTime } from "@/components/templates/list-page";
import { RecordPage } from "@/components/templates/record-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Field } from "@/components/ui/field/field";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import { TextLink } from "@/components/ui/text-link/text-link";
import { maintenanceReason, useMaintenance } from "@/lib/maintenance";
import { markdownToText } from "@/lib/plain-text";
import { passagesCount, terms } from "@/lib/terms";
import { useSourceOwner } from "../../sources/owner";
import { type Doc, formatBytes } from "../common";
import { pageRange } from "../retrieve";
import d from "./documents.module.css";
import { canRetry, type DocumentMutations } from "./mutations";
import { DocStatusBadge, docName, documentError, kindLabel } from "./status";

const previewSize = 5;

type Props = { sourceId: string; web: boolean; docId: string | undefined; onClose: () => void; mutations: DocumentMutations };

export function DocumentRecordPage({ sourceId, web, docId, onClose, mutations }: Props) {
  const owner = useSourceOwner();
  const key = [...owner.keys.documents(sourceId), "one", docId];
  const doc = useQuery({
    queryKey: key,
    queryFn: () => owner.api.document(sourceId, docId!),
    enabled: Boolean(docId),
    refetchInterval: (q) => (q.state.data && ["pending", "queued", "processing"].includes(q.state.data.status) ? 2000 : false),
  });
  const [deleting, setDeleting] = useState(false);
  const d0 = doc.data;
  const failed = d0 ? canRetry(d0) : false;
  const { retry, refetch, remove } = mutations;
  const maintenance = useMaintenance(owner.canEdit);
  const paused = Boolean(maintenance) && Boolean(d0) && ((web && Boolean(d0?.url)) || failed);

  return (
    <>
      <RecordPage
        open={Boolean(docId)}
        onClose={onClose}
        title={d0 ? docName(d0) : web ? "Page" : "Document"}
        description={web ? "A page fetched from the website, with the passages knowledge bases search." : "An uploaded file, with the passages knowledge bases search."}
        loading={doc.isLoading}
        error={doc.error}
        facts={d0 ? documentFacts(d0, web) : []}
        sections={
          d0
            ? [
                ...(failed || d0.warnings.length > 0 ? [{ title: failed ? "Why it wasn't indexed" : "Warnings", content: <DocumentProblems doc={d0} /> }] : []),
                { title: terms.Passages, content: <PassagePreviews sourceId={sourceId} doc={d0} /> },
                { title: "Tags", content: <DocumentTags doc={d0} mutations={mutations} canEdit={owner.canEdit} /> },
              ]
            : []
        }
        actions={
          d0 && owner.canEdit ? (
            <>
              <Button variant="danger" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden /> Delete
              </Button>
              {web && d0.url && (
                <Button variant={failed ? "secondary" : "primary"} loading={refetch.isPending} disabled={paused} onClick={() => refetch.mutate(d0)}>
                  <RefreshCw aria-hidden /> Re-fetch page
                </Button>
              )}
              {failed && (
                <Button loading={retry.isPending} disabled={paused} onClick={() => retry.mutate([d0])}>
                  <RotateCcw aria-hidden /> Retry
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {paused && owner.canEdit && maintenance && (
          <Alert tone="warning" title="Paused for maintenance">
            {maintenanceReason(maintenance, web ? "Re-fetching" : "Retrying")}
          </Alert>
        )}
      </RecordPage>
      <AlertDialog
        open={deleting && Boolean(d0)}
        onOpenChange={(o) => {
          setDeleting(o);
          if (!o) remove.reset();
        }}
        title={`Delete ${d0 ? docName(d0) : "this document"}?`}
        description={
          web
            ? "The page and its passages are removed from this source and every knowledge base that uses it. The next crawl adds it again if it's still on the site."
            : "The document and its passages are removed from this source and every knowledge base that uses it."
        }
        confirmLabel="Delete document"
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          d0 &&
          remove.mutate([d0], {
            onSuccess: () => {
              setDeleting(false);
              onClose();
            },
          })
        }
      />
    </>
  );
}

function documentFacts(doc: Doc, web: boolean) {
  return [
    { label: "Status", value: <DocStatusBadge status={doc.status} /> },
    {
      label: web ? "Address" : "File name",
      value: web && doc.url ? (
        <TextLink href={doc.url} target="_blank" rel="noreferrer" external className={d.breakAll}>
          {doc.url}
        </TextLink>
      ) : (
        doc.filename || "—"
      ),
    },
    { label: "Kind · size", value: [doc.kind && kindLabel(doc.kind), formatBytes(doc.sizeBytes)].filter(Boolean).join(" · ") },
    ...(doc.pages > 0 ? [{ label: "Pages", value: doc.pages.toLocaleString() }] : []),
    { label: terms.Passages, value: doc.status === "ready" ? `${passagesCount(doc.chunkCount)} · ${doc.tokenCount.toLocaleString()} tokens` : "—" },
    ...(doc.version > 1 ? [{ label: "Version", value: `Version ${doc.version}` }] : []),
    { label: "Added", value: <RelativeTime value={doc.createdAt} /> },
    { label: "Updated", value: <RelativeTime value={doc.updatedAt} /> },
  ];
}

/** The friendly error, the parser's text behind a disclosure, and warnings. */
function DocumentProblems({ doc }: { doc: Doc }) {
  const error = canRetry(doc) ? documentError(doc) : "";
  return (
    <div className={d.problems}>
      {error && (
        <Alert tone={doc.status === "failed" ? "danger" : "warning"} title={doc.status === "failed" ? "Processing failed" : "Skipped"}>
          {error}
        </Alert>
      )}
      {doc.errorDetail && (
        <Disclosure title="Technical details">
          <p className={d.technical}>{doc.errorDetail}</p>
        </Disclosure>
      )}
      {doc.warnings.length > 0 && (
        <ul className={d.warnings}>
          {doc.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PassagePreviews({ sourceId, doc }: { sourceId: string; doc: Doc }) {
  const owner = useSourceOwner();
  const [limit, setLimit] = useState(previewSize);
  const passages = useQuery({
    queryKey: [...owner.keys.documents(sourceId), "one", doc.id, "passages", limit, doc.updatedAt],
    queryFn: () => owner.api.passages(sourceId, doc.id, limit),
    enabled: doc.status === "ready" && doc.chunkCount > 0,
    placeholderData: (prev) => prev,
  });
  if (doc.status !== "ready") return <p className={d.muted}>Passages appear once the document is processed.</p>;
  if (doc.chunkCount === 0) return <p className={d.muted}>No searchable text was found in this document.</p>;
  if (passages.error) return <ErrorAlert error={passages.error} title="Couldn't load the passages" />;
  const page = passages.data;
  if (!page) return <p className={d.muted}>Loading passages…</p>;
  return (
    <>
      <p className={d.muted}>
        Showing {page.items.length.toLocaleString()} of {passagesCount(page.total)}.
      </p>
      <ol aria-label="Passage previews" className={d.passages}>
        {page.items.map((p) => (
          <li key={p.ordinal} className={d.passage}>
            {(p.headingPath.length > 0 || p.pageStart > 0) && (
              <p className={d.passageMeta}>{[p.headingPath.join(" › "), pageRange(p.pageStart, p.pageEnd)].filter(Boolean).join(" · ")}</p>
            )}
            <p className={d.passageText}>{markdownToText(p.content)}</p>
          </li>
        ))}
      </ol>
      {page.items.length < page.total && limit < 100 && (
        <Button variant="secondary" size="sm" loading={passages.isFetching} onClick={() => setLimit(Math.min(100, limit + 20))}>
          Show more passages
        </Button>
      )}
    </>
  );
}

function DocumentTags({ doc, mutations, canEdit }: { doc: Doc; mutations: DocumentMutations; canEdit: boolean }) {
  const [tags, setTags] = useState(doc.tags);
  useEffect(() => setTags(doc.tags), [doc.tags]);
  const changed = tags.join(",") !== doc.tags.join(",");
  if (!canEdit) return doc.tags.length ? <p>{doc.tags.join(", ")}</p> : <p className={d.muted}>No tags.</p>;
  return (
    <div className={d.tagEditor}>
      <Field label="Tags" hideLabel description="Agents and searches can filter documents by tag. Press Enter after each tag (up to 20).">
        <TagInput value={tags} onValueChange={setTags} maxTags={20} />
      </Field>
      <ErrorAlert error={mutations.setTags.error} />
      <div>
        <Button variant="secondary" size="sm" disabled={!changed} loading={mutations.setTags.isPending} onClick={() => mutations.setTags.mutate({ doc, tags })}>
          Save tags
        </Button>
      </div>
    </div>
  );
}
