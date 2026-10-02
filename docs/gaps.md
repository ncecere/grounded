# The gap report: unanswered questions

The gap report shows a team what its agents fail to answer, grouped into topics, so it knows what to add: "14 questions about parking permits got no answer this month" means the parking page belongs in a knowledge base. The design is [`v0.4.0.md`](v0.4.0.md) §2; the privacy rules are [ADR-0010](adr/0010-conversation-privacy-and-retention.md) as amended for v0.4.0.

## Who sees what

| Who | Sees |
|---|---|
| A team's **editors, admins and owners** | The team's **Gaps** page (sidebar, beside Evaluations), and **Agent → Analytics → Gaps**: topics with their label, counts, the reasons answers failed and an 8-week trend. The text of a question only when the person who asked it shared it. |
| **Members** | Nothing (the page answers 404). |
| **Platform admins and auditors** | **Admin → Analytics → Top agents & teams → Failed questions**: failed questions per team and reason, following the page's range, Team and Audience filters. Never a team's topics, questions or dismissal reasons, including in the audit log. |
| The person who asked | Their own conversation, as always. They choose whether to share a question. |

Nobody sees who asked. A topic shows only once **at least 3 different people** asked about it, so its label can't point at one person. An anonymous public or widget session counts as one person.

## What counts as a failed question

An answer in a stored conversation (the web chat, the public page, the widget, and personal API keys' conversations) fails when:

| Signal | Shown as | Meaning |
|---|---|---|
| `no_context` | Nothing found | The search found no passage. |
| `refused` | Refused | A strictly grounded agent gave its refusal message. |
| `judged_out` | No relevant passage | SystemOne passage judging dropped every passage. |
| `out_of_scope` | Out of scope | The SystemOne scope check found the question outside the agent's subject. |
| `unsupported` | Unsupported claims | SystemOne citation checks found a claim its source doesn't support. |
| `uncited` | Uncited claims | SystemOne citation checks found a factual sentence without a citation. |
| `thumbs_down` | Thumbs-down | The person rated the answer down (with its reason). |

Errors (an unavailable model, a stopped answer), moderation notices and small talk aren't failures. Draft test chats (**Try it**), evaluation runs and stateless callers (service keys, the OpenAI-compatible endpoint, MCP) keep nothing: their questions have no conversation to belong to.

The question is kept apart from the transcript, with the vector the search already computed (no extra model call), the signals and a pseudonymous asker key (the same one analytics uses). A question without a vector (a thumbs-down, or an agent that searches with a tool) is embedded by the topics job.

## Sharing a question

The thumbs-down menu has **Share this question with the team**, off by default. Tick it, then choose what was wrong. A shared question shows in full on its topic's page, and editors can add it to an evaluation set. Unticking it on an answer already rated down saves at once and takes the question back, as does rating the answer up.

A shared question is for the team, not platform staff: adding it to an evaluation set records `evaluation.question_create` with `fromSharedQuestion` (its ID), and no evaluation question's audit entry carries its text, phrases or note.

## Topics

A worker job (`gaps.topics`) runs every hour and once at start:

1. It embeds questions that have no vector yet, in the agent's embedding profile (the lowest profile ID among the published version's knowledge bases), metered to the team as `embed_tokens` with usage source `gaps`.
2. It puts each new question in the topic of its nearest question when their cosine similarity is at least 0.72, or in the topic whose centroid is nearest when that is at least 0.8 (the closer of the two), or starts a new topic. Topics keep their IDs: a topic grows as questions join it, and its centroid follows its questions.
3. It merges topics whose centroids are within 0.8 of each other, closest first: the older keeps its ID, label (until it is labelled again), state and history, and takes the newer one's questions and history. A topic dismissed as not for the agent passes that on to the merged topic; otherwise a closed topic reopens when the merged questions include a failure newer than its closing.
4. It labels topics that reached 3 askers (and merged topics again) with the agent's chat model: a 2-5 word label written from that topic's questions alone (no instructions, sources or other topics), metered to the team as chat tokens with usage source `gaps`. A topic is labelled again once it has doubled. Labels wait while the team's budget is used up.
5. It resolves open topics whose questions are answered well again (two good answers near the topic since its last failure: with citations and no failure signal; noted for agents that search before answering, whose search vector is at hand), reopens topics dismissed for now, fixed or resolved when a newer failure joins them (never those dismissed as not for the agent), and deletes topics whose questions are all gone.

