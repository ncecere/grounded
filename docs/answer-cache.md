# Saved answers (the answer cache)

When someone asks an agent a question it answered recently, under the same conditions, Grounded can send the saved answer again instead of running the whole pipeline (query rewrite, search, reranking, SystemOne judging, the chat model, citation checks and buffered moderation). The saved answer arrives in well under a second, costs no model tokens, and has the same citations and claim verdicts as the original. People chatting can't tell the difference: there's no "saved answer" note.

Design: [`v0.4.0.md`](v0.4.0.md) §1 (roadmap A8). Code: `internal/answercache` (storage, settings) and `internal/agents/cache.go` (the chat pipeline).

## Who turns it on

- **Each agent** has its own setting under **Agent → Settings → Saved answers**: on by default for agents published to the **public**, off by default for the others. Team editors, admins and owners change it. It isn't part of versions: a change applies to the next question.
- **Platform admins** can turn saved answers off for every agent under **Admin → Overview → Features → Saved answers** (auditors see the switch read-only). While it's off nothing is reused and nothing is saved, including answers that were being written when it was turned off; saved answers stay until they expire. The same holds for the agent's own setting.

The agent's section also sets:

- **Reuse an answer for**: 1 hour to 30 days (24 hours by default).
- **Also reuse answers to near-identical questions** (off by default; needs a SystemOne model, see below).
- **Clear saved answers**: deletes every saved answer of the agent, so the next questions are answered afresh. Audited as `agent.answer_cache_clear` with the count.

Settings changes are audited as `agent.answer_cache_update`, the platform switch as `platform.answer_cache`.

## When an answer is reused

All of these must hold:

- **The same published version.** Publishing starts afresh. Try it (the draft) and evaluation runs never read or save answers.
- **The same knowledge.** Each knowledge base has a content revision that goes up whenever a document is added, re-processed (an upload, a re-crawl that found a change, a retry, a re-chunk after boilerplate changes), deleted, retitled or retagged, when a source is attached or detached, and when the knowledge base or one of its sources moves to another embedding profile. Database triggers raise it, so every path is covered. The revision of every knowledge base the agent searches is part of the key.
- **The same answering settings:** the moderation policy of the agent's audience, the platform's SystemOne settings and the reranking settings (their revisions), and the agent's own settings (its version).
- **The same audience** the agent is published to.
- **The same question.** By default the match is exact after normalising: case, runs of spaces and trailing punctuation don't matter. With near-identical matching on, a question whose embedding is within cosine similarity 0.92 of a saved one is reused only when SystemOne confirms that both ask for the same information, so "hours on Saturday" never gets the answer about Sunday.
- **The first question of a conversation.** Follow-ups are always answered live and never saved, whatever their wording: no word test can tell reliably whether "How much does that cost?" leans on the conversation, and a follow-up's answer was written with one person's earlier turns. For the OpenAI-compatible API, service keys and MCP `ask`, a question sent with earlier turns (`history`) is a follow-up.
- **The same day, for questions about relative dates.** The agent's instructions tell the model today's date, so a question with words such as *today*, *tomorrow*, *this week*, *open*, *hours* or *deadline* has the date (UTC) in its key.
- **Not expired:** within the agent's time limit, measured with its current setting.

Only the agent's **always** search mode is cached; agents that search with a tool (tool mode) answer every question live.

## What is saved

An answer is saved only when it's clean: it passed moderation, has no error, isn't a refusal or a "nothing found" answer, found sources, called **no MCP tool** (tools return live data and may act for the person), and has nothing the gap report counts as a failure (unsupported, contradicted or uncited claims). So a failed question is never hidden behind a saved answer: the gap report keeps recording it, and the next person gets a live attempt.

Nothing in an answer depends on who asked: the instructions name the agent, its team and the date, never the person; searches use the agent's knowledge bases and filters, not the person's access; and answers that used a tool aren't saved.

## What a saved answer still goes through

- The chat's limits: rate limits, query limits, budgets, concurrent chats. A saved answer counts as a query.
- The access log of Sensitive and Restricted agents.
- The conversation: the question and the answer are stored as usual (the analytics event is marked `cached`).
- The usage ledger: one `query` event with `cached: true` in its metadata, and no model tokens. With near-identical matching, the question's embedding and the SystemOne check (feature `cache`) are metered as usual.
- The same streamed events as a live answer (`conversation`, `retrieval`, `message_start`, the text, `message_end` with the citations and claims, `done`), so the web chat, the widget, the public page, the OpenAI-compatible API and MCP `ask` work unchanged.

## When a saved answer goes away

- Its time limit passes, or the agent's time limit is shortened below its age.
- Anything in its key changes (a new version, a knowledge base change, a settings change).
- **A thumbs-down** on it, or on the answer it was saved from: the next person gets a fresh answer.
- An editor clears the agent's saved answers. (A deleted agent answers nobody; its saved answers expire.)
- **Retention** deletes expired saved answers every 10 minutes, and those past the transcript retention of the agent's classification level (the anonymous retention for public agents, the signed-in conversation retention otherwise), whichever comes first. A legal hold on the team or the agent keeps them (they're never reused once expired). The kind is **Saved answers** (`answer_cache`) in Administration → Retention ([`operations/retention.md`](operations/retention.md)).

## Analytics and metrics

**Agent → Analytics → Usage** shows the share of answers given from saved answers and the model tokens their originals spent (tokens saved). Agent → Settings → Saved answers shows how many saved answers there are and how often they were reused.

Metrics ([`operations/monitoring.md`](operations/monitoring.md)):

- `grounded_answer_cache_lookups_total{result, reason}`: `hit` (`exact`, `near`) and `miss` (`no_entry`, `near_rejected`, `follow_up`, `error`). Agents with saved answers off aren't counted.
- `grounded_answer_cache_tokens_saved_total`: model tokens hits didn't spend.
- `grounded_answer_cache_entries`: saved answers that haven't expired.

The Chat and retrieval dashboard has an Answer cache row. Traces have an `answer_cache.lookup` span with the result and reason.

## API

- `GET`/`PUT /v1/teams/{team}/agents/{agentId}/answer-cache` (editors, admins and owners; `PUT` with If-Match): `enabled` (`null` for the default), `nearIdentical`, `expiryHours`, and read-only `on`, `audience`, `platformEnabled`, `nearIdenticalAvailable`, `entries`, `hits`.
- `POST /v1/teams/{team}/agents/{agentId}/answer-cache/clear`: returns `cleared`.
- `GET`/`PUT /v1/admin/settings/answer-cache` (platform admins write, auditors read).
- `cache` (`hits`, `hitRate`, `tokensSaved`) in agent analytics totals.
