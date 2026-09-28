/*
 * Whether OCR reads a source's scanned pages and images now (the source's
 * ocrState, docs/ocr.md §5a), and what to say when it doesn't: the upload
 * dialog refuses images with it, and "Retry all that need OCR" waits for it.
 */
import type { DataSource } from "../../sources/owner";

export type OcrState = NonNullable<DataSource["ocrState"]>;

/** The source's OCR state; lists don't carry it, so the source's own switch stands in (the server still checks). */
export const ocrStateOf = (source: Pick<DataSource, "ocrEnabled" | "ocrState">): OcrState => source.ocrState ?? (source.ocrEnabled ? "on" : "source_off");

/** Why images can't be uploaded, in the server's words (it refuses them the same way). */
export const imagesRefused: Record<Exclude<OcrState, "on">, string> = {
  source_off: "Images need OCR, which is off for this source.",
  platform_off: "Images need OCR, which is off for the platform.",
  not_approved: "Images need OCR, and the OCR vision model isn't approved for this source's classification.",
};

/** What turns OCR on, after imagesRefused (source_off: the Settings tab is offered as a link next to it). */
export const ocrFix: Record<Exclude<OcrState, "on">, string> = {
  source_off: "Turn on OCR in the source's settings to upload images.",
  platform_off: "A platform admin can turn it on under Admin → Parsing.",
  not_approved: "A platform admin can choose another OCR backend under Admin → Parsing.",
};

/** Why "Retry all that need OCR" is disabled: a retry would skip the documents again. */
export const retryBlocked: Record<Exclude<OcrState, "on">, string> = {
  source_off: "OCR is off for this source. Turn it on in the Settings tab first, or the documents are skipped again.",
  platform_off: "OCR is off for the platform. A platform admin can turn it on; until then, the documents would be skipped again.",
  not_approved: "The OCR vision model isn't approved for this source's classification, so the documents would be skipped again.",
};

/** Images are one-page documents read with OCR (docs/ocr.md §5a). */
export const imageExtensions = [".png", ".jpg", ".jpeg", ".tif", ".tiff"];

export const isImage = (name: string) => imageExtensions.some((ext) => name.toLowerCase().endsWith(ext));
