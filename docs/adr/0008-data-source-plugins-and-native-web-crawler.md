# ADR-0008: Data source plugins and a native web crawler

- Status: Accepted
- Date: 2026-09-24

> **Note (2026-09-26):** Migrations no longer seed the first institution's domain: a fresh install's allowlist is empty unless `CRAWL_ALLOWLIST_SEED` sets patterns. See [ADR-0018](0018-open-source-institution-neutral.md).

## Context

v1 needs uploaded files and scraped public websites. Later it will need more types, such as SharePoint. yoink already has a proven crawler (scrape, batch, crawl, map) with URL policy, robots.txt, sitemaps, per-origin throttling, SSRF controls and HTML-to-Markdown extraction. Office and PDF parsing needs good structure extraction (headings, pages). The platform should not depend on an external parsing service to function. Future connectors will bring per-file permissions and PII risks we don't handle in v1.

## Decision

**Plugin interface.** Each source type is a Go plugin registered at startup. It implements `SourceType` (`Key`, `ConfigSchema`, `Capabilities`, `ValidateConfig`, `Sync`) and writes to a `DocumentSink` (`Upsert`, `Delete`). Platform admins enable or disable types and set per-type limits.
- **One type per source,** fixed at creation. Config is type-specific JSON validated against the plugin's JSON Schema, which the UI and API also use.

**`upload`.** Files arrive through the API or UI and are streamed to S3-compatible storage, deduplicated by SHA-256. Replacing a file creates a new document version. v1 file types: text-based PDF, DOCX, PPTX, HTML, Markdown and TXT. The maximum file size is set per type and admins can change it. The default is 100 MB.

**`web`: a native crawler ported from yoink.** yoink is not a runtime dependency. We port its crawl, scrape, batch and map code. **There is no JS rendering.** yoink's `render*` packages and chromedp are not ported.
- Modes (one per source): `scrape` (one URL), `batch` (a URL list), `crawl` (seeds plus scope: depth, include/exclude patterns, page limit) and `map` (discover URLs without fetching content; used for previews and also exposed in the API).
- **Domain allowlist:** admin-managed wildcard patterns (`*.example.edu`, `example.org`, `*`). Teams can request other domains, and platform admins approve them for that team.
- **SSRF protection is always on**, even when the allowlist is `*`. Private, loopback and link-local addresses are blocked both at DNS resolution and when connecting.
- robots.txt and per-origin rate limits are always respected. Per-origin pacing uses Valkey (ADR-0015).
- Public sites only in v1. The config schema leaves room for authenticated crawling later.
- Crawl state is stored in Postgres, and steps run as River jobs. Pages missing from a completed full crawl are tombstoned. Per-team limits cover pages per day and concurrent crawls.

**Parsing (revised 2026-09-25).** Built-in Go parsers handle every v1 format in-process:
- PDF via PDFium compiled to WebAssembly (go-pdfium, no CGO, sandboxed). Headings come from font sizes, running headers and footers are removed, and pages are marked.
- DOCX and PPTX via our own Office XML readers with decompression limits.
- HTML via the ported yoink extractor (`internal/htmlmd`).
- Markdown and plain text.

Apache Tika is **optional** (`TIKA_URL`): a fallback when a built-in parser fails, or preferred for the kinds in `TIKA_PREFER_KINDS`. **There is no OCR in v1.** Scanned PDFs are marked `skipped(needs_ocr)`, unless an OCR-enabled Tika is configured.

**PII scan hook.** A pipeline stage after parsing that does nothing in v1. Next comes pattern scanning (SSN, student ID numbers, card numbers) that quarantines documents in Open or Sensitive sources until a team admin reviews them. Model-based detection follows.

**Document ACL column reserved.** Documents have a nullable `acl` column, and retrieval has an ACL filter hook. Both are empty in v1.

## Consequences

- New connectors plug in without changing the pipeline, the UI (schema-driven forms) or the schema (ACL column).
- We own the crawler code and can fit it to multi-tenant limits and classification.
- **Costs and risks:**
  - The ported crawler is now ours to maintain. Fixes in yoink won't arrive automatically.
  - Without JS rendering, single-page-app sites yield little or no content.
  - Without OCR, scanned PDFs are skipped.
  - We own the Office XML readers and the PDF layout heuristics. Unusual layouts (multi-column, complex tables) may come out worse than with Tika; the fallback covers the worst cases.
  - PDFium in WebAssembly adds about 5.5 MB to the binary and tens of MB of memory per concurrent PDF (bounded by `PDF_WORKERS`).
  - The v1 scan hook does nothing, so the PII protection in v1 is classification plus the terms of use.

## Alternatives considered

- **Calling yoink as a service.** Rejected. It adds a runtime dependency and splits crawl state across systems.
- **Headless-browser rendering.** Rejected for v1. It brings heavy resources and a larger attack surface.
- **Tika as the required parser.** Rejected. It would be a hard runtime dependency for every upload. It is kept as an optional fallback.
- **Pure-Go PDF text libraries.** Rejected for now. They are younger and less robust than PDFium on real-world files.
