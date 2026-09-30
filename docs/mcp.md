# The MCP server

Grounded can act as an [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server, so AI tools such as coding agents and desktop assistants can search your knowledge bases and ask your agents, with the same permissions and limits as the REST API. It's roadmap item C1a, designed in [`v0.3.0.md`](v0.3.0.md) §3.

- **Address:** `https://<APP_URL>/mcp`, for example `https://rag.example.edu/mcp`.
- **Transport:** Streamable HTTP, stateless: every request is a `POST`, with no session. Grounded speaks protocol revision `2026-07-28` and also serves clients that still use `2025-11-25`, `2025-06-18`, `2025-03-26` or `2024-11-05`.
- **Sign-in:** an API key with the **MCP** scope, sent as `Authorization: Bearer <key>`. OAuth sign-in is planned for a later release.
- **Tools:** `search` (passages from a knowledge base) and `ask` (an agent's answer with citations).

## Turning it on (platform admins)

The MCP server is **off** on a new install. While it's off, `/mcp` answers `404` to everyone.

1. Open **Admin → Overview**, find **MCP server** under **Features** and turn on **Allow MCP clients**.
2. The row then shows the address clients use. **Setup guide** opens this page.

Turning it off asks for confirmation: connected tools stop working at once. API keys and their scopes are kept, so turning it on again brings everything back. Auditors see the switch but can't change it. Each change is audited as `platform.mcp` ("Turned the MCP server on" or "…off").

API: `GET /v1/admin/settings/mcp` and `PUT /v1/admin/settings/mcp` with `If-Match` (see [`../api/openapi.yaml`](../api/openapi.yaml)). `GET /v1/me` reports the switch as `capabilities.mcp`.

## Creating a key (anyone in a team)

1. In your team, open **API keys → New API key**.
2. Tick **MCP: search and ask from AI tools**. Every team role may give a key this scope. It doesn't need the **Query** scope, and it grants nothing on the REST API.
3. Optionally restrict the key to some knowledge bases or agents, and give it an expiry date.
4. Copy the secret. The dialog also shows the MCP server's address.

What the key can reach over MCP is what it could reach as a query key, and nothing more:

- **Its team only**, and only the knowledge bases and agents it's restricted to (all of the team's when unrestricted). An agent is offered only when the key may use every knowledge base the agent searches.
- **A personal key** acts as its owner. It stops working when the owner leaves the team or is suspended. Its `ask` conversations are stored as the owner's conversations, as in the web app, so a follow-up can continue one.
- **A service key** belongs to the team and keeps no conversations: each `ask` stands alone.
- Revoking a key or letting it expire takes effect on the next request.

## Connecting a client

Every client needs the same two things: the URL and a header.

```text
URL:     https://rag.example.edu/mcp
Header:  Authorization: Bearer rag_XXXXXXXXXXXX_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Keep the key out of files you share or commit. Most clients can read it from an environment variable, as below.

### Any Streamable HTTP client

Most clients take a JSON entry like this one. The field names vary: `type` is sometimes `transport`, and some clients want `"streamable-http"` or `"http"`. Whether `${GROUNDED_API_KEY}` is read from the environment depends on the client; if it isn't, paste the key (and keep the file private).

```json
{
  "mcpServers": {
    "grounded": {
      "type": "http",
      "url": "https://rag.example.edu/mcp",
      "headers": { "Authorization": "Bearer ${GROUNDED_API_KEY}" }
    }
  }
}
```

### Claude Code

```sh
export GROUNDED_API_KEY=rag_...
claude mcp add --transport http grounded https://rag.example.edu/mcp --header "Authorization: Bearer $GROUNDED_API_KEY"
```

### OpenCode

In `opencode.json` (or `opencode.jsonc`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "grounded": {
      "type": "remote",
      "url": "https://rag.example.edu/mcp",
      "enabled": true,
      "headers": { "Authorization": "Bearer {env:GROUNDED_API_KEY}" }
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`; VS Code asks for the key the first time and stores it:

```json
{
  "inputs": [{ "type": "promptString", "id": "grounded-key", "description": "Grounded API key", "password": true }],
  "servers": {
    "grounded": {
      "type": "http",
      "url": "https://rag.example.edu/mcp",
      "headers": { "Authorization": "Bearer ${input:grounded-key}" }
    }
  }
}
```

These examples follow each client's documentation at the time of writing; clients change their configuration formats often, so check your client's documentation if one doesn't work. Clients that can only start local (stdio) servers need a bridge that forwards to a remote Streamable HTTP server with a header.

### Checking the connection with curl

```sh
curl -s https://rag.example.edu/mcp \
  -H "Authorization: Bearer $GROUNDED_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

The answer names the server (`grounded`), its supported protocol versions and its `tools` capability.

## The tools

The tool list is built for each key: the enums list exactly what that key may use, and each tool's description names every option with the first line of its description. The list is cacheable for one minute (`ttlMs` 60000, `cacheScope` `private`). Tools come in a fixed order: `ask`, then `search`.

A key that may search no knowledge base has no `search` tool, and one that may use no agent has no `ask` tool. A key that may use neither lists no tools.

### `search`

| Argument | | |
|---|---|---|
| `knowledge_base` | required | One of the key's knowledge bases, by a name made from its title (`Student handbook` → `student-handbook`; two titles that make the same name get the start of their ID appended) |
| `query` | required | 1–4,000 characters |
| `top_k` | optional | 1–50 passages; by default the knowledge base's own setting |

It returns the passages twice: as text for the model to read, and as structured content:

```json
{
  "knowledge_base": "student-handbook",
  "passages": [
    {
      "n": 1,
      "title": "Parking",
      "heading_path": ["Permits"],
      "url": "https://www.example.edu/parking",
      "document_id": "0f6d…",
      "text": "Students must display a valid parking permit…"
    }
  ]
}
```

`n` is the passage's citation number in this result. `url` is set for web pages, `filename` for uploads, and `page_start`/`page_end` for paged documents. Knowledge bases whose classification level keeps API keys to agents ("direct retrieval" off, [DESIGN §4](DESIGN.md#4-data-classification-adr-0006)) are not offered, as `POST …/retrieve` refuses them.

### `ask`

| Argument | | |
|---|---|---|
| `agent` | required | One of the published agents the key may chat with, by its address name (`go-docs`) |
| `question` | required | 1–8,000 characters |
| `conversation` | optional | The `conversation` value a previous `ask` returned, to ask a follow-up (personal keys only) |

The answer is not streamed. It returns the answer text with its `[n]` markers, the sources, and how to follow up; the structured content carries the same:

```json
{
  "agent": "go-docs",
  "answer": "Use go test with -run to pick tests [1].",
  "citations": [
    { "n": 1, "title": "Testing", "heading_path": ["Running tests"], "url": "https://go.dev/doc/…", "document_id": "…", "snippet": "…" }
  ],
  "claims": [{ "text": "Use go test with -run to pick tests.", "verdict": "supported", "sources": [1] }],
  "conversation": "c1_…"
}
```

- `claims` (and each citation's `verification`) are there when the agent's citations are checked by SystemOne ([`systemone.md`](systemone.md) §3): each factual sentence with its verdict (`supported`, `not_supported`, `uncited` or `unchecked`).
- `conversation` is an opaque handle for the conversation Grounded stored. It only works with the key that received it: another key, even the same person's, gets "That conversation wasn't found". Rotating `API_KEY_PEPPER` retires every handle ([`operations/rotate-keys.md`](operations/rotate-keys.md)); the next question starts a new conversation.
- `refused` is true when the agent declined (for example, a strict agent with nothing to answer from).

## Limits and errors

Everything the REST API applies applies here, unchanged:

- **Classification:** the agent's audience and model ceilings are checked on every question, and knowledge-base classification decides direct retrieval, as above.
- **Rate limits:** the key's requests per minute (`429`), and the team's query and chat limits.
- **Budgets:** when the team's enforced monthly budget is used up ([`costs.md`](costs.md)), `search` and `ask` return a tool error that says so.
- **Size and time:** a request body is at most 1 MiB; a tool call stops after 5 minutes.

A refusal of the call itself is an HTTP status with a JSON-RPC error body (`id` null, Grounded's error code in `error.data.code`):

| Status | JSON-RPC code | When |
|---|---|---|
| 404 | -32004 | The MCP server is off (`mcp_off`) |
| 401 | -32001 | No key, or an invalid, expired or revoked key, or its owner left or is suspended (`invalid_api_key`); with `WWW-Authenticate: Bearer` |
| 403 | -32003 | The key has no MCP scope (`missing_scope`) |
| 405 | -32600 | Anything but `POST` |
| 429 | -32005 | The key's request rate (`rate_limited`, with `Retry-After`) |

A problem inside a tool (a limit, a used-up budget, an unavailable model, a follow-up that can't be found, arguments outside the schema) is a normal tool result with `isError: true` and a sentence saying what happened, so the AI tool can tell the person.

## What's recorded

- **Usage:** searches and answers count towards the team's usage, limits and spend like REST calls, with the channel `mcp` (usage events' `channel`, answer analytics and the admin access log, where it shows as "MCP server").
- **Audit:** every tool call is an entry with the key as the actor: `mcp.search` (target: the knowledge base) and `mcp.ask` (target: the agent), with the tool, the knowledge base or agent, the number of passages or citations, and the outcome (`ok`, `refused` or `error`, with the error code). Never the query, the question or the answer. Recent changes on the Overview pages leave them out; the audit log shows them under **MCP server**.
- **Metrics:** `grounded_mcp_tool_calls_total{tool, outcome}`, and the HTTP metrics for `POST /mcp` in the route group `mcp` (outside the latency objective, as answers can take minutes). See [`operations/monitoring.md`](operations/monitoring.md).

## Not in this release

- OAuth sign-in for `/mcp` (planned as an experimental setting).
- Streaming answers (`ask` returns when the answer is complete) and progress notifications.
- Documents as MCP resources, prompts, and list-changed notifications (a changed list shows on the next `tools/list`).
- Metadata filters on `search`.
