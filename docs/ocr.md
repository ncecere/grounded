# OCR for scanned documents (B4, v0.2)

Status: **agreed** (owner, 2026-09-28), for M4 of [`v0.2.0.md`](v0.2.0.md) §3.4. The owner's decisions are in §9.

Today a PDF page without a text layer is skipped with a warning, and a PDF with no text at all fails with "it may be scanned; OCR is not available yet" (`parse.ErrNeedsOCR`). B4 reads those pages with OCR. It is **off by default**: with OCR off, parsing is exactly as today.

## 1. How it works

1. The built-in PDF parser (PDFium, in-process) already knows which pages have no text. With OCR on, it **renders only those pages** to images (PDFium `RenderPageInDPI`, 300 DPI, grey) and sends each to the configured OCR backend.
2. The returned text goes in at the page's position, under its page marker, so page numbers and citations work as for any page.
3. Pages that have text are never OCR'd: OCR is slower and less exact than a real text layer.
4. The document records which pages were OCR'd and by which backend (`parser` becomes e.g. `builtin:pdf+ocr:tesseract`; the page list is in the document's metadata). Its record page says "Pages 3–7 were read with OCR (Tesseract)".

Rendering in-process means every backend gets the same input, one page image at a time, so the backends stay interchangeable and small.

## 2. Backends

| Backend | What it is | Configured by |
|---|---|---|
| **Tesseract** (reference install) | A small sidecar: image in, text out (§3) | `OCR_TESSERACT_URL`, the Kustomize component `components/ocr-tesseract` |
| **Apache Tika** | The existing optional Tika component with the `-full` image, which includes Tesseract; Grounded sends it the page image | the existing `TIKA_URL` (the component switches to the `-full` image when OCR is wanted) |
| **Vision model** | A catalog model of a new kind `vision`, called through the gateway page by page ("transcribe this page as Markdown") | Admin → Models; subject to the model's classification ceiling like any model (a source above it can't use it) |

Only backends that are configured can be chosen. Admin → **Parsing** (new page, under Platform) turns OCR on, picks the backend, and sets the languages (Tesseract/Tika, e.g. `eng` or `eng+spa`) and the caps (§4). A **Test** button OCRs a built-in sample page and shows the text and time.

## 3. The Tesseract sidecar

