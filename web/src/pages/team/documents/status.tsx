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

/**
 * Percent-encoded text decoded for display ("doc%2Fcodewalk%2Fpig" reads "doc/codewalk/pig"): titles made from
 * a URL before v0.4.2 (VI-10). Only text without spaces that holds %XX escapes is decoded, so "100% sure" stays.
 */
export function decodeForDisplay(text: string): string {
  if (/\s/.test(text) || !/%[0-9a-f]{2}/i.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A document's display name: the page title or file name. */
export const docName = (doc: Doc) => decodeForDisplay(doc.title || doc.filename || doc.url) || "Untitled document";

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

const kindsByExtension: Record<string, string> = { htm: "html", md: "markdown", txt: "text", png: "image", jpg: "image", jpeg: "image", tif: "image", tiff: "image" };

/** The document's kind, or its file extension's when processing stopped before the kind was known (a skipped scan). */
export function docKind(doc: Pick<Doc, "kind" | "filename">): string {
  if (doc.kind) return doc.kind;
  const ext = /\.([a-z0-9]+)$/i.exec(doc.filename ?? "")?.[1]?.toLowerCase() ?? "";
  return kindsByExtension[ext] ?? (["pdf", "docx", "pptx", "html", "markdown"].includes(ext) ? ext : "");
}
