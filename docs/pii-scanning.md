# Personal data scanning at ingest

Grounded looks for possible personal data in every document it indexes and asks the team to review what it finds (B7, #37;
decision in [v0.9.0](v0.9.0.md#pii-scanning-at-ingest)). It is **on by default** and only flags: a document with findings is
still indexed. A platform admin can choose classification levels whose documents with findings are **held**, kept out of
search until an editor approves them.

A finding is the **kind** of data, **how many** matches and **on which pages**. The matched text is never stored, logged,
shown or sent anywhere: not in the document's record, its warnings, the audit log, the content health report or the API.

## What is found

| Kind | How it is recognised |
|---|---|
| US Social Security numbers (`us_ssn`) | `AAA-GG-SSSS` or `AAA GG SSSS`. Numbers that can't be issued are ignored: area 000, 666 or 900-999, group 00, serial 0000, and well-known sample numbers (078-05-1120, 219-09-9999, 123-45-6789). Nine digits without separators are not matched (too many false positives). |
| Payment card numbers (`payment_card`) | 13 to 19 digits (single spaces or dashes between them allowed) whose prefix and length belong to Visa, Mastercard, American Express, Discover, JCB or Diners Club, and that pass the Luhn checksum. Runs of one repeated digit are ignored. |
| Your patterns | Up to 20 named regular expressions a platform admin adds for the institution's own formats, such as student or employee IDs, or another country's national ID. RE2 syntax (linear time: a pattern can't slow ingestion down), at most 500 characters, and it must not match empty text. |

Pattern matching is fast and explainable, and the checks keep false positives down; it is still not proof. A match may not be
personal data (a number that happens to fit) and a document without matches may contain personal data in a form no pattern
describes. Model-based detection may be offered later as an option.

The scan reads the text Grounded extracted, including OCR text, line by line (each line capped at 64 KiB). Counts stop at
10,000 and at most 100 pages are listed per kind.

## What happens to a document

| State | Indexed? | What the team sees | What an editor does |
|---|---|---|---|
| **Flagged** | Yes | A **Needs review** badge, a warning ("May contain personal data: 2 possible US Social Security numbers on pages 2 and 3"), the source in Needs attention, the document in content health | **Dismiss flag** (keep it as it is) or delete it |
| **Held** (its source's classification is one to hold) | No: skipped with the code `pii_review`; a previous version's passages are removed | The same, with "Held for review before indexing" | **Approve and index** (it is queued and indexed) or delete it |
| **Dismissed** / **Approved** | Yes | The review on the document's page | Nothing |

A review lasts while the findings are the same: a new version of the document with the same kinds, counts and pages keeps it;
anything different is reviewed again (and held again if its classification holds). Retrying a held document holds it again,
so the app offers Approve instead of Retry for it.

Editors, admins and owners review their team's documents; platform admins review shared sources' documents. Members see the
findings, not the buttons. Every review is audited (`document.pii_dismiss`, `document.pii_approve`) with the kinds and counts.

## Settings

**Admin → Personal data** (`GET`/`PUT /v1/admin/pii`, If-Match; platform admins change it, auditors read it):

- **Scanning** on or off. Off: nothing is scanned; documents processed while it is off have no findings.
- **Hold for review**: the classification levels whose documents with findings are held.
- **Your patterns**: name and expression. The audit log (`platform.pii`) records the switch, the levels and the patterns'
  names, not their expressions (an expression can describe an institution's ID format).
- **Waiting for review**: the teams with documents to review, as counts (platform admins can't read a team's documents).

Changes apply to documents processed from then on. Documents already indexed keep their state until they are processed
again (a new version, a re-crawl, or a retry).

## API

- `Document.pii`: `{state, findings: [{kind, count, pages}], reviewedAt}`, or null when nothing was found or scanning was off.
- `DocumentCounts.piiReview`: a source's documents waiting for a review (flagged or held).
- `GET .../documents?review=pii`: only those documents.
- `POST /v1/teams/{team}/sources/{sourceId}/documents/{documentId}/pii-review` with `{"action": "dismiss" | "approve"}`, and
  the same under `/v1/admin/shared-sources/...`. 409 `not_reviewable` when the document isn't waiting for that review.
- The content health report's `personal_data` signal: the documents waiting for a review, held first, with the kinds found
  (`detail`) and the number of matches (`value`).

## Storage and compatibility

Findings live in `documents.metadata.pii`, next to the OCR record; the settings in the new singleton table `pii_settings`
(migration 00063, which only creates a table and a partial index). The previous release ignores both, so a rolling update or a
rollback is safe. During a rolling update, documents processed by an older worker are not scanned. After a rollback, held
documents stay skipped until they are retried or uploaded again.

## Tests

Unit: the detectors against valid numbers and false positives (invalid SSN areas, groups and serials, sample numbers, phone
numbers, dates, ISBNs, non-Luhn and unknown-network numbers, repeated digits), per-page attribution, bounds, pattern
validation and the findings never holding matched text. Integration: ingestion end to end (flagged and indexed, held and not
searchable, approve, dismiss, a review that lasts while the findings are the same, scanning off), that no match appears in
documents or the audit log, the settings' validation and auditing, the content health signal, and the authorization matrix.
Web: the admin page, the document's review, the filter and the badge, with axe.