`grounded-ocr`, a separate image built and released from this repository alongside `grounded` (same workflow: multi-arch, signed, SBOM, vulnerability scan):
- A tiny Go HTTP server (`cmd/grounded-ocr`) that runs the `tesseract` CLI (Tesseract 5, from the base image's packages) on each request. No CGO in Grounded itself.
- `POST /ocr?lang=eng` with a PNG body → `{"text": "...", "confidence": 0.93}`; `GET /healthz`; `GET /languages`.
- Bounded: one request per CPU by default, a size limit, a timeout, no disk writes beyond a temp file.
- The image ships a set of common languages; more can be added with a derived image (documented).
- `components/ocr-tesseract`: Deployment, Service and NetworkPolicy (only Grounded's workers may call it), and a patch that sets `OCR_TESSERACT_URL` on the worker. Compose gets an optional `ocr` profile for development.

## 4. Bounds and costs

- **Per document:** at most `OCR_MAX_PAGES_PER_DOCUMENT` pages (default 200); pages beyond it are skipped with a warning.
- **Per team per day:** a new limit `ocr_pages_per_day` (default 1,000; UTC day, like other daily limits). A document that would pass it waits, like a crawl waiting for tomorrow's page quota, and resumes when the limit is raised.
- **Usage:** a new ledger kind `ocr_pages` (with the backend), and for a vision model its input and output tokens. With E2, a vision model's OCR is priced per input and output token like any model (spend category "OCR"). Tesseract and Tika pages are counted (`ocr_pages`) but not priced yet: prices belong to catalog models, and those backends aren't models. A budget at 100% pauses OCR with the rest of ingestion.
- **Concurrency:** OCR runs inside the ingestion job, with at most `OCR_CONCURRENCY` pages at once per worker (default 2), so it can't starve other ingestion.

## 5. Per source, and retrying old failures

- Each source has an **OCR** switch, on by default once the platform has OCR, so a team can keep OCR off for a source where scanned pages are noise.
- Documents that failed as "may be scanned" before OCR was on can be retried in bulk: a source's documents list filters "Needs OCR", and **Retry** reprocesses them.
- **Partly scanned PDFs** (v0.4.1, B12): a PDF with only some pages lacking a text layer, processed while OCR was off for it, is indexed (`ready`) with its typed pages, and also needs OCR: the parser records the pages without text (`parse.Document.NeedsOCR`), and the document keeps the error code `needs_ocr` with a message naming them ("Page 2 has no text layer (it may be a scan) and wasn't read, because OCR is off for this document. Once OCR is on, retry it to read that page.") beside its warning. It shows **Ready** with that message in the documents list, is found by the **Needs OCR** filter and counted with the documents that need OCR (Admin → Parsing per team, and the needs-OCR group of the documents that need attention). Once OCR can read its source, **Retry all that need OCR**, the document's own **Retry with OCR** (the label for every document that needs OCR) and an admin's **Retry these** parse it again: the pages with text are read as before and only the pages without text go to OCR. It keeps its passages until then. While OCR can't read the source, the bulk retry leaves it out (it would be indexed again without those pages), and its own retry is refused (409 `ocr_off`, saying why; the button is disabled with the reason).
- **Admins and failed documents** (owner decision 3 of [`v0.2.0.md`](v0.2.0.md) §7): Admin → **Parsing & OCR** lists the documents that failed or need OCR by team and source, with the count, the reason class (needs OCR, OCR error, damaged or unsupported file, other failure) and the oldest date, and never a file name, title, URL or text (admins can't read a team's documents). Per group, **Retry these** queues them again (for needs OCR and OCR errors only while OCR can read the source; otherwise it says why), and **Notify owners** sends the team's owners the notification `source.documents_attention` (in the app and by email; it can't be turned off, like other platform actions on a team's content) with the count and a link to the source's Documents filtered to Failed or Needs OCR. Both are audited as platform actions with the count (`platform.documents_retry`, `platform.document_owners_notify`). The Admin Overview's "failed to index" item links there. API: `GET /v1/admin/parsing/document-problems` (platform admins and auditors), `POST …/document-problems/retry` and `…/notify` (platform admins).

## 5a. Image uploads

Uploads of PNG and JPEG become one-page documents, read with OCR (a new parse kind `image`); a TIFF has a page for each of its pages (v0.4.1, B12; below). Where the source's OCR is off (or the platform's), the upload is refused at once with "Images need OCR, which is off for this source" rather than failing later. The upload dialog knows beforehand from the source's `ocrState` (`on`, `source_off`, `platform_off` or `not_approved`): it lists images as accepted only when OCR reads them, and otherwise gives this reason for an image, with the way to the source's settings when its own switch is off. The crawler still ignores images.

**Multi-page TIFF** (v0.4.1, B12). Go's TIFF decoder reads only a file's first image directory, so Grounded walks the directory chain itself (little- and big-endian, stopping at a directory that is outside the file, cut short or seen before) and decodes page *n* by reading the file as if its header's first-directory offset pointed at page *n*'s directory: a header rewrite on read, no new decoder and no copy of the file. Each page is then recognised like a scanned PDF page (one greyscale PNG per OCR request, at most `OCR_CONCURRENCY` at once), under its own page marker, so citations name the page. The document has as many pages as the TIFF, up to the page limit PDFs have (5,000; beyond it "only the first 5000 pages of this TIFF were processed"), and the OCR caps apply as for a PDF (`OCR_MAX_PAGES_PER_DOCUMENT`, the team's daily limit). A page that can't be decoded or read is a warning ("OCR could not read page 2"); a damaged first page fails the document as damaged. BigTIFF isn't read (Go's decoder doesn't read it either).

## 6. API (OpenAPI first)

- `GET/PUT /v1/admin/parsing` (OCR on/off, backend, languages, caps; If-Match), `POST /v1/admin/parsing/test`.
- Sources gain `ocrEnabled`; documents gain `ocr: {pages: [...], backend}` and the error code `needs_ocr`; the existing document retry endpoint works for them, plus a bulk retry by error code.
- Every new operation classified in the authorization matrix; settings changes audited.

## 7. Data

Migration (next number at merge): `parsing_settings` (singleton: ocr_enabled, backend, vision_model_id, languages, max pages per document, revision), `data_sources.ocr_enabled` (default true), document metadata for OCR pages. The `vision` model kind extends the `models.kind` check.

## 8. Tests and gates

A fixture PDF with a scanned page and a fully scanned PDF (generated in the test: text rendered to an image, embedded without a text layer). Unit tests with a fake OCR backend: only empty pages are sent, text lands under the right page marker, caps and warnings. Integration: the daily limit waits and wakes, the ledger kinds, bulk retry, the authorization matrix. The sidecar has its own tests (with the real `tesseract` binary in CI's container job). The k8s smoke test deploys `components/ocr-tesseract`, turns OCR on and ingests a scanned page (v0.4.1, §10). Web tests with axe for Admin → Parsing, the source switch and the record page's OCR note.

## 9. Owner decisions (2026-09-28)

1. ~~The Tesseract sidecar?~~ **Our own `grounded-ocr` image** (owner, 2026-09-28), built, signed and released with Grounded (§3).
2. ~~Image files as documents?~~ **Yes, uploads of PNG, JPEG and single-page TIFF** (owner, 2026-09-28): each is a one-page document read with OCR; refused with a clear message where OCR is off; the crawler still ignores images; multi-page TIFF later.
3. ~~The vision-model backend?~~ **In v0.2** (owner, 2026-09-28), tested against the fake gateway; the reference install keeps Tesseract until a vision model runs on the Spark.
4. ~~A price for Tesseract and Tika pages?~~ **No** (owner, 2026-09-28): they run on the operator's own hardware, so their pages are counted (`ocr_pages`) but not priced; a vision model is priced per token like any model.

## 10. Implementation notes (B4, v0.2)

Built as agreed, with these choices where the design left room:
- The per-document cap and the concurrency are configuration (`OCR_MAX_PAGES_PER_DOCUMENT`, `OCR_CONCURRENCY`), shown on Admin → Parsing, not settings stored in `parsing_settings`.
- A document that needs more pages than the whole daily limit reads as many as the limit allows (with a warning), since it could never wait long enough; one that would only pass what is left of today waits. A limit of 0 skips OCR for the team (with a warning).
- A waiting document is `pending` with `waiting_until` and the error code `ocr_daily_limit`; the dispatcher skips it through a partial index, so documents without OCR are dispatched as before.
- OCR usage is recorded as soon as a document is parsed, whatever happens next; a document retried after a failure is read and counted again.
- The sidecar's NetworkPolicy admits the api as well as the worker: the Test button runs in the api.
- Admin → Parsing sits in the admin sidebar's Content group, next to Crawl domains (there is no Platform group).
- ~~The k8s smoke test doesn't deploy `components/ocr-tesseract`.~~ Since v0.4.1 (B12) it does: `make k8s-smoke` builds the `grounded-ocr` image beside `grounded` (in parallel) and loads both into kind, deploys `test/smoke` (the `test/kind` shape, `components/ocr-tesseract` and the fake model gateway of `test/fake-models`, `grounded demo --serve-fake-models`, whose Demo team gets the new source), turns OCR on through the API as the development admin, uploads the built-in one-page sample (`internal/ocr/sample.png`) and waits until Tesseract's text ("The quick brown fox…") is in its passages (`scripts/kind-smoke-ocr.sh`). CI's `ocr` job still tests the sidecar with the real Tesseract.
