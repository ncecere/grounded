import pdf from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { parse as csvParse } from "csv-parse/sync";

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
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
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
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

  switch (mimeType) {
    case "text/plain":
    case "text/markdown":
      return decoder.decode(content);
    case "text/html":
      return htmlToText(decoder.decode(content));
    case "application/json":
      try {
        const json = JSON.parse(decoder.decode(content));
        return JSON.stringify(json, null, 2);
      } catch {
        return decoder.decode(content);
      }
    case "application/xml":
    case "text/xml":
      return xmlToText(decoder.decode(content));
    case "application/pdf":
      return await extractPdfText(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return await extractDocxText(buffer);
    case "application/msword":
      throw new Error("Legacy .doc format not fully supported. Please convert to .docx format.");
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
      return extractExcelText(buffer);
    case "text/csv":
      return extractCsvText(decoder.decode(content));
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return extractPptxText(buffer);
    case "application/vnd.ms-powerpoint":
      throw new Error("Legacy .ppt format not fully supported. Please convert to .pptx format.");
    default:
      throw new Error(`Unsupported file type: ${mimeType}`);
  }
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

function extractExcelText(buffer: Buffer): string {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      textParts.push(`## Sheet: ${sheetName}\n`);

      const csv = XLSX.utils.sheet_to_csv(sheet);
      textParts.push(csv);
      textParts.push("\n");
    }

    return textParts.join("\n");
  } catch (err) {
    throw new Error(`Failed to extract Excel text: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
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

function extractPptxText(buffer: Buffer): string {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      textParts.push(`## Slide: ${sheetName}\n`);

      const text = XLSX.utils.sheet_to_txt(sheet);
      if (text.trim()) {
        textParts.push(text);
      }
      textParts.push("\n");
    }

    return textParts.join("\n") || "No text content found in presentation.";
  } catch (err) {
    throw new Error(`Failed to extract PowerPoint text: ${err instanceof Error ? err.message : "Unknown error"}`);
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
