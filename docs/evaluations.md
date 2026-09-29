# Evaluations (A2, v0.2)

Status: **agreed** (owner, 2026-09-28), for M5 of [`v0.2.0.md`](v0.2.0.md) §3.1. The owner's decisions are in §9.

Evaluations let a team check that its knowledge bases and agents still find the right documents, and later still answer well, after sources, settings or models change. **On by default** for editors and above (owner decision 1 in `v0.2.0.md`); members and people chatting never see it; a platform setting turns it off entirely.

## 1. Sets and questions

- **A set** belongs to one knowledge base or one agent, and has a name and a description. A KB's set tests that KB's retrieval; an agent's set tests the agent's retrieval across its KBs with its own settings (results per search, filters), and can test its answers (§3).
- **A question** has the question text and what a good result is:
  - **Expected documents**, any of: a document picked from the KB, a URL or URL prefix (`https://example.edu/registrar/transcripts*`), or a filename. A hit matches if it's any expected document.
  - **Must mention** (optional): phrases a good *answer* must contain (full-answer checks only, so only an agent's sets ask for them), case-insensitive.
  - A note for the team (optional).
- **Warnings, not errors** (v0.2 review, M6): the form checks what it's given against the knowledge bases (`POST /v1/teams/{team}/evaluation-question-check`) and warns about an expected document nothing matches yet ("No document in Student help matches this yet; it'll count once one is added") and a must-mention phrase whose words appear in no passage ("the answer can't contain it from the sources"). An import's preview lists such rows as warnings. Neither blocks saving.
- **Adding questions:**
  - Type one in (a short form).
  - **Import** a CSV (`question,expected,must_mention`, with `|` between several values) or ragbench's URL-judged JSONL (`{"id","question","urls":[...]}`), so the lab benchmarks and the product use one format. Import shows a preview with the rows it can't use, then adds the rest. **Export** writes the same CSV.
  - **"Add to evaluations"** in the editor's own conversations with the team's agents: on a thumbs-down answer or an answer with no sources. It opens the question form prefilled with the question text and the documents the answer cited as expected documents ("The answer used X. Is that the right source?"); after a Not helpful or Incorrect rating it asks first "What should a good answer say?" (must mention). Nothing else from the conversation is copied (ADR-0010). The button then reads "Added to evaluations".
  - From the agent editor's **Test** panel: "Add to evaluations" on any test question.
- Limits: 500 questions per set, 50 sets per team (new limit keys, adjustable).

## 2. Retrieval check (the default run)

No model calls except embedding the question, so it's fast and nearly free.
- For each question, run the same retrieval the KB or agent uses (`kbs.Retrieve`, with the agent's settings for an agent set), with k = the KB's or agent's results per search.
- Per question: **pass** if an expected document is in the top k, its **rank**, and the top results that came back (titles, links and the start of each passage, for the editor to see why). Each expected document is recorded as in the knowledge base, **not in it** (nothing ever matched: a typo or a document not added yet) or **deleted since** (a picked document, or one an earlier run found); when none is in the top k, a second search of 50 results records its rank beyond k ("found at #11"), without changing the pass or fail.
- Per run: **recall@k** (share of questions passing), **MRR**, and the count of questions none of whose expected documents is in the knowledge base (reported separately, not as failures, split into "not in this knowledge base" and "deleted"). Such a question still runs its search, so what came back is shown.
- Runs count against the team's query limits and appear as `query` usage (tagged as evaluation) so costs see them; they're refused like any query when a budget is used up.

## 3. Full-answer check

- Asks the agent each question the way a chat would, from its **published** version or its **draft** (the run form picks; draft by default in the editor), without writing a conversation (the Build tab's Try it panel's mode).
- Scores per question: did the answer **cite** an expected document; does it **mention** each must-mention phrase; did it **refuse** ("I don't know") when it shouldn't; and, when SystemOne citation checks are on for the agent, the share of **supported claims**: a claim is one factual sentence of the answer with one verdict (supported when any source it cites supports it, not supported, or uncited), and the share is supported claims over all claims, uncited ones counting as not supported and claims whose check failed left out ([`systemone.md` §3](systemone.md#citation-checks-as-built-3)). These are the claims the chat's summary counts ("2 of 3 claims supported · 1 uncited"), so a result page and the same answer in chat agree (v0.2.1; v0.2.0 counted claim–source pairs, and results recorded then keep their score).
- A question passes when it cites an expected document and mentions every phrase. A pass of a question with no phrases says so, "Cited the right source (content not checked)", and the run counts those passes apart (`citedOnly`). The answer text is stored with the result so editors can read it (it's the team's own test output, not a user conversation), with its citations one per marker number (`[1]`, `[2]`…) and the cited passage, so the result page shows the answer formatted as in chat, with citation chips that match its markers. It uses chat's renderer: with citation checks each chip shows its claim's verdict, its card the claim, and the answer the claims summary; the result keeps the claims (`claims[]`, verdicts and offsets, the text read from the stored answer).
- Tokens are metered as chat usage tagged as evaluation, priced by E2, refused when a budget is used up. The run form says how many answers it asks for ("40 answers") and, when the team's budget is enforced, that they count against it.

## 4. Runs, results and trends

- **Run** (a button on the set): pick the kind; a run is a River job that goes through the questions with small concurrency (default 2) under the team's limits. Progress is live; a run can be cancelled.
- **Results:** a table of questions (pass or fail, rank, what came back, and for full runs the answer, citations and scores), filterable to failures, with each question opening a record page that puts **Expected** beside **What came back**.
- **Score:** one headline score per run for every set, recall@k for retrieval runs and the pass rate for full-answer runs, with the metric named in its tooltip.
- **Score over time:** a compact chart, from three completed runs of a kind, of recall@k (and the full-answer pass rate) across runs, with markers for what changed between them (agent version, embedding profile, results per search), from each run's configuration snapshot.
- **Compare two runs:** questions that got better, got worse, or stayed the same.
- **Automatic runs** (opt-in per set; retrieval checks only): after the agent is **published** (its sets), after an embedding **profile migration** is switched (the KB's sets), and **nightly** when the KB's documents changed that day. A drop of more than 5 points in recall@k, or any question that newly fails, notifies the team's editors (a new notification kind, can be turned off). Full-answer runs are always started by hand.

## 5. Where it lives

- A knowledge base and an agent each get an **Evaluations** tab (icon `ClipboardCheck`), for editors and above, listing sets; a set opens as its own page with tabs **Questions**, **Runs** and **Settings**; a run opens as a record page.
- The team's **Evaluations** page (`/teams/{team}/evaluations`, v0.2.1 I3) lists all its sets with their target, latest score, trend against the run before and last run, with a Regressions filter; the team sidebar has an **Evaluations** item for editors and above, and the team Overview shows the scores ("Quality & spend"). A set's breadcrumb is Team › … › Set, where "…" is a menu of the hidden crumbs (its knowledge base or agent and that page's Evaluations tab). The score chart has a fixed 0–100% scale.
- Admin → **Evaluations** setting (on/off) on an existing settings page; while off, the tabs and API are gone (404).
- ⌘K finds sets by name for their team's editors.

## 6. API (OpenAPI first)

Under `/v1/teams/{team}/evaluation-sets`: list (optionally one knowledge base's or agent's; each set carries `lastRun` and, since v0.2.1, `previousRun`, the completed run of the same kind before it, for the trend) and create (with `kbId` or `agentId`), get, update, delete; `/{setId}/questions` CRUD and `/{setId}/questions/import` (dry run and commit) and `/{setId}/questions.csv`; `/{setId}/runs` list and start, `/{setId}/runs/{runId}` get (with results) and cancel, `/{setId}/runs/compare?a&b`; `/{setId}/documents?q` finds the documents a set's questions can expect (the picker), and `/v1/teams/{team}/evaluation-documents?kbId|agentId&q` does the same for a knowledge base or agent before its first set exists ("Add to evaluations" into a new set); `POST /v1/teams/{team}/evaluation-question-check` (setId, kbId or agentId) says which expected documents and must-mention phrases the knowledge bases hold, for the form's warnings. Editors and above of the team; members get 404. Every operation in the authorization matrix. Audited: set and question changes, imports, runs started and cancelled.

## 7. Data

Migration (next number at merge): `eval_sets` (team, kb or agent, name, description, schedule, revision), `eval_cases` (set, question, expected jsonb: documents, URL patterns, filenames; must_mention text[]; note), `eval_runs` (set, kind, trigger, status, started_by, config snapshot jsonb, summary jsonb: recall, MRR, pass rate, counts), `eval_results` (run, case, pass, rank, hits jsonb, answer text and scores for full runs; `scores` also holds each expected document's state and rank and why a question wasn't scored, for every run). A retention kind `evaluation_runs` (default 180 days). Deleting a KB or agent deletes its sets.

## 8. Tests and gates

Metric maths (unit); matching by document, URL prefix and filename (unit); CSV and JSONL import with bad rows (unit); a retrieval run against a seeded KB and a full-answer run against the fake gateway (integration); limits, budget refusal, retention, authorization matrix; web tests with axe for every screen; an E2E flow: create a set from the editor, import a CSV, run a retrieval check, see a failure, fix the KB, run again, compare.

## 9. Owner decisions (2026-09-28)

1. ~~The full-answer check?~~ **In v0.2** (owner, 2026-09-28), with retrieval checks as the default run.
2. ~~Whose conversations?~~ **The editor's own conversations and the Test panel only** (owner, 2026-09-28). ADR-0010 is unchanged; sharing questions on a thumbs-down can be proposed later with an ADR update.
3. ~~Automatic runs?~~ **Opt-in per set, retrieval checks only** (owner, 2026-09-28): after an agent is published, after a profile migration is switched, and nightly when the KB's documents changed that day. Full-answer runs stay manual.
