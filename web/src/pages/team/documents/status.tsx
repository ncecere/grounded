import { StatusBadge } from "@/components/ui/badge/badge";
/* Document statuses, errors and names, shared by the documents table and tests. */
import type { Tone } from "@/lib/bitop-utils";
import { type Doc, type DocStatus } from "../common";

export const docStatusLabels: Record<DocStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  skipped: "Skipped",
};

const docStatusTone: Record<DocStatus, Tone> = {
  pending: "neutral",
  queued: "neutral",
  processing: "info",
  ready: "success",
  failed: "danger",
  skipped: "warning",
};

/** Badge text: pending and queued documents both read "Queued". */
const docStatusBadgeLabels: Record<DocStatus, string> = { ...docStatusLabels, pending: "Queued" };

/** A pending document waiting for the team's daily OCR page limit (docs/ocr.md §4). */
export const isWaiting = (d: Pick<Doc, "status" | "errorCode">) => d.status === "pending" && d.errorCode === "ocr_daily_limit";

export function DocStatusBadge({ status, waiting = false }: { status: DocStatus; waiting?: boolean }) {
  if (waiting) return <StatusBadge tone="warning">Waiting</StatusBadge>;
  return (
    <StatusBadge tone={docStatusTone[status]} pulse={status === "processing"}>
      {docStatusBadgeLabels[status]}
    </StatusBadge>
  );
}

export const isInProgress = (s: DocStatus) => s === "pending" || s === "queued" || s === "processing";

/** Why a document wasn't indexed: the API's sentence for people (P-06); errorDetail has the technical text. */
export function documentError(d: Pick<Doc, "errorCode" | "errorMessage">) {
  return d.errorMessage || d.errorCode;
}

/** A document's display name: the page title or file name. */
export const docName = (doc: Doc) => doc.title || doc.filename || doc.url || "Untitled document";

/** Document kinds as people say them ("PDF", "Word", "Markdown"), for tables and the kind filter. */
export const kindLabels: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  html: "HTML",
  markdown: "Markdown",
  md: "Markdown",
  text: "Text",
  txt: "Text",
  image: "Image",
};

export const kindLabel = (kind: string) => (kind ? (kindLabels[kind] ?? kind.toUpperCase()) : "—");
