# The MCP server

Grounded can act as an [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server, so AI tools such as coding agents and desktop assistants can search your knowledge bases and ask your agents, with the same permissions and limits as the REST API. It's roadmap item C1a, designed in [`v0.3.0.md`](v0.3.0.md) §3.

- **Address:** `https://<APP_URL>/mcp`, for example `https://rag.example.edu/mcp`.
- **Transport:** Streamable HTTP, stateless: every request is a `POST`, with no session. Grounded speaks protocol revision `2026-07-28` and also serves clients that still use `2025-11-25`, `2025-06-18`, `2025-03-26` or `2024-11-05`.
- **Sign-in:** an API key with the **MCP** scope, sent as `Authorization: Bearer <key>`; or, when a platform admin turns it on, [OAuth sign-in](#signing-in-with-oauth-experimental) (experimental), where the person using the tool signs in and approves it.
- **Tools:** `search` (passages from a knowledge base) and `ask` (an agent's answer with citations).

## Turning it on (platform admins)

The MCP server is **off** on a new install. While it's off, `/mcp` answers `404` to everyone.

1. Open **Admin → Settings**, find **MCP server** under **Features** and turn on **Allow MCP clients**.
2. The row then shows the address clients use. **Setup guide** opens this page.

Turning it off asks for confirmation: connected tools stop working at once. API keys and their scopes are kept, so turning it on again brings everything back. Auditors see the switch but can't change it. Each change is audited as `platform.mcp` ("Turned the MCP server on" or "…off").

API: `GET /v1/admin/settings/mcp` and `PUT /v1/admin/settings/mcp` with `If-Match` (see [`../api/openapi.yaml`](../api/openapi.yaml)). `GET /v1/me` reports the switch as `capabilities.mcp`.

## Creating a key (anyone in a team)

1. In your team, open **Team settings** and its **API keys** tab, then press **New API key**.
2. Tick **MCP: search and ask from AI tools**. Every team role may give a key this scope. It doesn't need the **Query** scope, and it grants nothing on the REST API.
3. **Query** is ticked by default: untick it if the key is only for AI tools, so it can't also query the REST API.
4. Optionally restrict the key to some knowledge bases or agents, and give it an expiry date.
5. Copy the secret. The dialog also shows the MCP server's address: note it too, as it isn't shown again on the key's page (a platform admin finds it under **Admin → Settings → Features**; it's always `<APP_URL>/mcp`).

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
  -H "Mcp-Protocol-Version: 2026-07-28" -H "Mcp-Method: server/discover" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

The answer names the server (`grounded`), its supported protocol versions and its `tools` capability. Revision `2026-07-28` requires the `Mcp-Protocol-Version` and `Mcp-Method` headers to match the body: without them the answer is `400`. A shorter check, which lists the tools the key may use, needs neither:

```sh
curl -s https://rag.example.edu/mcp \
  -H "Authorization: Bearer $GROUNDED_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A refused key is `401` (`invalid_api_key`) or `403` (`missing_scope`: the key lacks the MCP scope). SDK-based clients often print only "Unauthorized" or "Forbidden"; the reason is in the JSON-RPC body, which these commands show.

## Signing in with OAuth (experimental)

With this setting on, an AI tool can connect without an API key: the person using it signs in to Grounded in their browser and approves the tool, and the tool gets short-lived tokens that act as that person. Grounded is the OAuth 2.1 authorization server for its own `/mcp`, in front of your sign-in provider (OIDC). It follows the MCP authorization spec (`2025-11-25` and `2026-07-28`). It is **experimental**: off by default, and it may change while clients and the spec settle. API keys keep working either way.

### Turning it on (platform admins)

1. Turn on the MCP server (above).
2. On **Admin → Settings → Features**, find **OAuth sign-in for MCP clients** (marked **Experimental**) and turn on **Allow OAuth sign-in**.

It only takes effect while the MCP server is on. While it's off, every endpoint below answers `404`, and existing tokens are refused (`401`, `oauth_off`) until it's turned on again (the connections are kept). Auditors see the switch but can't change it. Each change is audited as `platform.mcp_oauth`. API: the same `GET`/`PUT /v1/admin/settings/mcp`, with `oauthEnabled`; `GET /v1/me` reports it (in effect) as `capabilities.mcpOAuth`.

### What a person sees

1. They add `https://rag.example.edu/mcp` to their tool with no header. The tool's first request gets `401` with `WWW-Authenticate: Bearer resource_metadata="https://rag.example.edu/.well-known/oauth-protected-resource/mcp", scope="mcp"`, and starts OAuth.
2. Their browser opens Grounded. If they aren't signed in, they sign in as usual (single sign-on, or a development account).
3. The consent page names the tool, shows **the host that vouches for it** prominently (see below), says what it may do ("Search knowledge bases and ask agents you can use, as you") and where the browser goes back to, with **Allow** and **Deny**.
4. After **Allow** the browser returns to the tool, which gets its tokens. The next time the same tool asks, the person isn't asked again (the consent is remembered until they disconnect it).

**Connected apps**: the account menu's **Connected apps** page (`/settings/connected-apps`, there for everyone, including people in no team) and the person's **API keys** page (Team settings → API keys) list the tools they connected (name and host, when connected, when last used) with **Disconnect…**. Disconnecting stops the tool at once and forgets the consent. Platform admins see and disconnect anyone's apps on the person's page (**Admin → Users → a person → Connected apps**); auditors see them. API: `GET /v1/me/oauth-grants`, `DELETE /v1/me/oauth-grants/{grantId}`, `GET /v1/admin/users/{userId}/oauth-grants`, `DELETE /v1/admin/users/{userId}/oauth-grants/{grantId}`.

### What a connected tool can reach

A token acts as the person, with only the `mcp` scope, and is checked against their **current** teams and roles on every request:

- **`search`:** the knowledge bases of every team they belong to now, except those whose classification keeps programs to agents (as for API keys).
- **`ask`:** the published agents of those teams. Not other teams' agents that are open to everyone signed in, and not public agents: a personal key can't reach those either.
- Their platform role (admin or auditor) doesn't apply through a token.
- **Names carry the team.** Through a connection, knowledge bases and agents are named `<team>/<name>`, with the team's slug: `it-help-desk/it-help-articles`, `it-help-desk/help-desk-assistant`. That's so in one team or several, so joining or leaving a team renames nothing, and two teams' "Handbook"s can't be confused. A key's names have no team (the key belongs to one): `it-help-articles`.
- Its conversations are the person's, like a personal key's; a follow-up handle only works with the same connection.
- Limits: the team's query and chat limits, the person's own per-minute limit, and the per-key query rate applied per connection; the request rate per connection is the API key rate.

The difference from a personal key: a key belongs to one team and may be restricted to some knowledge bases and agents; a connection spans all of the person's teams, has no such restrictions, and follows their memberships as they change. A suspended person's tokens stop working at once. A token can't be used on the REST API (`/v1/...` answers `401`).

### Endpoints

Like `/mcp`, these speak a protocol, so they're described here rather than in the OpenAPI document. `<APP_URL>` is the issuer.

| Endpoint | What |
|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` (and `/.well-known/oauth-protected-resource`) | Protected resource metadata (RFC 9728): `resource` is `<APP_URL>/mcp`, the authorization server is `<APP_URL>`, scope `mcp` |
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414): PKCE `S256` only, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true` |
| `GET /oauth/authorize` | The authorization endpoint (authorization code with PKCE) |
| `POST /oauth/token` | `authorization_code` and `refresh_token` grants (form-encoded; public clients send `client_id`) |
| `POST /oauth/register` | Dynamic Client Registration (RFC 7591), public clients only |
| `POST /oauth/revoke` | Token revocation (RFC 7009) |

A `GET` on the three `POST` endpoints answers `405` with `Allow: POST` (`404` while OAuth sign-in is off). Other `/.well-known/` documents, such as `openid-configuration`, answer `404` in JSON: Grounded isn't an OpenID provider for clients.

**Clients.** A client identifies itself in one of two ways:

- **A Client ID Metadata Document** (preferred): its `client_id` is an https URL with a path, such as `https://assistant.example.com/oauth/client.json`, whose JSON document gives `client_id` (the same URL), `client_name`, `redirect_uris` and optionally `client_uri` and `logo_uri`. Grounded fetches it like an MCP server's URL: public addresses only (checked when dialling), no redirects, 5 seconds, at most 16 KiB, `application/json`. It's cached for its `Cache-Control` max-age, between a minute and an hour (10 minutes without one). The consent page shows the document's host, which vouches for the name.
- **Dynamic Client Registration**, for older clients: `POST /oauth/register` with `redirect_uris` (1 to 10) and optionally `client_name`, `client_uri` and `logo_uri`. Anyone can register any name, so the consent page marks such a client **Unverified**, shows the host of its `client_uri` as the client's own claim ("Says it's from …"), if any, and names the host its answer goes to (the redirect URI's). A registration unused for 30 days is deleted. Registration is limited to 10 per minute per address.

Redirect URIs are `https`, or `http` on `localhost`, `127.0.0.1` or `[::1]` (a local app's listener; any port matches, as RFC 8252 allows). They must match a registered one exactly otherwise. Private-use schemes (`myapp://`) aren't supported.

**Authorization requests** need `response_type=code`, `code_challenge` with `code_challenge_method=S256` (`plain` is refused), and `resource=<APP_URL>/mcp` exactly (RFC 8707; anything else is `invalid_target`); `state` is echoed back, and every response carries `iss` (RFC 9207). Until the client and its redirect URI are known to be good, an error is shown as a page and never redirected anywhere; after that, errors go back to the client. The consent page's decision is sent with the app's CSRF token.

### Tokens

| | Lifetime | Notes |
|---|---|---|
| Authorization code | 60 seconds, single use | Bound to the client, redirect URI, PKCE challenge, resource and person; used up by the first exchange, even a failed one |
| Access token (`gat_…`) | 1 hour | Bound to `<APP_URL>/mcp`; only accepted by `/mcp` |
| Refresh token (`grt_…`) | 30 days, renewed on each use | Rotated on every use; presenting an already-used refresh token more than 30 seconds after it was used revokes the whole connection (within 30 seconds it's a client refreshing twice at once, and gets another pair) (a stolen copy, or a client that lost the new one), and the person connects again |

Tokens are opaque random values, stored only as HMAC-SHA256 digests under the API-key pepper (like API keys), and looked up by digest. During a pepper rotation (`API_KEY_PEPPER_PREVIOUS`) existing tokens keep working; once the previous pepper is removed, tools sign in again. Rate limits: 60 requests per minute per address on the authorization, token and revocation endpoints.

### What's recorded

- **Audit:** `oauth.client_register` (a registration, as the system, with the caller's address, shown as **Address** on the entry in Admin → Logs and in its CSV), `oauth.consent` (a person allowed a tool), `oauth.token_issue` (tokens issued, with the grant type; never a token: "App signed in", or "App renewed its sign-in" for a refresh), `oauth.revoke` (with the reason, which the log names: `user` "Disconnected an app", `admin` "Disconnected a person's app", `client` "App disconnected itself" or "App signed out one token", `refresh_reuse` "Connection revoked: a refresh token was reused (possible theft)"), and `platform.mcp_oauth`. Tool calls are `mcp.search` and `mcp.ask` with the person as the actor and `via: oauth` and the tool's name in the metadata, under the team of the knowledge base or agent. Each entry says how the person acted (**How**: signed in, an API key, or a connected app, by name; the API's `via`, and the CSV's `via` and `viaName` columns). Recent changes on the admin Overview leave out `oauth.` entries.
- **Usage:** as the person, on the channel `mcp` (no API key).

### Known limitations

- Experimental: the setting, the endpoints and the consent page may change in a later release.
- One resource (`/mcp`) and one scope (`mcp`); no per-tool scopes or step-up.
- Public clients only: no client secrets or `private_key_jwt`.
- No private-use URI schemes for redirects; no CORS on the endpoints (browser-based clients need their own proxy).
- Consent is per person and client: disconnecting a tool on one computer disconnects it everywhere that person uses it.

## The tools

The tool list is built for each key: the enums list exactly what that key may use, and each tool's description names every option with the first line of its description. The list is cacheable for one minute (`ttlMs` 60000, `cacheScope` `private`). Tools come in a fixed order: `ask`, then `search`.

A key that may search no knowledge base has no `search` tool, and one that may use no agent has no `ask` tool. A key that may use neither lists no tools.

### `search`

| Argument | | |
|---|---|---|
| `knowledge_base` | required | One of the key's knowledge bases, by a name made from its title (`Student handbook` → `student-handbook`; two titles that make the same name get the start of their ID appended). Through OAuth, the name starts with the team's slug: `registrar/student-handbook` |
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
| `agent` | required | One of the published agents the key may chat with, by its address name (`go-docs`). Through OAuth, it starts with the team's slug: `registrar/go-docs` |
| `question` | required | 1–8,000 characters |
| `conversation` | optional | The `conversation` value a previous `ask` returned, to ask a follow-up (personal keys only) |

The answer is not streamed. It returns the answer text with its `[n]` markers, the sources, and how to follow up; the structured content carries the same:

```json
{
  "agent": "go-docs",
  "answer": "Use go test with -run to pick tests [1].",
  "citations": [
    { "n": 1, "kind": "document", "title": "Testing", "heading_path": ["Running tests"], "url": "https://go.dev/doc/…", "document_id": "…", "snippet": "…" },
    { "n": 2, "kind": "tool", "title": "Service status · check_outage", "heading_path": [], "server": "Service status", "tool": "check_outage", "snippet": "…" }
  ],
  "claims": [{ "text": "Use go test with -run to pick tests.", "verdict": "supported", "sources": [1] }],
  "conversation": "c1_…"
}
```

- Each citation has a `kind`: `document` for a passage (with its `document_id`, and `url` for a web page when the agent links its sources, or `filename` for an upload, as in `search`), or `tool` for the result of an MCP tool the agent called ([`mcp-client.md`](mcp-client.md)), with the `server` and `tool` and no `document_id`. The text marks those sources "(tool result)".
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
| 401 | -32001 | No key, or an invalid, expired or revoked key, or its owner left or is suspended (`invalid_api_key`); with `WWW-Authenticate: Bearer`. With OAuth sign-in on: no credential (`unauthorized`) or a bad access token (`invalid_token`), with the `resource_metadata` challenge; a token while OAuth sign-in is off (`oauth_off`) |
| 403 | -32003 | The key has no MCP scope (`missing_scope`) |
| 405 | -32600 | Anything but `POST` |
| 429 | -32005 | The key's request rate (`rate_limited`, with `Retry-After`) |

A problem inside a tool (a limit, a used-up budget, an unavailable model, a follow-up that can't be found, arguments outside the schema) is a normal tool result with `isError: true` and a sentence saying what happened, so the AI tool can tell the person.

## What's recorded

- **Usage:** searches and answers count towards the team's usage, limits and spend like REST calls, with the channel `mcp` (usage events' `channel`, answer analytics and the admin access log, where it shows as "MCP server").
- **Audit:** every tool call is an entry with the key as the actor: `mcp.search` (target: the knowledge base) and `mcp.ask` (target: the agent), with the tool, the knowledge base or agent, the number of passages or citations, and the outcome (`ok`, `refused` or `error`, with the error code). Never the query, the question or the answer. Recent changes on the Overview pages leave them out; the audit log shows them under **MCP server**.
- **Metrics:** `grounded_mcp_tool_calls_total{tool, outcome}`, and the HTTP metrics for `POST /mcp` in the route group `mcp` (outside the latency objective, as answers can take minutes). See [`operations/monitoring.md`](operations/monitoring.md).

## MCP tools in agents

The other direction, agents calling tools on remote MCP servers that platform admins register and approve, is described in [`mcp-client.md`](mcp-client.md).

## Not in this release

- OAuth sign-in beyond the experimental setting above (see its known limitations).
- Streaming answers (`ask` returns when the answer is complete) and progress notifications.
- Documents as MCP resources, prompts, and list-changed notifications (a changed list shows on the next `tools/list`).
- Metadata filters on `search`.