**Confirm similar questions with SystemOne** (Gaps → **Settings**, editors, admins and owners; off by default; needs a SystemOne model): the job also asks SystemOne whether borderline pairs are about the same subject, a new question and its nearest question from 0.65 to 0.72, and two topics from 0.65 to 0.8 (each topic's question nearest its centroid). A "yes" joins or merges them; a "no" for two topics is remembered. The checks are metered to the team (`systemone_tokens` and `systemone_requests`, usage source `gaps`), skipped while its budget is used up, and at most 200 a run. Audited `gap_settings.update`.

Counts are read live, so a conversation its user deletes leaves the counts at once.

## Acting on a topic

On a topic's page (open topics; a closed one offers Reopen):

- **Add a source** (the main action) opens **Data sources** with the topic as a note, and the new source form shows it as a hint that isn't saved (every team member can read a source's description).
- **Mark fixed** closes the topic until new questions about it fail.
- **Dismiss** closes it, with an optional reason: **for now** (it reopens when new questions about it fail) or **not for this agent** (it stays closed; new questions still join it and are counted, "3 more since dismissed", and it never shows as open).
- **Reopen**, on a closed topic, undoes a dismissal of either kind or a fix.
- **Add to evaluations**, on a shared question, adds it to one of the agent's evaluation sets with the documents a good answer comes from (evaluations must be on).

A topic's **History** (its page) lists each dismissal with its kind, reason, who and when, fixes, reopenings (by a person or a new failed question), resolutions and merges. It is never erased when the topic reopens, and only the team's editors, admins and owners see it.

Each action is audited: `gap_topic.add_source`, `gap_topic.fix`, `gap_topic.dismiss`, `gap_topic.reopen` and `gap_topic.add_to_evaluations` (adding also records `evaluation.question_create`, with `fromSharedQuestion`). The entries carry IDs, the states, a dismissal's `kind` and `hasReason`, never a label, a question or a reason: team audit logs are readable by platform staff.

## Retention

A failed question belongs to its conversation: it follows the transcript retention of the agent's classification (signed-in conversations until their users delete them, unless the level sets days; anonymous ones after the level's hours), legal holds keep it, and it is deleted with its conversation ([`operations/retention.md`](operations/retention.md)). Public pages tell visitors that questions the assistant can't answer may be grouped, without their details, to improve it.

## API

| Operation | Who |
|---|---|
| `GET /v1/teams/{team}/gap-topics?agentId=&state=open\|closed\|all` | Editors, admins, owners |
| `GET /v1/teams/{team}/gap-topics/{topicId}` (with shared questions) | Editors, admins, owners |
| `POST …/gap-topics/{topicId}/dismiss` (`kind`: `for_now` or `not_for_agent`, `reason`), `/fix`, `/reopen`, `/add-source`, `/evaluations` | Editors, admins, owners (an active team) |
| `GET`, `PUT /v1/teams/{team}/gap-settings` (`confirmSimilar`; `If-Match`) | Editors, admins, owners |
| `POST /v1/messages/{messageId}/feedback` with `share: true` | The person who asked |
| `GET /v1/admin/analytics/gaps?from=&to=&audience=` | Platform admins and auditors |

Everything else gets 404 (403 on the admin route). Browser sessions only, like evaluations.

## Metrics

`grounded_gap_questions_total{signal}` counts questions kept, by signal; `grounded_gap_topic_changes_total{kind}` counts the topics job's work (`embedded`, `assigned`, `new_topic`, `merged`, `confirmed`, `reopened`, `resolved`, `labelled`, `pruned`). The job also appears in the River job metrics as `gaps.topics`.
