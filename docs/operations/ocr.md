# OCR for scanned documents

Grounded reads PDF, Word, PowerPoint, HTML, Markdown and text itself. **OCR** reads what has no text layer: scanned PDF pages, and PNG, JPEG and TIFF uploads. It is **off by default**; with it off, parsing is exactly as without OCR (a scanned PDF is skipped as "Needs OCR"). The design is [`ocr.md`](../ocr.md); DESIGN.md §5.5 has the summary.

## How it works

- Only pages **without a text layer** are read with OCR. Grounded renders each such page to a greyscale PNG (300 DPI) and sends it to one backend; the text goes in under the page's marker, so page numbers and citations work as for any page. Pages with text are never OCR'd.
- An image upload is a one-page document read with OCR. Only the first page of a multi-page TIFF is read, with a warning.
- The document's page in the UI says which pages were read, e.g. "Pages 3–7 were read with OCR (Tesseract)." The API has them in `Document.ocr`, and the parser name says so (`builtin:pdf+ocr:tesseract`).
- The crawler still ignores images.

## Choosing a backend

| Backend | Deploy | Good for | Cost |
|---|---|---|---|
| **Tesseract** (recommended) | the `ocr-tesseract` Kustomize component (the `grounded-ocr` image) | printed text in the configured languages; fast on CPUs | CPU only |
| **Apache Tika** | the existing `tika` component with the `-full` image | installs that already run Tika | CPU; the `-full` image is large |
| **Vision model** | a model of kind **Vision (OCR)** in Admin → Models, on a gateway that serves a vision model | forms, tables and handwriting-like layouts; returns Markdown | tokens per page (recorded in the usage ledger) |

Only configured backends can be chosen in Admin → Parsing & OCR: Tesseract needs `OCR_TESSERACT_URL`, Tika needs `TIKA_URL`, and the vision backend needs a vision model.

A vision model is subject to its **maximum classification** like any model: sources classified above it get no OCR (their scanned pages stay "Needs OCR", and images can't be uploaded to them). Choose a model approved for the data you scan, or use Tesseract, which runs inside your cluster.

## Deploying the Tesseract sidecar

Kubernetes: add the component to your overlay and pin the image by digest (the image workflow's summary prints it; release notes list it too):

```yaml
components:
  - ../../components/ocr-tesseract
images:
  - name: ghcr.io/ncecere/grounded-ocr
    newTag: v0.2.0
    digest: sha256:<digest>
```

It adds the `grounded-ocr` Deployment and Service (port 8080), a NetworkPolicy that lets only Grounded's api and worker pods call it, and `OCR_TESSERACT_URL=http://grounded-ocr:8080` in `grounded-config`. The sidecar runs as a non-root user with a read-only root filesystem and writes only a temporary directory per request under `/tmp`.

Sizing: each request is one page; the sidecar runs `OCR_CONCURRENCY` Tesseract processes at once (2 in the component, matching its CPU limit) and queues the rest until its timeout. Each Grounded worker sends at most `OCR_CONCURRENCY` pages at once (default 2). A page takes about 0.5–3 s of CPU; scale the sidecar's replicas or CPUs with the number of workers.

Docker Compose (development): `docker compose --profile ocr up -d --build ocr`, then `OCR_TESSERACT_URL=http://127.0.0.1:58080` in `.env`.

Verify: `kubectl exec deploy/grounded-ocr -- grounded-ocr version` prints the sidecar's and Tesseract's versions; then use the **Test** button (below).

### The sidecar's API and settings

`POST /ocr?lang=eng+spa` with a PNG body returns `{"text": "...", "confidence": 0.93}` (the mean word confidence, 0–1); `GET /languages` lists the installed languages; `GET /healthz` answers `ok`. A language that isn't installed is a 400; a body over the limit is a 413; a non-PNG body is a 415; an unreadable image is a 422; no free slot within the timeout is a 503.

| Setting | Default | Meaning |
|---|---|---|
| `OCR_ADDR` | `:8080` | listen address |
| `OCR_CONCURRENCY` | one per CPU | Tesseract processes at once |
| `OCR_MAX_BYTES` | 33554432 (32 MiB) | largest image accepted |
| `OCR_TIMEOUT` | `2m` | a request, waiting for a slot included |
| `OCR_TESSERACT` | `tesseract` | the program to run |

## Languages

Admin → Parsing & OCR's **Languages** are Tesseract codes joined with `+`, e.g. `eng` or `eng+spa`. More languages are slower and can be less exact; list only the ones your documents use. They apply to Tesseract and Tika; a vision model reads any language.

The `grounded-ocr` image ships: `eng`, `spa`, `fra`, `deu`, `ita`, `por`, `nld`, `pol`, `rus`, `ukr`, `ara`, `hin`, `chi_sim`, `chi_tra`, `jpn`, `kor`, `vie` (and `osd`). For another language, derive an image:

```dockerfile
FROM ghcr.io/ncecere/grounded-ocr:v0.2.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr-ell && rm -rf /var/lib/apt/lists/*
USER 65532:65532
```

Tika's `-full` image has its own set of Tesseract languages.

## Using Tika instead

Switch the `tika` component to the `-full` image (it includes Tesseract), for example in your overlay:

```yaml
images:
  - name: docker.io/apache/tika
    newTag: 4.0.0-1-full
    digest: sha256:<the -full tag's digest>
```

Give it more memory (the `-full` image is larger). Grounded sends each page image to `PUT /tika` with the languages in `X-Tika-OCRLanguage`. Tika without Tesseract returns no text: the Test button then says "No text came back". Tika as a *fallback parser* (`TIKA_PREFER_KINDS`) never parses images, and a document waiting for OCR doesn't fall back to it.

## Turning OCR on, and the Test button

1. Admin → **Parsing & OCR**: turn on **Read scanned pages and images with OCR**, choose the backend, the languages (or the vision model), and save. Changes are audited (`platform.parsing_settings_update`).
2. **Test** reads a built-in sample page ("Grounded OCR test page …") with the backend on the form, saved or not, and shows the text, the time and the confidence (a vision model: its tokens). A failure shows the backend's error.
3. Each source has its own **OCR** switch (Settings tab), on by default: turn it off where scanned pages are noise. With it off, scanned pages are skipped and images can't be uploaded to the source.

## Retrying scanned documents

Documents uploaded before OCR was on were skipped as "Needs OCR" (error code `needs_ocr`). A team retries them from the source's **Documents** tab: filter **Needs OCR**, then **Retry all that need OCR** (API: `POST /v1/teams/{team}/sources/{id}/documents/retry` with `{"errorCode": "needs_ocr"}`; shared sources under `/v1/admin/shared-sources/{id}/documents/retry`). The retry is audited (`document.retry_bulk`). The button is disabled, with the reason next to it, while OCR is off for the source or the platform (a source's `ocrState` in `GET …/sources/{id}` says which), since a retry would only skip them again.

**As a platform admin**, Admin → **Parsing & OCR** → **Documents that failed or need OCR** lists them, with every failed document, by team and source: the count, the reason (needs OCR, OCR error, damaged or unsupported file, other failure) and the oldest date, but no file names or text. Each group's menu has:
- **Retry these:** queues them again (`POST /v1/admin/parsing/document-problems/retry` with `{"sourceId", "reason"}`, audited `platform.documents_retry` with the count). Needs OCR and OCR errors are refused with the reason while OCR is off for the platform or the source, or the vision model isn't approved for the source's classification. Damaged files usually fail again: the team has to fix and upload them.
- **Notify owners:** the team's owners get **Documents need attention** in the app and by email (`source.documents_attention`, can't be turned off) with the count and a link to the source's Documents filtered to Failed or Needs OCR (`POST …/notify`, audited `platform.document_owners_notify`). Shared sources have no owners to notify.

