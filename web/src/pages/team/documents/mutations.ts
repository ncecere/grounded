/* Retry, re-fetch, delete and re-tag documents (one or many); each refreshes the source's counts and its documents. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast/toast";
import { useSourceOwner } from "../../sources/owner";
import { type Doc, plural } from "../common";
import { docName } from "./status";

/** Documents that Retry applies to. */
export const canRetry = (doc: Pick<Doc, "status">) => doc.status === "failed" || doc.status === "skipped";

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
  return { retry, refetch, remove, setTags };
}

export type DocumentMutations = ReturnType<typeof useDocumentMutations>;
