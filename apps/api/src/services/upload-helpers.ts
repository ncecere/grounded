import pdf from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { parse as csvParse } from "csv-parse/sync";

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
  "application/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
};

export const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".json": "application/json",
  ".xml": "application/xml",
};

export async function extractTextFromUpload(
  content: Uint8Array,
  mimeType: string,
  filename: string
): Promise<string> {
  const decoder = new TextDecoder("utf-8");
  const buffer = Buffer.from(content);

  let text: string;

  switch (mimeType) {
    case "text/plain":
    case "text/markdown":
      text = decoder.decode(content);
      break;
    case "text/html":
      text = htmlToText(decoder.decode(content));
      break;
    case "application/json":
      try {
        const json = JSON.parse(decoder.decode(content));
        text = JSON.stringify(json, null, 2);
      } catch {
        text = decoder.decode(content);
      }
      break;
    case "application/xml":
    case "text/xml":
      text = xmlToText(decoder.decode(content));
      break;
    case "application/pdf":
      text = await extractPdfText(buffer);
      break;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      text = await extractDocxText(buffer);
      break;
    case "application/msword":
      throw new Error("Legacy .doc format not fully supported. Please convert to .docx format.");
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      text = await extractExcelText(buffer);
      break;
    case "application/vnd.ms-excel":
      throw new Error("Legacy .xls format is not supported. Please convert to .xlsx format.");
    case "text/csv":
      text = extractCsvText(decoder.decode(content));
      break;
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      text = await extractPptxText(buffer);
      break;
    case "application/vnd.ms-powerpoint":
      throw new Error("Legacy .ppt format is not supported. Please convert to .pptx or .pdf format.");
    default:
      throw new Error(`Unsupported file type: ${mimeType}`);
  }

  // Strip null bytes — PostgreSQL text columns cannot store \u0000
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x00/g, "");
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const data = await pdf(buffer);
    return data.text || "";
  } catch (err) {
    throw new Error(`Failed to extract PDF text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (err) {
    throw new Error(`Failed to extract DOCX text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function extractExcelText(buffer: Buffer): Promise<string> {
  try {
    const workbook = new ExcelJS.Workbook();
    const excelPayload = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(excelPayload);
    const textParts: string[] = [];

    for (const sheet of workbook.worksheets) {
      textParts.push(`## Sheet: ${sheet.name}\n`);

      let rowCount = 0;
      sheet.eachRow((row) => {
        rowCount += 1;
        if (rowCount > 1000) {
          return;
        }

        const rowValues = (row.values as Array<unknown>)
          .slice(1)
          .map((value) => {
            if (value === null || value === undefined) return "";
            if (typeof value === "object") {
              if ("text" in (value as Record<string, unknown>)) {
                return String((value as { text?: unknown }).text ?? "");
              }
              if ("result" in (value as Record<string, unknown>)) {
                return String((value as { result?: unknown }).result ?? "");
              }
            }
            return String(value);
          });

        const normalized = rowValues.join(", ").trim();
        if (normalized) {
          textParts.push(normalized);
        }
      });

      if (sheet.rowCount > 1000) {
        textParts.push(`... and ${sheet.rowCount - 1000} more rows`);
      }
      textParts.push("\n");
    }

    return textParts.join("\n");
  } catch (err) {
    throw new Error(`Failed to extract Excel text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

const MAX_PPTX_ENTRIES = 3000;
const MAX_PPTX_SLIDES = 200;
const MAX_PPTX_XML_BYTES = 2 * 1024 * 1024;
const MAX_PPTX_TEXT_CHARS = 1_000_000;

async function extractPptxText(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const zipEntryPaths = Object.keys(zip.files);

    if (zipEntryPaths.length > MAX_PPTX_ENTRIES) {
      throw new Error("PPTX contains too many files to process safely.");
    }

    const slidePaths = zipEntryPaths
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
      .sort((a, b) => extractSlideNumber(a) - extractSlideNumber(b))
      .slice(0, MAX_PPTX_SLIDES);

    if (slidePaths.length === 0) {
      throw new Error("No slide content found in PPTX file.");
    }

    const decoder = new TextDecoder("utf-8");
    const textParts: string[] = [];
    let totalChars = 0;

    for (let i = 0; i < slidePaths.length; i++) {
      const slidePath = slidePaths[i];
      const slideFile = zip.file(slidePath);
      if (!slideFile) continue;

      const xmlBytes = await slideFile.async("uint8array");
      if (xmlBytes.byteLength > MAX_PPTX_XML_BYTES) {
        throw new Error(`Slide ${i + 1} is too large to process safely.`);
      }

      const xml = decoder.decode(xmlBytes);
      const slideText = extractPptxSlideText(xml);
      if (!slideText) continue;

      totalChars += slideText.length;
      if (totalChars > MAX_PPTX_TEXT_CHARS) {
        throw new Error("PPTX extracted text exceeds safe processing limits.");
      }

      textParts.push(`## Slide ${i + 1}`);
      textParts.push(slideText);
    }

    return textParts.join("\n\n").trim();
  } catch (err) {
    throw new Error(`Failed to extract PPTX text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

function extractSlideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function extractPptxSlideText(xml: string): string {
  const textNodes = xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi);
  const parts: string[] = [];
  for (const match of textNodes) {
    const value = decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim();
    if (value) {
      parts.push(value);
    }
  }
  return parts.join("\n");
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return "\"";
      case "apos":
        return "'";
      default:
        if (entity.startsWith("#x")) {
          const parsed = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
        }
        if (entity.startsWith("#")) {
          const parsed = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
        }
        return "";
    }
  });
}

function extractCsvText(content: string): string {
  try {
    const records = csvParse(content, {
      skip_empty_lines: true,
      relax_column_count: true,
    });

    if (records.length === 0) return content;

    const headers = records[0] as string[];
    const rows = records.slice(1) as string[][];

    const textParts: string[] = [];
    textParts.push(`Columns: ${headers.join(", ")}\n`);
    textParts.push(`Total rows: ${rows.length}\n\n`);

    for (let i = 0; i < Math.min(rows.length, 1000); i++) {
      const row = rows[i];
      const rowText = headers
        .map((h, j) => `${h}: ${row[j] || ""}`)
        .join(" | ");
      textParts.push(`Row ${i + 1}: ${rowText}`);
    }

    if (rows.length > 1000) {
      textParts.push(`\n... and ${rows.length - 1000} more rows`);
    }

    return textParts.join("\n");
  } catch {
    return content;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}