Auditors see the list but not the actions.

A PDF with only some pages lacking a text layer is indexed (ready) with a warning such as "1 of 2 pages had no text layer (possibly scanned) and was skipped, because OCR is off for this document". It isn't "Needs OCR" and isn't retried with them: once OCR is on, delete the document and upload it again to read those pages (uploading the same file over it changes nothing, as its content is unchanged).

## Bounds and costs

- **Per document:** at most `OCR_MAX_PAGES_PER_DOCUMENT` pages (default 200); the rest are skipped with a warning on the document.
- **Per worker:** at most `OCR_CONCURRENCY` pages at once (default 2), across every document the worker processes, so OCR can't take all of ingestion.
- **Per team per day:** the team limit **OCR pages per day** (`ocr_pages_per_day`, default 1,000, UTC day; Admin → Limits). A document that would pass it **waits**: it shows as *Waiting* with "Waiting for the team's daily OCR page limit", frees its ingestion slot and continues after midnight UTC, or at once when the limit is raised. A document that needs more pages than the whole limit reads as many as the limit allows, with a warning. `0` blocks OCR for the team: scanned pages are skipped with a warning. Documents processed at the same moment don't see each other's pages, so a day can end a few documents over the limit.
- **Usage ledger:** every document read with OCR records `ocr_pages` (the pages read, with the backend in its metadata); a vision model also records `vision_tokens_in` and `vision_tokens_out` with the model. A document retried after a failure is read (and counted) again.
- **Page size:** pages are rendered at 300 DPI, lower for pages larger than about 20 inches, so no image is more than 6,000 pixels on its longest side. Image uploads are refused above 100 megapixels.

| Setting (Grounded) | Default | Meaning |
|---|---|---|
| `OCR_TESSERACT_URL` | (none) | the `grounded-ocr` sidecar; makes Tesseract selectable |
| `OCR_TIMEOUT` | `2m` | one page's OCR request (Tesseract; Tika uses `TIKA_TIMEOUT`, a vision model its connection's timeout) |
| `OCR_MAX_PAGES_PER_DOCUMENT` | 200 | pages read per document at most |
| `OCR_CONCURRENCY` | 2 | pages read at once per worker process |

## Troubleshooting

- **Documents fail with `ocr_unavailable`:** the backend didn't answer (network, 5xx, timeout). They are retried with backoff and then fail; retry them once the backend is back. Check the sidecar's pods and its NetworkPolicy (the api and worker pods must carry `app.kubernetes.io/component: api|worker`).
- **"OCR could not read page N":** the backend refused that page (e.g. a vision model refused the image); the rest of the document is indexed.
- **Scanned pages still skipped with OCR on:** the source's OCR switch is off, the team's daily limit is 0, the vision model is disabled, or the source is classified above the vision model's maximum.
- **Poor text:** check the languages; scans below about 200 DPI or photos at an angle read badly with Tesseract; a vision model does better on forms and tables.
