# Repeated-boilerplate suppression: evaluation

Date: 2026-09-26. Design: [ADR-0021](../adr/0021-boilerplate-suppression.md), DESIGN.md §5.5.

**Result.** On two real sites, suppression removes 7–21% of chunks and almost all duplicated text: the distinct-chunk ratio rises from 0.92 to 0.99 (a public university registrar website) and from 0.77 to 0.97 (pydantic.dev). On the 30-question registrar set, retrieval is identical (every question's rank unchanged, nDCG@10 0.948). Duplicated chunks among the pydantic.dev top-10 hits fall from 16 to 2 per 100.

## Setup

- **Grounded** built from this branch, run as `grounded serve` on `127.0.0.1:8094`: its own database, Valkey DB 12, file blobs under `/tmp`, dev auth.
- **Embeddings:** `nomic-embed-text-v1.5` through the AI gateway of [`scale-10k.md`](scale-10k.md), connection limit 90 requests/min. Profile as on the dev instance: 768 dims, `halfvec`, chunk size 512 tokens, no overlap, nomic prefixes.
- **Sources** (both web, the same pages as the dev instance's sources):
  - *Registrar*: batch mode over the dev registrar source's 58 URLs (33 HTML pages, 25 PDF forms).
  - *pydantic.dev*: crawl from `https://pydantic.dev/`, depth 4, sitemaps on, capped at 150 pages (the dev source has 200).
- **Procedure:**
  1. Both sources are created with `boilerplate: {enabled: false}`, crawled and indexed ("before").
  2. Suppression is switched on with the default settings (minDocs 5, ratio 0.2). The `boilerplate.refresh` job counts blocks from the recorded hashes and re-chunks the affected pages from their stored parsed Markdown ("after"). Nothing is fetched or parsed again.
  3. Switching it off again restored every page's chunks byte for byte (the chunk text export was identical to "before").
  4. After deleting the stored hashes (as on an upgrade from a version without them), switching on again backfilled the hashes from parsed text and reached the same result. The numbers below are from that final run.
  5. **Upgrade path.** The database was then taken back to before migration 00022 (tables dropped, goose row removed) with the chunks left as they were, and Grounded restarted. The migration scheduled a refresh for both web sources, which backfilled the hashes and found the same 2 + 36 blocks and 28 + 135 pages. The chunks stayed as they were, and **no embedding requests** were made: every chunk matched an existing row.
- **Retrieval:** `ragbench urlset -api` (30 questions with the pages that answer them; the set is not published, see [`README.md`](README.md#evaluation-data)) against a KB holding only the registrar source, topK 10, platform-default fusion weights. pydantic.dev has no judged question set, so a probe of 10 realistic questions records, for each top-10 list, how many hits are text duplicated on three or more pages and how many distinct pages the hits cover.

## Chunks

| | Registrar before | Registrar after | pydantic.dev before | pydantic.dev after |
|---|---:|---:|---:|---:|
| Documents | 58 | 58 | 150 | 150 |
| Chunks | 375 | **348** (−7.2%) | 2,548 | **2,020** (−20.7%) |
| Distinct chunk texts | 346 | 346 | 1,968 | 1,951 |
| Distinct ratio | 0.923 | **0.994** | 0.772 | **0.966** |
| Chunk tokens | 56,788 | 53,456 (−5.9%) | 425,354 | 384,312 (−9.7%) |
| Most repeated chunk (pages) | 28 (QUICKLINKS) | 1 | 97 (two calls to action) | 10 (a one-word "Comparison" label) |
| Repeated blocks classified | | 2 | | 36 |
| Pages they were removed from | | 28 | | 135 |

For reference, the dev instance (main branch, no suppression) has 376 chunks and 347 distinct texts for the same 58 registrar pages, including one image-only chunk (a photo caption of a campus building, QA P-13). It has 3,462 chunks and 2,584 distinct texts for 200 pydantic.dev pages. Image-only chunks are skipped whatever the boilerplate setting, so the "before" columns above already have none.

**Re-embedding cost.** Re-chunking 163 pages embedded **414** new chunks in 136 requests. The other 1,954 chunks kept their rows and vectors. The whole refresh (backfill, count and re-chunk of both sources) took 7 minutes at the connection's 90 requests/min.

**Thresholds.** 9 of 58 registrar documents and 30 of 150 pydantic.dev documents (ratio 0.2; minDocs 5 is the floor for small sources). Before choosing them, block counts from the dev instance's stored parsed text were compared at several ratios:
- **Registrar:** the QUICKLINKS heading and list are on 29 pages. The next most repeated block is the "Return to: <the registrar's office> … Secure Document Upload" instruction on 8 PDF forms, which matters on each form. Every ratio from 0.15 to 0.5 finds exactly the QUICKLINKS pair; 0.1 would also remove the form instruction.
- **pydantic.dev (200 pages):** 29 blocks sit on 62 or more pages, and the next tier is on 33 or fewer. Ratios 0.2 and 0.3 select the same blocks, and 0.15 adds the product-page calls to action (32–33 pages).

0.2 sits in the gap on both sites, with room on the registrar side.

## Most repeated blocks removed

| Source | Pages | Block (start) |
|---|---:|---|
| Registrar | 29 | QUICKLINKS (heading) |
| Registrar | 29 | Schedule of Courses · Dates and Deadlines · Transcripts · Verify Enrollment · Diplomas · Petitions … (link list) |
| pydantic.dev | 106 | Try Logfire free |
| pydantic.dev | 103 | Image: Product shot (footer call to action) |
| pydantic.dev | 102 | Explore our open source packages |
| pydantic.dev | 97 | Ready to see what your agents are actually doing? · Start free · Talk to us |
| pydantic.dev | 97 | See more from Pydantic in Google Search · Add Pydantic as a preferred source … |
| pydantic.dev | 97 | Related content · View all articles · As Markdown |
| pydantic.dev | 95 | Building agents in production? See what they're actually doing with Logfire … |
| pydantic.dev | 82 | High-volume AI scoring with Jev and Pydantic Evals (a "related content" card) |
| pydantic.dev | 32–34 | Trusted by teams building production software and AI · customer logos · Common questions / FAQ · Start free with 10 million spans … |

Each block stays on one page: the document with the shortest URL that contains it, for example the article index for the card blocks.

## Wrongly removed content

Every page's paragraphs before and after were diffed (the chunk text exports).
- **Registrar:** 28 pages lost exactly two paragraphs each, the QUICKLINKS heading and its list. Nothing else was removed.
- **pydantic.dev:** 135 pages lost text. Every removed paragraph is one of the 36 classified blocks. The 104 that look page-specific are equivalent after normalisation: an "As Markdown" link whose target is the page's own `.md`, the same call-to-action image at another size, and teaser "date /category" lines.
- **Hand inspection** of 12 sampled pages (6 per site) found only navigation, calls to action, "related content" cards, author avatars and category labels removed. Article bodies, headings and code were intact. Heading paths still carry dropped headings, for example the text under a removed "Common questions" heading keeps it in its path.

**One real loss, then fixed.** The first run folded digits in every block, so every article's own date line ("2026/09/01") looked like every other date and was removed from 94 of 95 articles. The normaliser now keeps digits in headings and in blocks with fewer than 8 letters, where the numbers are the content. After the fix, **1 of 95** articles loses its date line: it was published the same day as an article shown in the "related content" cards, and a bare date is identical to the card's. Owners can see such blocks in the list on the source page.

## Retrieval

**Registrar set** (30 questions, topK 10):

| | recall@10 | nDCG@10 | MRR@10 |
|---|---:|---:|---:|
| Before (suppression off) | 0.983 | 0.948 | 0.944 |
| After (defaults) | 0.983 | **0.948** | 0.944 |

Every question's rank is identical before and after. It matches the documented 0.948 for these pages ([`scale-10k.md`](scale-10k.md), "Fusion tuning"). The registrar pages were already well served: the QUICKLINKS block never outranked an answer page on these questions. The set therefore shows no regression, not an improvement.

**pydantic.dev probe** (10 questions, top 10):

| | Duplicated hits in top 10 (of 100) | Mean distinct pages in top 10 |
|---|---:|---:|
| Before | 16 | 5.5 |
| After | **2** | 5.3 |

Before, the #1 hit for "How do I build an agent with Pydantic AI?" was the footer call to action "Ready to see what your agents are actually doing? Start free". After, it is the Pydantic AI section of an article, followed by two getting-started passages. For "How do Logfire dashboards work?", the dashboards article now fills the top three instead of sharing them with repeated cards. The two duplicated hits left are the product comparison pages' "Choose a traditional APM if …" and a "Comparison" label, repeated on 4–10 pages (below the threshold of 30).

## Reproduce

```sh
# Grounded from this branch on :8094 with its own database, Valkey DB and blob dir
ragbench setup -base http://127.0.0.1:8094 -team registrar -chunk-overlap 0 -requests-per-minute 90
# create the two web sources with {"boilerplate": {"enabled": false}}, crawl, then:
ragbench urlset -eval <your questions.jsonl> -api http://127.0.0.1:8094 -kb <registrar KB> -team registrar -account admin
# PATCH each source {"boilerplate": {}} (defaults), wait until boilerplate.pending is false, repeat the eval
```

The chunk statistics come from SQL over `chunks` (count, `count(DISTINCT content)`, the most repeated contents), and the wrong-removal check from diffing each page's paragraphs before and after.
