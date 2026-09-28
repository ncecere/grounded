# ADR-0021: Repeated-boilerplate suppression at ingest

- Status: Accepted
- Date: 2026-09-26

## Context

Main-content extraction (`htmlmd`, `MainContentOnly`) removes `<nav>`, `<header>` and `<footer>`, but many sites put repeated text inside the main content: "QUICKLINKS" lists, calls to action, "related content" cards, newsletter prompts and sign-offs. On the first deployment's dev instance, a crawl of `pydantic.dev` produced 3,462 chunks but only 2,584 distinct texts, and some blocks appeared on 147 of 200 pages. The registrar site repeats a QUICKLINKS block on 29 of 58 pages. These blocks match many questions a little, so they are retrieved and cited in place of real content. A related QA finding (P-13) is that a chunk made only of image alt text (the caption of a photo of a campus building) was retrieved and cited.

Whether a block is boilerplate depends on the rest of the source. A crawl indexes early pages before later pages show what repeats.

## Decision

- **Per source, block level.** A document's blocks are the chunker's blocks: heading lines, paragraphs, lists, tables and code. Each block is normalised for comparison: link and image targets removed, lower case, whitespace collapsed, and runs of digits folded to `0` (dates, years, counts), except in headings, where numbers name sections. The normalised text is hashed (FNV-1a, 64 bit). Each processed document's distinct hashes are recorded in `document_blocks`.
- **Threshold.** A block is boilerplate when at least `max(minDocs, ceil(ratio × documents))` of the source's ready documents contain it. The defaults are minDocs **5** and ratio **0.2**, tuned on the two real sites ([`benchmarks/boilerplate.md`](../benchmarks/boilerplate.md)).
- **Keep one copy.** Each boilerplate block stays in one document, the one with the shortest URL (usually the home page or a section index), and is dropped from every other document. A footer's address and phone number stay findable, once, instead of disappearing.
- **Never drop a document's only content.** If nothing but headings would remain, nothing is dropped (and it is logged). Dropped headings keep their place in the heading paths of the blocks under them, and a dropped section heading still starts a new chunk.
- **Image-only chunks are not emitted.** A chunk whose only text is images (alt text), headings and rules is skipped, unless every chunk of the document is like that. Alt text inside chunks with other text stays.
- **Order independence through a refresh job.** `boilerplate.refresh` (River, one per source, idempotent) runs after every crawl run, upload batch, deletion or settings change:
  1. It waits until the source has no documents in flight (up to 30 minutes).
  2. It records the hashes of ready documents that have none yet, from their stored parsed Markdown.
  3. It recounts in SQL and stores the classification (`source_boilerplate_blocks`). The source's revision moves only when the set of blocks or a canonical copy changes.
  4. It re-checks documents chunked under an older revision. Those whose dropped blocks are unchanged only move to the new revision. The others are re-chunked from the stored parsed Markdown, with no fetching or parsing. Chunks whose text, heading path and pages are unchanged keep their rows and vectors, and only new chunks are embedded.

  The work is bounded: at most 50 documents backfilled, 200 re-checked and 20 re-chunked per step, and 5 minutes per invocation, after which the job snoozes itself. A document processed while the classification changed requests another refresh when it commits. A periodic sweep (every minute; one indexed query) enqueues refreshes that are due but have no job: requested while a refresh was finishing, or left unfinished.
- **Settings.** Each source may override `boilerplate: {enabled, minDocs, ratio}`. It is on by default for web sources and off for uploads (opt-in). The platform defaults are `BOILERPLATE_WEB`, `BOILERPLATE_UPLOAD`, `BOILERPLATE_MIN_DOCS` and `BOILERPLATE_RATIO`. Changing a source's settings is audited (`source.boilerplate_update`) and schedules the refresh.
- **Visibility.** The source's API object reports the settings in force, how many repeated blocks were found and how many pages they were removed from. `GET …/sources/{id}/boilerplate` lists the most repeated blocks (first 80 characters, document count). The source Overview shows both, so owners can see what is suppressed.

## Consequences

- Retrieval sees each repeated block once instead of once per page. On the evaluation sites this removed 7–21% of chunks (distinct-chunk ratio 0.92→0.99 and 0.77→0.97), and the registrar question set's nDCG@10 did not change (see the benchmark).
- Storage: 8 bytes per distinct block per document (`document_blocks.hashes`), plus a small classification table per source. Counting is a SQL `unnest … GROUP BY` over the source's rows. It runs in a background job after changes, never on the query path.
- A block that repeats on at least the threshold share of pages but matters per page is kept only on its canonical page. The ratio floor of 0.05 and the default of 0.2 keep per-form instructions that repeat on a few PDFs (8 of 58 on the registrar site). Owners can see the list, raise the thresholds or turn suppression off.
- Migration 00022 schedules a refresh for every existing web source. After upgrading, their pages are re-checked in the background and changed chunks re-embedded, within the connection's request limit.
- Later: SystemOne ingest checks (ADR-0020) could judge near-duplicates that exact hashing misses, such as a nav list with one item highlighted.
