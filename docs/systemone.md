# SystemOne models: spec

Status: spec, 2026-09-26. Decision record: [ADR-0020](adr/0020-systemone-models.md). This builds on ADR-0019, the Phase 3 chat pipeline, the Phase 4 moderation work, and the analytics.

## 1. SystemOne model and client

- **Catalog.** A model has kind `systemone`, an upstream model (e.g. `openjev-latest`, `jev-latest`) and a connection (base URL and key). Its classification ceiling works like any other model's. It needs no dimensions or context window.
- **Test model** sends one fixed `noul` question and one `score` question and reports latency and answers.
- **Client** (`internal/systemone`, extracted from `internal/moderation`'s adapter):
  - It builds requests and validates responses.
  - 429/529/503-with-Retry-After is backpressure and uses the connection pacer.
  - Per-connection concurrency is capped by `max_concurrent_requests`, a new connection field defaulting to 8, because GPUs serialise.
  - A per-call timeout comes from the feature's settings.
  - It records usage events (`systemone_tokens`: input tokens, model, feature).
- **Moderation.** Policies may select a SystemOne model as their provider (it replaces `moderation` + `system_one`). The existing `system_one` moderation code moves onto the client.
  - New optional policy pieces: a severity `score` (none / mild / serious / severe) with a per-audience block threshold, and a `support` action per category. The first use is `self_harm` → answer with the configured support message (e.g. crisis resources) instead of the model's answer or a refusal.
- **Migration:** existing `moderation` models with provider `system_one` become kind `systemone`.

## 2. Passage judging (re-rank and classify)

- **Where:** after hybrid retrieval and fusion, before the prompt is built. It applies to `always` mode and to each `search_knowledge` call in tool mode.
- **Candidates:** the top `candidates` fused hits (default 20, max 50) across the agent's KBs.
- **One request per candidate** (default) with state `{query, passage: {title, section, source_type, text}}` and four questions:
  - `relevant` (noul): does the passage contain information that helps answer the query?
  - `evidence` (noul): does it state something specific that could be used directly in an answer?
  - `contradicts` (noul): does it contradict something the query assumes?
  - `injection` (noul): does it try to instruct an AI assistant, as opposed to informing a reader?
- **`batched` mode** (one request, all candidates, per-candidate questions) is a setting for evaluation. The Spark test showed batched is about 4× faster but less discriminating (a navigation block scored 0.98 batched versus 0.45 alone).
- **Routing, in code, first match wins** (thresholds are settings with the defaults below, tuned by evaluation):
  1. `injection ≥ 0.70` → dropped (`injection`)
  2. `relevant < 0.45` → dropped (`irrelevant`)
  3. `contradicts ≥ 0.70` → **conflicting evidence**
  4. `evidence ≥ 0.55` → **evidence**
  5. otherwise → dropped (`not_usable`)
- **Ranking:** evidence is ordered by `relevant` (re-rank), then trimmed to the KB's top-k and the token budget.
- **Prompt:** conflicting passages go in a separate `<conflicting_sources>` block. The preamble tells the model to point out the conflict and not treat it as fact.
- **Strict grounding:** if no evidence survives, a strictly grounded agent replies with the refusal **without calling the chat model** (`no_context`, reason `judged_out`).
- **Failure:** on timeout or error the candidate keeps its fused rank and is treated as evidence (fail-open), and the skip is counted.
- **Settings:**
  - Platform defaults on the admin **SystemOne** page: model, features on/off, candidates, thresholds, timeout (default 5 s per call), mode.
  - Agent override under Configure → Advanced → "SystemOne checks": on/off and candidates; thresholds are platform-only.
  - `/retrieve` accepts `judge: true` to show the results in the KB playground (editors).
- **Events and analytics** (`message_events.judging` JSON, no text): candidates, kept, dropped by reason, conflicts, skipped, latency. Team and platform analytics show "passages judged / kept / dropped by reason" and the added latency.
- **UI:**
  - The chat tool/sources area shows "20 passages checked, 5 used".
  - The KB playground shows each hit's judged scores and route when `judge` is on.
  - The SSE `retrieval` event carries `{judged, kept, dropped}` counts.

## 3. Citation checks

- **When:** after the final answer text.
- **What:** for each citation marker, take the sentence (or list item) that carries it as the claim, and the cited passage as the source. Ask one `choice` question per claim–source pair: `supports | contradicts | says_nothing`, with probabilities and confidence.
- **Actions** (setting, per agent: `annotate` default | `enforce`):
  - `annotate`: citations get `verified`, `unsupported` or `contradicted` plus confidence. The UI shows a check mark on verified citations and a warning on the others.
  - `enforce`: unsupported or contradicted markers are removed. If none of an answer's claims are supported, a strict agent replaces the answer with the refusal.
  - Low-confidence verdicts (below the auto-accept threshold, default 0.8) are marked for review in analytics only.
- **Timing:** in streaming modes it runs after the stream ends and sends an SSE `citations_checked` event that updates the UI. In `buffer` mode (public) it runs before the answer is released.
- **Analytics:** citation support rate, and contradicted and unsupported counts per agent.

## 4. Scope check

- **Before retrieval,** one request with state `{message, agent: {name, description, subject}}`:
  - `small_talk` (noul)
  - `in_scope` (noul): is this within the agent's subject, from its name, description and instructions summary?
- **Routing:**
  - small talk → answer with a short greeting from the chat model **without retrieval**
  - out of scope with a strict agent → refusal **without retrieval or a chat-model call**
- **Setting:** off by default, per agent.

## 5. Evaluation (required before defaults change)

- **Harness:** `cmd/ragbench judge` (FiQA) and `cmd/ragbench urlset -judge` (a URL-judged registrar set) compare four setups on the same candidates:
  - fused retrieval
  - fused plus re-rank by `relevant`
  - fused plus full routing
  - batched versus per-passage
- **Metrics:** nDCG@10, recall@10, MRR, and share of queries whose relevant passage was wrongly dropped. Latency p50/p95 per query and SystemOne requests per query.
- **Moderation comparison:** a labelled set of about 60 messages (benign, borderline, harmful across categories, jailbreaks), run on the SystemOne model and the `gpt-oss-20b` chat classifier. Report accuracy per category, false positives on benign questions, and latency.
- **Citation checks:** a small set of answers with planted unsupported, contradicted and fabricated citations, in the style of the TypeSafe citation cookbook, built from registrar pages.
- **Results** go in `docs/benchmarks/systemone.md`.

## 6. Tests

- **Unit:** client (request shape, validation, backpressure, concurrency cap, timeout), routing table, batched request building, claim extraction for citations, settings merge.
- **Integration:**
  - The fake proxy gains a deterministic `/v1/systemone`, driven by markers in the text.
  - Tests cover judging in always and tool modes, drop reasons, conflicting block, refusal without a model call, fail-open on timeout, analytics counts with no text, and moderation with a SystemOne model including `support` and severity.
  - Citation annotate/enforce and scope check come with those features.
- **UI:** the admin SystemOne page, the agent override, playground scores, the chat "checked/used" line and citation badges, all with axe.

## 7. Status (as built, 2026-09-26)

Everything in §1-§6 is built; results are in [`benchmarks/systemone.md`](benchmarks/systemone.md). Citation checks and the scope check are described below the judging notes ("Citation checks as built", "Scope check as built").

- **Defaults changed by the evaluation:** 10 candidates (not 20) and an evidence threshold of 0.30 (not 0.55); per-passage mode; judging off by default.
- **Citation and scope defaults** ([benchmarks §7-§9](benchmarks/systemone.md#7-citation-checks)): citation checks off, annotate, auto-accept 0.8 (every verdict at or above it was right; no supported claim was confidently rejected), 20 s per answer; scope check off, small talk ≥ 0.5, out of scope below 0.2 (the scores are bimodal; 0.2 keeps a question about the assistant itself from being refused), 5 s.
- **Client** (`internal/systemone`): `Client.Ask(ctx, Call{Feature, Timeout}, state, questions)` validates every answer against its question (type, range, known option or level). The concurrency cap is per connection and per process. The timeout starts once a slot is free; SystemOne clients always get a connection limiter, so a 429, 529 or 503 with Retry-After pauses the connection even without `requestsPerMinute`. Usage is added to a `Meter` carried in the context; the chat pipeline and `/retrieve` write it as `systemone_tokens` usage events (metadata `feature`: `judging`, `moderation`).
- **Settings:** one row (`systemone_settings`: the model and a JSON document with a section per feature). Later features add a section next to `judging`; the agent override (`config.systemOne`) is omitted from the stored config when unset, so existing agents are unchanged.
- **Judging:**
  - The candidates are the top fused hits after each KB is searched with `max(topK, candidates)`. Evidence and conflicting passages are ranked by `relevant`; skipped ones keep their fused position. Evidence is trimmed to the usual result count (sum of top-k, or the tool's `maxResults`) and the token budget; up to 3 conflicting passages follow in `<conflicting_sources>`, numbered like other sources.
  - A strict agent refuses without a model call when neither evidence nor conflicting passages survive (conflicting passages count as evidence here: they are what lets the model push back on a false premise).
  - The whole step is bounded at twice the per-request timeout; requests still waiting for a slot are skipped (fail-open).
  - The conflicting-sources rule is added to the preamble only when judging runs, so prompts without SystemOne are byte-for-byte unchanged.
- **Moderation:** the severity score blocks at or above `severityBlock` at any moderated stage, whatever the category, and is recorded (`severity`, `severityBlocked`) in the content-free record. `support` outranks `block` and is allowed for `self_harm` only; its code on stored messages is `moderation_support`. Agents can lower the severity threshold and turn a block into support, never the reverse.
- **Without a SystemOne model** nothing changes: no requests, no `judging` records, no new SSE fields, no preamble change (`TestWithoutSystemOneNothingChanges`).

### Citation checks as built (§3)

- **Settings:** a `citations` section next to `judging` (`enabled`, `mode` annotate | enforce, `autoAccept` 0.8, `timeoutMs` 20000) and, per agent, `systemOne.citations` ("" | on | off) and `systemOne.citationMode` ("" | annotate | enforce). Settings saved before the feature decode to its defaults (off); a `PUT` without `citations` or `scope` keeps the saved sections.
- **Claims** (`internal/agents/claims.go`): a claim is a *factual sentence* of the answer (the rule is under "Uncited factual sentences" below; v0.2.1 applies it to cited sentences too, so a cited heading, question, greeting or "the sources don't mention…" sentence is not checked and its markers stay unchecked). The claim of a `[n]` marker is the sentence that carries it. Markers right after the sentence's punctuation (`…$10.[1]`) and markers standing alone after it in the same paragraph belong to the sentence before. A list item is its own unit, prefixed with the list's lead-in (a sentence ending in `:` or a short bold line over the list). A table row reads `Header: cell; Header: cell`. Code blocks are skipped. Citation lists are not claims: a sentence that is empty or under three words once its markers and a leading label (`Citations:`, `Sources:`, `References:`, `See:`, …) are removed, a paragraph of markers alone, and the items of a list under such a label or heading are not checked; their markers and citations stay, enforce never removes them, and they don't keep a strict answer from being refused. Sentences end at `.`, `!` or `?` followed by any Unicode space (models write U+202F), not at decimals, abbreviations or before a lowercase word. Markdown is stripped from the claim.
- **Requests:** one `choice` question (`relation`: supports | contradicts | says_nothing, the cookbook's wording) per distinct claim and cited source, with state `{claim, section}` where the section is the passage's title and text as the model saw it. Identical pairs are asked once; at most 30 pairs per answer. They are sent at once and queue on the connection's cap; the whole check is bounded by `timeoutMs`, and pairs not answered by then are `unchecked` (fail-open; a warning is logged).
- **Verdicts:** supports → `verified`, contradicts → `contradicted`, says_nothing → `unsupported`, with the answer's confidence.
  - **Per marker (v0.2, [owner decision §7.4](v0.2.0.md#7-ux-and-answer-review-before-rc1-2026-09-28)):** each `[n]` marker gets the verdict of its own claim, in `citations[].markers`: one `{verification, confidence}` per `[n]` of that source in the answer text, in order of appearance (the stored text has one number per marker). A source cited by a supported and an unsupported sentence is verified on the first marker and unsupported on the second. Markers outside a checked claim (a citation list, a claim under three words, pairs beyond the 30 asked) are `unchecked`. The chat's chips, their hover cards and their accessible names use the marker's verdict; a group `[1][2]` shows the worse of its two. The OpenAI-compatible endpoint returns the same `citations[].markers`. Answers checked before v0.2 have no `markers` and show the source's verdict.
  - **Per claim (v0.2.1, [I9](v0.2.1.md#i9-per-claim-verification), `claimverdicts.go`):** each factual sentence of the final answer is one claim with one verdict:
    - `supported`: at least one source it cites supports it; `sources` lists which, and the confidence is the most confident supporting verdict;
    - `not_supported`: it cites sources and every one says nothing or contradicts it (confidence: the least confident of those verdicts);
    - `uncited`: it cites nothing;
    - `unchecked`: nothing supports it and at least one of its pairs wasn't answered (error, timeout, beyond the 30 pairs).

    A sentence citing `[1][2]` is supported when either supports it. Each claim keeps its per-source outcomes in `checks` (`{n, occurrence, verification, confidence}`), where `occurrence` says which `[n]` of that source in the text it is (0 for the first), so a chip finds its claim. In enforce mode a claim whose markers were removed stays `not_supported` (its checks have no `occurrence`) rather than reading as uncited. A claim is `{index, start, end, text, verdict, sources, confidence?, checks?}`, with code point offsets into the answer text.
    - **Stored** without text, in the answer's citation check record (`message_events.citations.claimList`, with `supportedClaims`, `notSupportedClaims`, `uncitedClaims`, `uncheckedClaims`); a stored message reads its claims back and takes each claim's `text` from its own text. No migration. When analytics retention deletes the record, the message shows as a v0.2.0 answer (per-marker verdicts, no Uncited marks), as it already did for uncited marks.
    - **API:** `claims[]` on `ChatAnswer`, `message_end` (buffered and JSON answers), `citations_checked`, `ConversationMessage`, evaluation results and the OpenAI-compatible response (next to `citations`, also in a stream's final chunk). Not set when citations weren't checked, for refusals, or for answers checked before v0.2.1.
    - **Chat:** a chip shows its claim's verdict (a check when supported, a warning when not supported, red when its own source contradicts the claim; no mark when unchecked or outside a claim), and its card and accessible name say how, the claim's verdict first ("Claim supported by source 1. This source doesn't support it", "Claim not supported. This source contradicts it (92% confidence)"; a supporting verdict under 50% reads "Claim supported by this source, with low confidence (43%)"); the card shows the claim ("Claim: …", the card's description for screen readers) above the passage, and "Show source n below", which opens the sources and focuses that one's card, scrolled clear of the composer. The card opens on hover, click, Enter or Space; focus moves into it and Escape returns it to the chip (v0.2.1). Sources are shown numbered 1..n in the order of their numbers (a model citing sources 1, 4 and 5 of those it was given shows 1, 2 and 3); the stored numbers don't change. With claims, a source card under the answer says how many of the claims citing it it supports ("Supports 2 of 3 claims that cite it") rather than one verdict for the source, which a chip whose claim another source supports would seem to contradict. A group `[1][2]` shows the worse of its two. The answer has a one-line summary above its sources, "9 of 10 claims supported · 1 uncited" (and "· 1 not checked"): supported claims over supported, not supported and uncited ones; unchecked claims are left out. The "Uncited" marks come from the claims. Answers without sources show neither (their note already says so). **Messages checked by v0.2.0** have no claims and display as before: per-marker verdicts and Uncited marks, no summary.
  - **Per source:** a citation (a source number) still gets the worst verdict of the claims that cite it (contradicted, then unsupported, then verified; confidence of the most confident negative or the least confident verification), or `unchecked`, in `citations[].verification`. The source cards under an answer checked before v0.2.1 show it.
- **Uncited factual sentences** count as unsupported. A *factual sentence* is a sentence of the answer's body (a list item and a table data row count as one) that has at least three words and a letter, and isn't:
  - a heading, a short bold line standing in for one (`**How to order**`), a list's lead-in ending with `:`, or code;
  - a question (to the user);
  - a greeting, pleasantry or closing ("Hi", "Thanks", "Hope this helps", "Let me know if…", "If you have other questions…");
  - a sentence saying what the sources don't cover ("The sources don't mention the fee", "isn't covered in the documents", "I couldn't find…", "I don't have…"), which includes the refusal;
  - a hedged suggestion to ask someone, which usually follows such a sentence ("If you need it urgently, you may need to contact the office directly", "Consider calling the help desk"; v0.2.1). One that names a number or an address ("You may need to call 555-0100") is still a claim;
  - uncited, a term in a bulleted list: an item of at most four words, with no digit and no full stop at the end ("Recipient (yourself)", "Purpose (e.g., certification)" under "where you confirm:"; v0.2.1). It belongs to the sentence introducing the list, so every such item is treated alike: none is marked "Uncited", and one that cites a source is checked as its marker asks. Numbered steps, longer items and items with a number ("$10 per copy") are sentences.

  It is *uncited* when no marker sits in it or stands alone right after it in the same paragraph (`claims.go`, `verdicts.go`). Answers of agents whose citation mode is `none`, refusals, small-talk replies, stopped and failed answers are not checked. An answer without any citation is checked too (no SystemOne request is needed): every factual sentence in it is uncited.
  - **Chat:** `citations_checked`, `message_end` of a buffered or JSON answer, `ChatAnswer` and a stored `ConversationMessage` carry `uncited: [{start, end}]` (code point offsets in the text). The chat shows a small "Uncited" mark after each such sentence, with "no source is cited for this sentence" for screen readers; only when citation checks ran, and not for answers without sources (they already say so). A stored message's uncited sentences are found again in its text when it has a citation check record.
  - **Records and scores:** `message_events.citations.uncited` counts them as the model wrote the answer (before enforce's removals, which are counted as unsupported pairs). An evaluation's share of supported claims is, since v0.2.1, supported claims / (supported + not supported + uncited claims), the numbers the chat's summary shows (`supportedShare`, with `supportedClaims`, `claimsScored` and `uncited` on the answer's scores); unchecked claims are left out. v0.2.0 divided verified pairs by checked pairs plus uncited sentences, so a sentence citing two sources counted twice; results recorded then keep their score.
- **annotate:** only `verification` and `confidence` on the citations change. **enforce:** markers whose pair is unsupported or contradicted *at or above auto-accept* are removed (their leading space moves to a following marker); citations left without markers are dropped. If that removes every marker and nothing was verified, a strictly grounded agent answers with its refusal instead (`refused`, and `citations.refused` in the record). Low-confidence verdicts are never acted on; they are counted (`lowConfidence`) for review.
- **Timing:** checked only for complete answers (not refusals, small talk, errors, stopped or moderated answers, nor agents whose citation mode is `none`); an answer without citations only has its uncited sentences counted.
  - Streamed answers: `message_end` goes out first, then the check runs (it outlives a client that left), the answer is stored with the verdicts, and `citations_checked` `{messageId, text, citations, refused, verified, unsupported, unchecked}` follows; the UI replaces the citations (and text) in place and shows "Checking the citations…" in between. The answer's latency in analytics stops at `message_end`.
  - Buffered (output moderation `buffer`) and JSON answers: checked before release; `message_end` / the response carry the result, and enforce's text is what is released.
  - OpenAI-compatible endpoint: streamed answers are annotated only, in the final chunk's `citations` (held until the check ends); non-streamed answers follow the mode.
- **Records:** `message_events.citations` `{mode, claims, pairs, checked, verified, unsupported, contradicted, unchecked, lowConfidence, removed, refused, uncited, requests, latencyMs, supportedClaims, notSupportedClaims, uncitedClaims, uncheckedClaims, claimList}`, never text (`claimList` holds offsets and verdicts only); `systemone_tokens` usage with feature `citations`. `claims` counts the cited claims as the model wrote the answer; `pairs` … `lowConfidence` count claim–source pairs; the `…Claims` counts and `claimList` describe the final answer's claims (v0.2.1). Team (agent) and platform analytics show, over answers with at least one pair: answers checked, the support rate (verified / checked pairs), unsupported and contradicted pair counts, low-confidence count, removals, refusals and check time; the platform's top agents have a "Cited" (support rate) column. These stay per pair: they measure how often a cited source backs what it's cited for, while the chat summary and evaluation scores measure how much of an answer is backed.
- **UI:** bitop-ui's `InlineCitation` gained `verification` / `verificationLabel` (branch `ragd-s1-citations` of bitop-ui): a small check on verified chips, a warning on unsupported (amber) and contradicted (red) ones. The explanation with the confidence ("Not supported by this source (54% confidence)") is part of the chip's accessible name and heads its card, which serves as the icon's tooltip; the source cards below an answer checked before v0.2.1 repeat it. Unchecked citations have no mark.

### Scope check as built (§4)

- **Settings:** a `scope` section (`enabled`, `smallTalk` 0.5, `inScope` 0.2, `timeoutMs` 5000) and `systemOne.scope` ("" | on | off) per agent.
- **Request:** one request with state `{message, previous_message?, agent: {name, description, subject}}`, where `subject` is the agent's instructions with whitespace collapsed, cut at about 1,200 characters. `previous_message` (the user's previous message in a conversation) is a deviation from the spec: without it a follow-up like "and the fee?" could look out of scope. Questions: `small_talk` ("only small talk … with no question or request for information") and `in_scope`.
- **Routing, in code:** `small_talk ≥ smallTalk` → small talk (it wins over scope: a greeting is outside every agent's subject); else `in_scope < inScope` → out of scope; else in scope. On error or timeout the decision is `skipped` and the message is answered normally.
  - Small talk: one chat-model call with a short small-talk prompt (agent name, provider, description; "reply briefly, offer to help, no facts or citations"), the conversation history and the message; no tools, no retrieval, no sources block, at most 1,024 output tokens. `message_end.noContextReason` is `small_talk`; the UI adds no "no sources" warning.
  - Out of scope with a strictly grounded agent: "This is outside what <agent> covers." (not the refusal message, which says the sources had nothing, since nothing was searched), with no retrieval and no chat-model call (`noContextReason` `out_of_scope`). The chat offers the agent's starter questions under it, as it does under a refusal after a search ("The agent searched its sources and found nothing that answers this."). Not strict: answered normally.
- **Concurrency:** the check starts with input moderation and runs alongside it and the query rewrite; moderation's block wins.
- **Records:** `message_events.scope` `{decision, action (reply | refused | none), smallTalk, inScope, latencyMs}` (scores, never the message); usage feature `scope`; analytics show messages checked, small talk, out of scope, refusals and check time.
