# MCP tools in agents

Agents can call tools on remote **MCP servers** while they answer: for example a service status check, a room booking lookup or a ticket search. A platform admin registers each server and approves its tools one by one; team editors choose approved tools for an agent; every call is bounded, metered and audited, and its result is cited in the answer like a document.

This is the MCP *client* (roadmap C1b, [`v0.3.0.md`](v0.3.0.md) §4). For Grounded as an MCP *server* (other AI tools searching Grounded), see [`mcp.md`](mcp.md).

Nothing changes until a platform admin registers a server and approves a tool.

## Registering a server (platform admins)

**Admin → Models → MCP servers → Add MCP server.**

| Field | What it is |
|---|---|
| Name | How editors and answers name it ("From *Service status* · check_outage") |
| URL | The server's Streamable HTTP endpoint, for example `https://status.example.edu/mcp`. **https only**, at a public address (see [Security](#security)) |
| Header and value | A static header sent with every request, such as `Authorization: Bearer …` or `X-API-Key: …`. The value is stored encrypted with `ENCRYPTION_KEY` (like connection keys), never shown again, and rotated by `grounded rotate-keys`. OAuth to outside servers is not in v0.3 |
| Data up to | The **classification ceiling**: the most sensitive data the server may receive. An agent whose knowledge bases hold more can't use its tools |
| Timeout | How long one call may take (1–120 s, default 30) |
| Price per call | Optional, in the platform currency, from today (see [Costs](#costs)) |
| Enabled | Turned off, no agent calls its tools and the health job skips it |

Then open the server and press **Read tools**: Grounded fetches its tool list (`tools/list`). Every new tool starts **not approved**.

Auditors see the servers and tools but change nothing. Everything is audited: `mcp_server.create`, `mcp_server.update` (with whether the header value changed, never the value), `mcp_server.delete`, `mcp_server.refresh` (counts, and the names of tools that lost their approval), `mcp_tool.approve` and `mcp_tool.unapprove`.

### Approving tools

Each tool shows its name, title, the server's **description** and its **input schema**. Read both before you approve: the model reads them as part of its instructions, so a hostile or careless description is a prompt injection. Approve only the tools agents need.

When you press **Read tools** again:

- a new tool is added, not approved;
- a tool whose title, description or input schema **changed** loses its approval (read it again, then approve);
- a tool the server **no longer lists** is marked "No longer listed" and unapproved (it can't be approved until the server lists it again).

Withdrawing an approval takes effect at once: agents stop offering the tool in their next answer.

### Deleting a server

A server that a published agent version uses can't be deleted (`409 mcp_server_in_use`, listing the agents): turn it off instead, or publish those agents without its tools first. Deleting removes its tools from past versions; drafts that chose them show a warning until they're removed.

### Health

**Test server** connects (`server/discover`, or `initialize` for servers on older protocol revisions) and reads the tool list; it never calls a tool. The result is stored like a connection test ([`operations/health.md`](operations/health.md)), and the worker's health job re-tests every enabled server the same way on the `HEALTH_CHECK_INTERVAL` schedule, at no cost. The list shows "Healthy · 3 minutes ago" or "Failing · since 2 hours ago" with a Health filter, failing servers appear under **Needs attention** on the admin Overview, and `grounded_health_failing_seconds{kind="mcp_server"}` feeds the `GroundedHealthCheckFailing` alert.

## Choosing tools for an agent (team editors)

**Agent → Build → Tools** lists the approved tools of enabled servers with the server's description. Tick the ones the agent may call (up to 10). A tool whose server is approved for less sensitive data than the agent's knowledge bases hold can't be ticked; the same rule is checked again when you publish and before every call. The chat model must support tools.

Tools are part of the draft and of each published version (`agent_tools`), like the knowledge bases. When a tool later loses its approval, its server is turned off or its ceiling drops below the agent's data, the agent keeps answering without it and its page warns until it's fixed.

## At answer time

The chosen tools join `search_knowledge` in the agent loop. The model decides whether to call one and with which arguments.

- **What's sent:** only the arguments the model chose, as JSON, to the server's `tools/call`, with the static header. Never the conversation, the question or the passages, unless the model puts them in an argument; the classification ceiling is the guard against sensitive data leaving.
- **Checked before each call:** the server is still enabled and approved for the agent's data, the team's budget isn't used up, and the answer hasn't reached its call limit. A call that is refused isn't made; the model reads why and answers with what it has.
- **Bounds:** the server's timeout; one HTTP response of at most 1 MiB; the result the model reads is cut to 8,000 characters with a note (the citation says it was cut); and the team limit **MCP tool calls per answer** (`mcp_calls_per_answer`, default 5, Admin → Limits; at most 25).
- **Refused:** requests from the server for more input (MRTR input requests, the new pattern for elicitation), sampling and roots: an agent answering a person can't answer a remote server's questions. The model reads a tool error.
- **Errors:** a timeout, an unreachable server or a tool that reports an error become a tool error the model reads; the answer goes on.

### Results are sources

A tool's result is untrusted text. It is given to the model inside `<sources>` as a numbered source (`type="tool_result"`), under the same platform rule as passages: data, never instructions. With SystemOne passage judging on, it is judged against the question first, and a result judged irrelevant isn't given. The answer cites it as `[n]` and it appears among the answer's sources as **From *Service status* · check_outage**, expandable like a passage; citation checks verify claims against it. A strictly grounded agent answers only from passages and tool results. The citation is stored with the answer, so reopening the conversation shows it.

## Costs

Each call that reaches a server is one unit of the ledger kind `mcp_calls`, with the server as its model. With a **price per call** it is priced like any other usage (the category "MCP tools" in Usage & spend), counts toward team budgets, and an enforced budget that is used up stops further calls. Without a price, calls are counted but cost nothing (reports mark the spend as incomplete). A new price applies from today; earlier days keep theirs.

## Audit and metrics

- Every call is audited as `mcp.tool_call` with the agent (its name and ID), the server, the tool, the outcome (`ok`, `tool_error`, `timeout`, `too_large`, `refused`, `error`), a reason when refused (`call_limit`, `budget`, `ceiling`, `disabled`, `input_required`), the duration and the result's size, never the arguments or the result. The log names the outcome: "An agent called an MCP tool", "An agent's MCP tool call was refused (call limit)" for a call that wasn't made, or "…failed (timeout)". Refused calls also count in `grounded_mcp_client_calls_total{outcome="refused"}`.
- `grounded_mcp_client_calls_total{server, tool, outcome}` and `grounded_mcp_client_call_duration_seconds{server, tool}`; server and tool names are bounded by what admins register and approve.

## Security

- **Addresses:** the URL must be https; its host must resolve to public addresses only. Private, loopback, link-local (including cloud metadata), CGNAT, documentation and translation ranges are refused when the server is saved and again, pinned, every time Grounded dials it, so a DNS change can't point a registered server at the internal network. Redirects are never followed. Credentials go in the header, not the URL (a URL with a query string is refused). Proxy settings from the environment are not used for MCP servers.
- **Development:** with `DEV_AUTH=true` (which needs a loopback `APP_URL`), private and loopback addresses are allowed and so is plain `http://` for a loopback host, so a local test server works. There is no setting to allow them in production. `make fake-mcp` runs a fake MCP server on `http://127.0.0.1:8091/mcp` (tools `check_outage`, `slow`, `huge`, `needs_input`, `broken`) for trying this locally.
- **Tool descriptions and results are untrusted.** Descriptions and schemas are shown before approval and a changed one loses its approval; results are framed as data, judged when SystemOne judging is on, and cited so readers can see where a claim came from.
- **No local servers:** Grounded only speaks Streamable HTTP; it never starts processes (stdio).

## API

OpenAPI ([`../api/openapi.yaml`](../api/openapi.yaml)), platform admins (auditors read):

- `GET`/`POST /v1/admin/mcp-servers`, `GET`/`PATCH`/`DELETE /v1/admin/mcp-servers/{serverId}`
- `POST /v1/admin/mcp-servers/{serverId}/test`, `POST /v1/admin/mcp-servers/{serverId}/refresh`
- `GET /v1/admin/mcp-servers/{serverId}/tools`, `PUT /v1/admin/mcp-servers/{serverId}/tools/{toolId}/approval`
- `GET /v1/mcp-tools` (signed-in users: the approved tools editors may choose)
- Agent configurations gain `tools` (tool IDs); citations and retrieval hits of a tool's result have `kind: "tool"`, `server` and `tool`; `GET /v1/admin/health-checks?kind=mcp_server`.
