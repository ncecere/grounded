import { log } from "@grounded/logger";
import {
  SCRAPE_TIMEOUT_MS,
  MAX_PAGE_SIZE_BYTES,
  validateHtmlContentType,
  isContentTypeEnforcementEnabled,
  ContentError,
  ErrorCode,
} from "@grounded/shared";

export async function fetchWithHttp(
  url: string
): Promise<{ html: string; title: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Grounded-Bot/1.0; +https://grounded.example.com/bot)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Validate content type (HTML allowlist enforcement)
    if (isContentTypeEnforcementEnabled()) {
      const contentType = response.headers.get("content-type");
      const validation = validateHtmlContentType(contentType);

      if (!validation.isValid) {
        log.info("scraper-worker", "Skipping non-HTML content", {
          url,
          contentType: validation.rawContentType,
          mimeType: validation.mimeType,
          category: validation.category,
          reason: validation.rejectionReason,
        });
        throw new ContentError(
          ErrorCode.CONTENT_UNSUPPORTED_TYPE,
          validation.rejectionReason || `Non-HTML content type: ${validation.mimeType}`,
          { metadata: { url, contentType: validation.rawContentType, mimeType: validation.mimeType } }
        );
      }

      // Log a warning for unknown/empty content types that we're allowing through
      if (validation.category === "unknown") {
        log.warn("scraper-worker", "Processing page with unknown content type", {
          url,
          contentType: validation.rawContentType,
        });
      }
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_PAGE_SIZE_BYTES) {
      throw new Error("Page too large");
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    return { html, title };
  } finally {
    clearTimeout(timeout);
  }
}
