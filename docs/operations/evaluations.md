# Evaluations: test sets for knowledge bases and agents

Evaluation sets let a team check that its knowledge bases and agents still find the right documents, and still answer well, after sources, settings or models change. The design and the owner's decisions are in [`evaluations.md`](../evaluations.md); this page is the how-to for team editors and the settings for platform admins.

## Who sees what

- **Team editors, admins and owners** see an **Evaluations** tab on each knowledge base and agent, and a page per set. Everything is in the app; API keys can't use evaluations.
- **Members, people chatting and platform staff** (admins and auditors outside the team) don't see them: the tabs are hidden and the API answers 404. Break-glass doesn't open them either.
- **Platform admins** turn the feature on or off for the whole platform under **Admin → Limits → Evaluations** (on by default). While it's off, the tabs are hidden, the evaluation API answers 404 for everyone, the palette doesn't find sets and automatic runs don't start. Sets and runs are kept and come back when it's turned on. The switch is audited (`platform.evaluations`).

The setting sits on the Limits page because that page governs what teams may use: the two evaluation limits are on the same tab.

## Building a set

On a knowledge base's or agent's **Evaluations** tab, choose **New set**. A set belongs to that knowledge base or agent, and is deleted with it.

- A knowledge base's set tests its search with its own results per search.
- An agent's set tests the agent's search across its knowledge bases with the agent's settings (results per search, filters, minimum similarity), and can test its answers.

Each **question** says what a good result is:

- **Expected documents:** pick documents from the knowledge base, or enter a URL, a URL prefix ending in `*` (`https://example.edu/registrar/transcripts*`) or a filename. Any one of them counts. URLs are compared without trailing slashes; filenames ignore case.
- **Must mention** (optional): phrases a good *answer* contains. Only full-answer checks use them; case doesn't matter.
- A **note** for the team (optional).

Questions can also be:

- **Imported** (Questions tab → **Import questions**) from a CSV file, `question,expected,must_mention` with an optional `note` column and `|` between several values, or from a URL-judged JSONL file (`{"id","question","urls":[...]}` per line, the format `cmd/sparkbench` reads). The preview lists the rows that can't be used, by line (no expected document, a bad URL, a document that isn't in the knowledge base, a question already in the set); **Add** adds the rest. An import that would pass the questions-per-set limit adds nothing.
- **Exported** as CSV from the set's "…" menu, in the import's format.
- **Added from a chat:** in your own conversations with one of your team's agents, an answer you rated down, or one without sources, has **Add to evaluations**. So does every answer in the agent editor's **Test** panel. Only the question text is copied, never the rest of the conversation ([ADR-0010](../adr/0010-conversation-privacy-and-retention.md)); you add the expected documents.

## Running a set

**Run** on the set's page starts a run; one run of a set at a time.

- **Retrieval check** (the default): for each question, the same retrieval the knowledge base or agent uses, with k = its results per search. A question passes when an expected document comes back in the top k. The run reports **recall@k** (the share of questions that passed) and **MRR** (the mean of 1/rank of the first expected document). No model calls except embedding the questions.
- **Full-answer check** (agent sets): asks the agent each question the way the Build tab's Try it panel does, from the draft (default) or the published version, without writing a conversation. A question passes when the answer cites an expected document and mentions every must-mention phrase. Results also say whether the answer refused, and the share of supported claims when SystemOne citation checks are on for the agent. The run form shows how many answers it asks for; the answers are stored with the results.

Questions whose expected documents no longer exist are reported apart ("3 questions point at documents that were deleted") and don't count as failures; neither do checks that failed (for example, the model was unavailable).

Runs are River jobs (queue `evaluations`) that check `EVALUATION_CONCURRENCY` questions at a time (default 2). They go through the team's normal limits: each question is a query (`queries_per_minute`, `queries_per_day`), and full answers are chats (`chat_tokens_per_day`, concurrent chats, and budgets once they exist). A per-minute limit makes the run wait; a daily limit or a budget stops it, marked failed with the reason. Usage is recorded as ordinary query, embedding and chat usage, tagged `"source": "evaluation"` in its metadata. Progress is live, and **Cancel run** stops a run and keeps its results so far.

## Reading the results

- The **Runs** tab charts recall@k (and the full-answer pass rate) across runs. ◆ marks a run whose agent version, embedding profile or results per search differed from the run before, and the list under the chart says what changed.
- A run opens as a record page: its scores and configuration, the results (filter to **Failures**), and what came back instead of the expected document. **Compare** shows which questions got better, worse or stayed the same against another run of the same kind.
- A question opens as a record page with its results in the latest runs, including the agent's answers.

## Automatic runs

A set's Settings tab has **Run automatically** (off by default). Automatic runs are retrieval checks only:

- after the agent is **published** (its sets test the new published version);
- after a knowledge base's **embedding profile migration** switches, or switches back (its sets);
- **nightly** at 03:00 UTC, for sets whose knowledge bases had documents added, changed or deleted in the last day.

When an automatic run's recall@k is more than 5 points lower than the previous completed retrieval check, or a question that passed now fails, the team's editors, admins and owners get the notification **Evaluation scores dropped** (`evaluation.regression`), which each person can turn off in their notification settings. Full-answer checks are always started by hand.

## Limits, retention and audit

| Setting | Default | Where |
|---|---|---|
| `evaluation_sets` | 50 per team | Admin → Limits → Evaluations, and team overrides |
| `evaluation_questions_per_set` | 500 | the same |
| `EVALUATION_CONCURRENCY` | 2 (1-8) | environment: questions a run checks at once |
| Retention `evaluation_runs` | 180 days (`RETENTION_EVALUATION_RUNS_DAYS`) | Admin → Retention; `keep` keeps them |

Runs and their results older than the retention period are deleted by the retention job; legal holds don't apply to them, as they hold no user content (only questions editors wrote and the agent's test answers). Deleting a question keeps its results in past runs.

Audited in the team's log: sets created, changed and deleted (`evaluation.set_*`), questions added, changed and deleted (`evaluation.question_*`), imports with their counts (`evaluation.questions_import`), and runs started and cancelled (`evaluation.run_start`, `evaluation.run_cancel`; automatic runs with the system as the actor).
