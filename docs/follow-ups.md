# Follow-up suggestions

After an answer with citations, the chat offers up to three follow-up questions under it, as chips. Choosing one asks it, in the same conversation. The questions come from the passages the agent found, so each one leads to another answer from the knowledge base rather than to a chatty prompt.

Design: [`v0.4.1.md`](v0.4.1.md) §1 (roadmap C8). Code: `internal/agents/suggest.go` (the chat pipeline) and `web/src/pages/chat/notes.tsx` (the chips).

## Who sees them

- **Every agent offers them by default**, new and existing (agents saved before v0.4.1 have them on). Editors turn them off per agent under **Build → Advanced → Suggest follow-up questions**. The setting is part of the agent's configuration, so it's published with a version and shows in **Compare versions**.
- **Where they appear:** the signed-in chat, the public page, the widget and **Try it** (they share one chat panel). Only the last answer offers them; the next question removes them.
- **Not on** the OpenAI-compatible endpoint (`/v1/chat/completions`), MCP `ask`, chat requests with `stream: false`, or evaluation runs. None of these can show them, so no call is made.

## When an answer gets them

Only after an answer that:

- has at least one citation,
- isn't a refusal (the agent's starter questions show there instead, "You can ask:", also after a reload), "nothing found", small talk or out of scope,
- wasn't replaced by a moderation notice, and
- finished normally (not stopped, cut off at the length limit or failed).

An answer with none of these problems may still get no suggestions: the model can reply that no follow-up qualifies, the call can fail or time out (10 seconds), or every suggestion can be dropped (see below). Nothing is shown then, and nothing tells the reader that suggestions were expected.

## How they're written

A separate, small call to the agent's chat model, once the answer has ended:

1. **After the answer.** The call starts after `message_end` and, when SystemOne checks the citations, after `citations_checked`. The answer, its citations and its checks are never changed by it, and the reader doesn't wait for it: the chat treats the answer as complete at once (the composer is free, "Answer ready" is announced), and the chips appear a moment later.
2. **What the model reads:** the question, the answer (without citation markers, at most 2,000 characters) and the title and heading path of each passage, cited ones first, at most 12 lines such as `Transcripts › Fees`. Not the passages' text, the conversation, the agent's instructions or the person's details. MCP tools' results and conflicting passages are left out; with no passage line, no call is made.
3. **What it's asked:** up to 3 short questions, in the language of the question, each answered by one listed passage (as its title or headings show) without mixing in topics from other passages, asking for something the answer doesn't already say and never the question already asked; fewer or `NONE` rather than a weak question.
4. **Reasoning effort:** thinking off whenever the chat model can turn it off (**How to turn thinking off** in Admin → Models), whatever the answer's effort; otherwise low. Set **How to turn thinking off** on a reasoning chat model: without it, the model can reason past the call's time limit and no suggestions show. At most 1,024 output tokens, reasoning included.
5. **Reading the reply:** one question per line. List markers, numbering, emphasis, quotes and citation markers are removed. Blank lines, labels ("Follow-up questions:"), `NONE`, lines without letters, lines over 150 characters, duplicates (ignoring case, spacing and the final punctuation) and the question just asked are dropped; so are lines that aren't questions (from v0.4.2: a question ends with a question mark, opens with ¿, or starts with a question word such as how, what, cómo, comment or wie) and lines that only repeat a passage's title or heading. From v0.4.2 (US2-08) the prompt also says to ask nothing the answer already says, even in other words, and to ask about the subject rather than the documents; and two filters drop what slips through: a question almost all of whose words (four letters or more, function words aside, compared with their endings) are in the answer, and one that asks about the sources themselves ("Which document defines…?", "the sources", "the knowledge base"; English phrases). The first 3 that remain are kept. A saved answer's suggestions are checked again when it replays, so ones saved before v0.4.2 that aren't questions aren't shown.

## Moderation

Suggestions are model text, so when the audience's moderation policy checks answers (any output mode: Stream, then retract; Stream checked paragraphs; Buffer), they're checked like an answer: **one check for all of them**, with the question. If the check doesn't pass (blocked, or the provider failed), they're dropped silently: no notice, and the answer is untouched. They're sent only after the check, so nothing unchecked is shown. The answer's own moderation record isn't changed.

## Saved answers

When an answer is saved ([`answer-cache.md`](answer-cache.md)), its suggestions are saved with it and replayed with it, without a model call. An answer first saved from a request that doesn't get suggestions (`stream: false`, the OpenAI-compatible endpoint) is replayed without them.

## Costs and analytics

The call is metered as chat tokens of the agent's chat model (`chat_tokens_in`, `chat_tokens_out`), with `"feature": "suggestions"` and the answer's channel in the usage event's metadata, so it counts toward the team's daily chat tokens and monthly budget and shows in **Costs** and the model usage analytics like the rest of the answer. The moderation check of the suggestions is metered as moderation requests with the same feature (SystemOne moderation as SystemOne tokens and requests). The answer's analytics row (`message_events`) doesn't include the suggestions' tokens, and its latency stops at the answer.

A failed call is logged as a warning (`follow-up suggestions failed; none are shown`). Each call is an `agent.suggestions` span with the number of suggestions sent.

## API

- **Agent configuration:** `followUpSuggestions` (boolean, default `true`) in `AgentConfig` and `AgentConfigInput`.
- **Chat stream:** the SSE event `suggestions` `{messageId, suggestions: [string]}` (1 to 3 questions) follows `message_end` and `citations_checked` and comes before `done`. It's sent only when there is at least one suggestion. Clients should treat the answer as complete at `message_end`, or at `citations_checked` when `message_end` has `citationsPending: true` (the citations are being checked), and keep reading the stream for `suggestions` until `done`. Asking the next question may close the stream early; the answer is already stored.
- `ChatAnswer` (`stream: false`) has no suggestions.

## Limits

Suggestions are at most 3 per answer and 150 characters each. The call has a 10-second limit and holds the person's concurrent-chat slot until it ends (the stream ends with `done` after it).
