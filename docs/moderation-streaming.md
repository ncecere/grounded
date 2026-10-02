# Answers streamed in checked paragraphs

With output moderation, an answer is checked before people may rely on it. Until v0.4.0 public agents buffered the whole answer: it was written, checked, then sent, so visitors waited 5–10 seconds for anything. **Stream checked paragraphs** (`stream_checked`) releases the answer paragraph by paragraph as the model writes it. Nothing reaches anyone unchecked, and moderation still fails closed. It's the default for the public audience since v0.4.0.

Design: [`v0.4.0.md`](v0.4.0.md) §4. Code: `internal/agents/streamcheck.go` (the chunker and the checks) and `internal/moderation` (the policy). Moderation in general: [`phase4-publishing.md`](phase4-publishing.md) §4.

## The three output modes

| Mode | What people see | When an answer fails |
|---|---|---|
| **Stream, then retract** (`stream_retract`) | The answer as it's written. The whole answer is checked when it ends. | The notice replaces the answer they already read. |
| **Stream checked paragraphs** (`stream_checked`) | "Writing and checking the answer…", then the answer a paragraph at a time, each shown once it passed. | The notice replaces the whole answer, including paragraphs already shown. Nothing after the failing paragraph is sent. |
| **Buffer** (`buffer`) | What the agent is doing, then the whole answer at once, shown from its start. | The answer is never shown; the notice is. |

The platform policy of each audience sets the mode (**Admin → Moderation**, the audience's tab, **Answers**). An agent can only make it stricter, in the order stream then retract, checked paragraphs, buffer: **Build → Safety → Check answers before showing them** offers *As the platform's policy says*, *Paragraph by paragraph* and *The whole answer*. A stricter platform mode wins over the agent's choice.

**Upgrading:** a public policy that was never saved now streams checked paragraphs. A public policy an admin saved keeps its mode, so an install that saved Buffer still buffers until an admin chooses the new mode.

## How the answer is checked

- **Paragraphs.** The model's text is held until a paragraph ends: a blank line, or, for a long paragraph, the last sentence end once it reaches about 800 characters (a paragraph with no sentence end at all is cut at a space at about 1,600). A typical answer takes 3–6 checks, and its first words appear about 2–4 seconds after the model starts writing.
- **Each check reads the answer so far**, not just the new paragraph, so context counts: a paragraph that is only harmful next to the one before it can fail.
- **The model isn't held up.** Checks run one at a time, in order, beside the model, and each paragraph is released once its check passed. The text left when the model ends is checked last.
- **A failing paragraph** replaces the whole answer with the policy's notice (or the support message, for a support action) at once. The stream's `moderation` event says `retracted`, or `withheld` when nothing had been shown yet. The answer is stored as withheld (`moderation_withheld`), without its text, citations or thinking, and isn't counted by the gap report.
- **An unavailable provider** (an error or a timeout after one retry) fails closed when the policy does (always for public): the answer is replaced by "The safety check is unavailable right now. Please try again." (`unavailable`, stored as `moderation_unavailable`). For an audience whose policy fails open, the paragraph is released.
- **Thinking is never shown** in this mode (it isn't moderated). The stored answer keeps it, as in buffer mode.
- **Citations and claims** are checked after the last paragraph, as for streamed answers: `message_end` follows the last paragraph, then `citations_checked` with the verdicts ([`systemone.md`](systemone.md) §3).
- **After a failure the model isn't stopped**: its text is dropped and its tokens are metered as usual (an interrupted stream reports no usage).

## Channels

- **The web chat, the public page and the widget** show "Writing and checking the answer…" until the first paragraph, then follow the answer as it grows. A released paragraph taller than the view is shown from its start (the first one with its question), and the view stops following there, so the reader isn't pulled past it. Citation markers show as chips of the sources they cite as soon as their paragraph is released (the verdicts follow after the last one). Buffered answers and saved answers, which arrive whole, are shown from their start.
- **The streamed chat API** (SSE): `message_start` carries `mode: stream_checked`; each `text_delta` is a checked paragraph; there are no `thinking_delta` events.
- **The OpenAI-compatible endpoint, streamed:** each content chunk is a checked paragraph. A failing paragraph adds the notice and ends with `finish_reason: content_filter`; an unavailable provider sends the `moderation_unavailable` error.
- **Answers that don't stream** (`stream: false`, the OpenAI-compatible endpoint without streaming, MCP `ask`) are checked once, whole, before they're returned.
- **Try it** uses the draft audience's policy, so a public draft streams checked paragraphs too.
- **Saved answers** ([`answer-cache.md`](answer-cache.md)): only answers that passed are saved, and a saved answer is sent whole without being checked again (its `message_start` has `buffered: true` and no `mode`).

## Costs and records

- Each paragraph is one check of the answer so far, so an answer costs one moderation request per paragraph instead of one, and the checks read more text. Moderation models are metered as `moderation_requests` (each answered call); SystemOne providers as SystemOne tokens and requests, feature `moderation`.
- `message_events.moderation_output` records one decision: the failing check's, otherwise the strongest (an error, then a flag, then a pass; the latest among equals), with `checks`, the number of checks. Never any text (ADR-0010).

## Monitoring

| Signal | What |
|---|---|
| `grounded_moderation_first_release_seconds{channel}` | Time from the question to the first paragraph shown |
| `grounded_moderation_paragraph_checks_total{decision}` | Paragraph checks by decision (`pass`, `flag`, `block`, `support`, `error`); each is also counted in `grounded_moderation_decisions_total{stage="output"}` |
| `moderation.paragraph` span | One per check, under `agent.answer`: the paragraph's number, the length of the text checked and the decision |

The **Grounded / Models & moderation** dashboard's Moderation row shows both metrics.
