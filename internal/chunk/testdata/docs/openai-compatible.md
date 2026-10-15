Every agent is a model on Grounded's OpenAI-compatible API, named `agent:<team>/<agent>`: the team's slug and the agent's address. Point any OpenAI client at your install and use a [team API key](/docs/api/authentication) with the `query` scope.

- `GET /v1/models` lists the agents the key can use.
- `POST /v1/chat/completions` asks one, streamed or not.

The endpoint is **stateless**: transcripts are never stored. Send the conversation so far in `messages`; the last user message is the question.

## A request

<Tabs items={['curl', 'Python', 'JavaScript']}>
<Tab value="curl">

```sh
curl https://grounded.example.org/v1/chat/completions \
  -H "Authorization: Bearer $GROUNDED_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agent:admissions/student-help",
    "messages": [{"role": "user", "content": "How do I request a transcript?"}]
  }'
```

</Tab>
<Tab value="Python">

```python
from openai import OpenAI

client = OpenAI(base_url="https://grounded.example.org/v1", api_key=GROUNDED_API_KEY)
reply = client.chat.completions.create(
    model="agent:admissions/student-help",
    messages=[{"role": "user", "content": "How do I request a transcript?"}],
)
print(reply.choices[0].message.content)
print(reply.model_extra["citations"])  # Grounded's extension field
```

</Tab>
<Tab value="JavaScript">

```js
import OpenAI from 'openai';

const client = new OpenAI({ baseURL: 'https://grounded.example.org/v1', apiKey: GROUNDED_API_KEY });
const reply = await client.chat.completions.create({
  model: 'agent:admissions/student-help',
  messages: [{ role: 'user', content: 'How do I request a transcript?' }],
});
console.log(reply.choices[0].message.content);
console.log(reply.citations); // Grounded's extension field
```

</Tab>
</Tabs>

### What's different from OpenAI

- `model` must be `agent:<team>/<agent>`.
- **System messages from the client are dropped**: the agent's own instructions win. The other messages are the history.
- `tools` and `n` greater than 1 are refused (400).
- Temperature, output length and other generation settings come from the agent, not the request.
- Errors use OpenAI's shape: `{"error": {"message", "type", "code", "param"}}`.

## The response

A normal chat completion, plus two extension fields:

```json
{
  "id": "…",
  "object": "chat.completion",
  "model": "agent:admissions/student-help",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "Order an official transcript from the student portal [1]. Each copy costs $10 [2]." },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 1830, "completion_tokens": 41, "total_tokens": 1871 },
  "citations": [
    { "n": 1, "title": "Transcripts", "snippet": "…", "headingPath": ["Records", "Transcripts"],
      "url": "https://example.org/records/transcripts", "documentId": "…", "sourceId": "…",
      "verification": "verified", "confidence": 0.97,
      "markers": [{ "verification": "verified", "confidence": 0.97 }] },
    { "n": 2, "title": "Fees", "snippet": "…", "headingPath": ["Fees"], "documentId": "…", "sourceId": "…",
      "verification": "unsupported", "confidence": 0.88,
      "markers": [{ "verification": "unsupported", "confidence": 0.88 }] }
  ],
  "claims": [
    { "index": 0, "start": 0, "end": 57, "text": "Order an official transcript from the student portal.",
      "verdict": "supported", "sources": [1], "confidence": 0.97,
      "checks": [{ "n": 1, "occurrence": 0, "verification": "verified", "confidence": 0.97 }] },
    { "index": 1, "start": 58, "end": 82, "text": "Each copy costs $10.",
      "verdict": "not_supported", "sources": [], "confidence": 0.88,
      "checks": [{ "n": 2, "occurrence": 0, "verification": "unsupported", "confidence": 0.88 }] }
  ]
}
```

*(An illustrative response; values are made up.)*

### `citations`

The sources the answer's `[n]` markers refer to. Each has its number `n`, the document's `title`, a `snippet` of the passage (up to about 300 characters), its `headingPath`, `pageStart` and `pageEnd` for paginated documents, and `documentId` and `sourceId`. `url` is set only for web pages, when the agent's citation mode includes links; uploaded files are cited by title only.

