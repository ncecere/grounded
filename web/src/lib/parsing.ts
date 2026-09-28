/* OCR for scanned documents (docs/ocr.md): Admin → Parsing's form helpers and the words for OCR on documents (pure, unit-tested). */
import type { Schemas } from "@/api/client";

export type ParsingSettings = Schemas["ParsingSettings"];
export type OcrBackend = Schemas["OcrBackend"];

export const backendLabels: Record<OcrBackend, string> = { tesseract: "Tesseract", tika: "Apache Tika", vision: "Vision model" };

export const backendDescriptions: Record<OcrBackend, string> = {
  tesseract: "The grounded-ocr sidecar (components/ocr-tesseract). Fast, runs on CPUs, reads printed text in the languages below.",
  tika: "The optional Apache Tika component with its -full image, which includes Tesseract. Simplest if Tika is already deployed.",
  vision: "A vision model from Admin → Models, page by page. Best on forms and tables; costs tokens; sources above the model's classification can't use it.",
};

export type ParsingForm = { ocrEnabled: boolean; backend: OcrBackend; visionModelId: string; languages: string };

export const parsingForm = (s: ParsingSettings): ParsingForm => ({
  ocrEnabled: s.ocrEnabled,
  backend: s.backend,
  visionModelId: s.visionModelId ?? "",
  languages: s.languages,
});

export const parsingInput = (f: ParsingForm): Schemas["ParsingSettingsInput"] => ({
  ocrEnabled: f.ocrEnabled,
  backend: f.backend,
  visionModelId: f.visionModelId || null,
  languages: f.languages.trim(),
});

/** Tesseract language codes joined with "+" (mirrors the server's check). */
export const languagesPattern = /^[a-z_]{3,16}(\+[a-z_]{3,16}){0,9}$/;

/** Field problems, keyed by field. */
export function parsingProblems(f: ParsingForm, settings: ParsingSettings): Partial<Record<keyof ParsingForm, string>> {
  const out: Partial<Record<keyof ParsingForm, string>> = {};
  if (!languagesPattern.test(f.languages.trim())) out.languages = "Enter language codes joined with +, for example eng or eng+spa.";
  if (f.ocrEnabled && f.backend === "vision" && !f.visionModelId) out.visionModelId = "Choose a vision model to use the vision backend.";
  const status = settings.backends.find((b) => b.backend === f.backend);
  if (f.ocrEnabled && f.backend !== "vision" && status && !status.configured) out.backend = `${backendLabels[f.backend]} isn't configured: set ${status.configuredBy}.`;
  return out;
}

/** How many fields differ from the saved settings. */
export function parsingChanges(saved: ParsingSettings, f: ParsingForm) {
  const s = parsingForm(saved);
  return (Object.keys(s) as (keyof ParsingForm)[]).filter((k) => s[k] !== f[k]).length;
}

/** Page numbers as ranges with en dashes: "3–7, 9". */
export function pageRanges(pages: number[]) {
  const out: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    out.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}

const noteBackends: Record<OcrBackend, string> = { tesseract: "Tesseract", tika: "Apache Tika", vision: "a vision model" };

/** "Pages 3–7 were read with OCR (Tesseract)." for a document's record page. */
export function ocrNote(ocr: Schemas["DocumentOcr"], totalPages = 0) {
  const who = noteBackends[ocr.backend] ?? ocr.backend;
  if (totalPages === 1 && ocr.pages.length === 1) return `It was read with OCR (${who}).`;
  const noun = ocr.pages.length === 1 ? "Page" : "Pages";
  return `${noun} ${pageRanges(ocr.pages)} ${ocr.pages.length === 1 ? "was" : "were"} read with OCR (${who}).`;
}

/** "3 documents" / "1 document". */
export const documentsCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "document" : "documents"}`;
