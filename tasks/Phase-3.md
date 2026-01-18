# Phase 3 - HTML-Only Crawling

## Goals
- Ensure web crawling only processes HTML pages.
- Skip downloads and binary content while preserving visibility in reporting.

## Tasks
- Enforce content-type allowlist in fetch (HTML/XHTML only).
- Add a "skipped_non_html" status in page tracking.
- Disable Playwright downloads and ensure non-HTML is not fetched.
- Record skip reasons for reporting.
- Update source run stats to include skipped counts.

## Deliverables
- HTML-only crawling policy and implementation plan.
- Updated status list and reporting fields.