With SystemOne citation checks on, each citation also has `verification` (`verified`, `unsupported`, `contradicted` or `unchecked`, the worst verdict of the claims that cite it), `confidence`, and `markers`: one verdict per `[n]` marker of this source, in order.

### `claims`

Set when SystemOne citation checks are on for the agent. Each claim is one factual sentence of `content` (a list item or table row counts as one):

| Field | Meaning |
|---|---|
| `index` | Its position in the answer, from 0. |
| `start`, `end` | Offsets in `content`, in Unicode code points (not bytes or UTF-16 units). |
| `text` | The sentence as plain text, without markers or Markdown. |
| `verdict` | `supported` (a cited source supports it), `not_supported` (it cites sources and none supports it), `uncited` (it cites nothing; count it as not supported), or `unchecked` (a check failed or timed out; leave it out of counts). |
| `sources` | The `n` of the cited sources that support it; empty unless supported. |
| `confidence` | The most confident supporting verdict, or the least confident negative one. |
| `checks` | Each cited source's outcome: `n`, `occurrence` (which `[n]` marker of that source it is, from 0), `verification`, `confidence`. |

The app's summary line ("9 of 10 claims supported · 1 uncited") counts supported claims over supported, not supported and uncited ones. `claims` isn't set for refusals, when citations weren't checked, or when the agent doesn't cite. See [Claims and verdicts](/docs/using/chat#claims-and-verdicts) for what counts as a claim.

In **enforce** mode, non-streamed answers are released after the check: unsupported markers are already removed from `content`, and a strictly grounded agent with nothing supported returns its refusal.

## Streaming

With `"stream": true` the reply is `chat.completion.chunk` events:

- `delta.content` carries the answer, and `delta.reasoning_content` a reasoning model's thinking when the model streams it.
- A final chunk has `finish_reason` and `citations`, and `claims` when checks are on. It's held until the citation check ends; streamed answers are annotated, never rewritten.
- With `stream_options.include_usage`, a usage chunk follows.
- For an agent with tools (a tool-calling search or MCP tools), since v0.4.2 the stream holds the answer's text and sends the final text at the end: the answer is the model's final turn, and a stream can't take back narration written before a tool call. Agents without tools stream as before.
- When the agent's audience streams **checked paragraphs** (the public default since v0.4.0), each content chunk is a paragraph that passed moderation, and there's no `reasoning_content`. A failing paragraph adds the notice and ends with `finish_reason: content_filter`; an unavailable provider sends the `moderation_unavailable` error. Without streaming, the answer is checked once, whole.
- [Follow-up suggestions](/docs/using/follow-up-suggestions) (v0.4.1) aren't sent here, and no call is made for them; the [native chat API](/docs/api/chat-api#the-event-stream) has them.
- Then `data: [DONE]`.

```sh
curl -N https://grounded.example.org/v1/chat/completions \
  -H "Authorization: Bearer $GROUNDED_API_KEY" -H "Content-Type: application/json" \
  -d '{"model": "agent:admissions/student-help", "stream": true,
       "messages": [{"role": "user", "content": "How do I request a transcript?"}]}'
```

## Errors

| Status | When |
|---|---|
| 400 | A malformed request, `tools`, or `n` > 1. |
| 401 | A missing, unknown, revoked or expired key. |
| 403 | The key's scope or restrictions don't allow this agent, or the agent is disabled (`agent_disabled`). |
| 404 | No such agent for this key, or it isn't published. |
| 409 | The published version no longer passes the platform's rules (`agent_policy_violation`), for example after a model's approved level was lowered. |
| 429 | A rate limit, daily quota or used-up budget, with `Retry-After` where it helps. |
| 503 | The model is unavailable, or a fail-closed moderation check couldn't run ("The safety check is unavailable right now. Please try again."). While streaming, it arrives as an error chunk. |

Moderation that blocks a question returns the policy's notice as the answer. Each answer counts against the team's and the agent's query and chat limits, and the key's own rate limit.
