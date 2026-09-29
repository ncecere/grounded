/* Documents that failed or need OCR (Admin → Parsing & OCR, docs/ocr.md §5): the reason classes and what a retry needs (pure, unit-tested). */
import type { Schemas } from "@/api/client";

type Group = Pick<Schemas["DocumentProblemGroup"], "reason" | "ocrState" | "documents">;

export const problemReasonLabels: Record<Schemas["DocumentProblemReason"], string> = {
  needs_ocr: "Needs OCR",
  ocr_error: "OCR error",
  damaged: "Damaged or unsupported file",
  other: "Other failure",
};

const ocrBlocks: Record<Exclude<Schemas["DocumentProblemGroup"]["ocrState"], "on">, string> = {
  platform_off: "OCR is off for the platform: turn it on above first.",
  source_off: "OCR is off for this source: its team turned it off. Notify the owners instead.",
  not_approved: "The OCR vision model isn't approved for this source's classification.",
};

/** Why "Retry these" can't read a group yet (needs OCR or OCR errors while OCR can't read the source), or null. */
export function problemOcrBlock(g: Pick<Group, "reason" | "ocrState">): string | null {
  if (g.reason !== "needs_ocr" && g.reason !== "ocr_error") return null;
  return g.ocrState === "on" ? null : ocrBlocks[g.ocrState];
}

/** What "Retry these" does for a group, in the confirmation. */
export function retryDescription(g: Group): string {
  const n = g.documents === 1 ? "It goes" : "They go";
  switch (g.reason) {
    case "needs_ocr":
    case "ocr_error":
      return `${n} back in the queue and ${g.documents === 1 ? "is" : "are"} read with OCR. Audited with the count.`;
    case "damaged":
      return `${n} back in the queue. Damaged or unsupported files usually fail again until the team fixes and uploads them; consider Notify owners. Audited with the count.`;
    default:
      return `${n} back in the queue, for example after a model or connection problem was fixed. Audited with the count.`;
  }
}
