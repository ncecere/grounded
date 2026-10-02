/* Retry, re-fetch, delete and re-tag documents (one or many); each refreshes the source's counts and its documents. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast/toast";
import { useSourceOwner } from "../../sources/owner";
import { type Doc, plural } from "../common";
import { docName } from "./status";

/** The delete dialog's description and button for n documents (or a website's pages), in the singular for one. */
export function deleteWording(n: number, web: boolean): { description: string; confirm: string } {
  const one = n === 1;
  const noun = web ? (one ? "page" : "pages") : one ? "document" : "documents";
  const what = one ? `The ${noun} and its passages are` : `The ${noun} and their passages are`;
  const back = web ? (one ? " The next crawl adds it again if it's still on the site." : " The next crawl adds them again if they're still on the site.") : "";
  return { description: `${what} removed from this source and every knowledge base that uses it.${back}`, confirm: `Delete ${noun}` };
}

/** A partly scanned PDF: indexed, but its pages without text were skipped while OCR was off (docs/ocr.md §5). */
export const isPartlyScanned = (doc: Pick<Doc, "status" | "errorCode">) => doc.status === "ready" && doc.errorCode === "needs_ocr";

/** Documents that Retry applies to: failed or skipped ones, and partly scanned PDFs (read again with OCR). */
export const canRetry = (doc: Pick<Doc, "status" | "errorCode">) => doc.status === "failed" || doc.status === "skipped" || isPartlyScanned(doc);

/** Retry's label: documents that need OCR are retried to read them with OCR. */
export const retryLabel = (doc: Pick<Doc, "errorCode">) => (doc.errorCode === "needs_ocr" ? "Retry with OCR" : "Retry");

export function useDocumentMutations(sourceId: string) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const invalidate = () => {
    // The source key prefixes its documents.
    qc.invalidateQueries({ queryKey: owner.keys.source(sourceId) });
    qc.invalidateQueries({ queryKey: owner.keys.list });
  };
  const retry = useMutation({
    mutationFn: async (docs: Doc[]) => {
      for (const d of docs) await owner.api.retryDocument(sourceId, d.id);
      return docs;
    },
    onSuccess: (docs) => toast.info(docs.length === 1 ? `${docName(docs[0]!)} was queued again` : `${plural(docs.length, "document")} were queued again`),
    onSettled: invalidate,
  });
  // Every document of the source that needs OCR, queued again (docs/ocr.md §5): skipped scans, and partly scanned PDFs while OCR is on.
  const retryNeedsOcr = useMutation({
    mutationFn: () => owner.api.retryDocuments(sourceId, "needs_ocr"),
    onSuccess: (r) =>
      r.retried > 0 ? toast.info(`${plural(r.retried, "document")} ${r.retried === 1 ? "was" : "were"} queued again`) : toast.info("No documents need OCR"),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (docs: Doc[]) => {
      for (const d of docs) await owner.api.deleteDocument(sourceId, d.id);
      return docs;
    },
    onSuccess: (docs) => toast.success(docs.length === 1 ? `${docName(docs[0]!)} was deleted` : `${plural(docs.length, "document")} were deleted`),
    onSettled: invalidate,
  });
  // A page of a web source, fetched again now (W3): a one-page crawl run.
  const refetch = useMutation({
    mutationFn: async (doc: Doc) => {
      await owner.api.refetchDocument(sourceId, doc.id);
      return doc;
    },
    onSuccess: (doc) => toast.info("Re-fetching the page", `${docName(doc)} is indexed again if it changed. The Crawls tab shows the run.`),
    // e.g. 409 "This source is already syncing".
    onError: (err) => toast.error("Couldn't re-fetch the page", err instanceof Error ? err.message : undefined),
    onSettled: invalidate,
  });
  const setTags = useMutation({
    mutationFn: ({ doc, tags }: { doc: Doc; tags: string[] }) => owner.api.updateDocument(sourceId, doc.id, { tags }),
    onSuccess: (updated) => {
      qc.setQueryData([...owner.keys.documents(sourceId), "one", updated.id], updated);
      toast.success("Tags saved");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: owner.keys.documents(sourceId) });
      qc.invalidateQueries({ queryKey: [...owner.keys.source(sourceId), "tags"] });
    },
  });
  return { retry, retryNeedsOcr, refetch, remove, setTags };
}

export type DocumentMutations = ReturnType<typeof useDocumentMutations>;
