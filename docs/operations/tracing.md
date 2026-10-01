# Tracing

Grounded can send OpenTelemetry traces to a trace store such as Grafana Tempo or Jaeger. One answer is one trace: the HTTP request, retrieval (the query embedding, vector and full-text search, fusion), SystemOne checks, the agent loop's turns, model calls and tool calls, including calls to MCP servers. Trace context travels over HTTP and through MCP `_meta`, in both directions, and into background jobs.

Tracing is **off** unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. When it's off, nothing is installed: the tracer is OpenTelemetry's no-op, no exporter or background goroutine runs, and Grounded neither reads nor writes `traceparent` headers.

Spans never hold prompts, questions, answers, passages, document text, tool arguments or results, or people's email addresses. See [What's recorded](#whats-recorded).

## Turning it on

Point Grounded at an OTLP receiver and restart the api and worker:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.monitoring.svc:4318
```

On Kubernetes, add `components/tracing` to your overlay. It sets this endpoint in `grounded-config` and adds a NetworkPolicy that lets api and worker pods reach TCP 4318 and 4317 in the `monitoring` namespace. Patch the endpoint, and the namespace if yours is different ([`kubernetes.md`, Components](../deployments/kubernetes.md#components)). For Docker Compose or a single binary, set the variables in the environment or the YAML config file (keys in lower case, as for every setting).

At start-up the process logs `tracing on` with the endpoint, protocol and sampler. The headers aren't logged.

## Settings

| Variable | Default | Notes |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (empty: off) | Base URL of the OTLP receiver, `http://` or `https://`. Over HTTP, spans go to `<endpoint>/v1/traces`. Over gRPC, only the scheme, host and port are used; `http://` means no TLS. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | `http/protobuf` (port 4318) or `grpc` (port 4317). `http/json` isn't supported. |
| `OTEL_EXPORTER_OTLP_HEADERS` | (none) | Headers for every export, such as `Authorization=Bearer%20<token>` or `X-Scope-OrgID=tenant-1`. Separate headers with commas, and URL-encode the values. Secret: it can also come from a file (`OTEL_EXPORTER_OTLP_HEADERS_FILE`). It's never logged, and configuration errors don't quote it. On Kubernetes, put it in the `grounded-runtime` Secret. |
| `OTEL_SERVICE_NAME` | `grounded` | The `service.name` of every span. |
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` | One of `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off`, `parentbased_traceidratio`. |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | The share of new traces to keep for the `traceidratio` samplers, from 0 to 1. |

Invalid values stop the process at start-up, as with any other setting.

The OpenTelemetry SDK also reads a few variables from the environment (not from the YAML file): `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_COMPRESSION`, `OTEL_EXPORTER_OTLP_CERTIFICATE` (a CA for a private collector), `OTEL_RESOURCE_ATTRIBUTES` (for example `deployment.environment=staging`), and the batch processor's `OTEL_BSP_*` limits.

Every span carries the resource attributes `service.name`, `service.version` (the build's version), `grounded.commit`, and `grounded.mode` (`serve`, `api` or `worker`).

## Sampling

By default Grounded keeps every new trace (ratio `1.0`) and follows the caller's decision when a request arrives with a `traceparent`. That default suits most installs: an answer produces a few dozen spans. On a busy install, keep a share of traces instead, for example `OTEL_TRACES_SAMPLER_ARG=0.1` for one answer in ten. `components/tracing` sets `0.2`.

With a `parentbased_*` sampler, a caller that sends `traceparent` decides whether its request is sampled. Signed-in people and API keys are trusted with that decision. Public agent and widget routes (`/v1/public/…`, `/embed/…`, `/widget.js`) are open to anonymous visitors, so they ignore incoming trace context and always start a new trace, sampled by the ratio. An anonymous caller can't make Grounded record every request, or hide one. A request to another route may still carry a sampled `traceparent` before it's authenticated. It produces at most one span for the refused request.

Health checks and `/metrics` (`/healthz`, `/readyz`, `/metrics`) aren't traced.

## What's traced

One chat answer, as Tempo or Jaeger shows it (a SystemOne-judged answer; a tool-using agent adds `execute_tool` spans):

```
POST /v1/agents/{team}/{agent}/chat
  agent.answer
    agent.retrieve
      retrieval.search                     (one per knowledge base)
        embeddings text-embedding-3-small
          (the gateway continues the trace if it's traced)
        retrieval.vector
        retrieval.lexical
        retrieval.fusion
      rerank                               (when the platform has a rerank model)
        rerank bge-reranker-v2-m3
      systemone judging                    (one per judged passage or batch)
    agent.turn
      chat gpt-4o                          (a streamed model call)
      execute_tool check_outage
        tools/call check_outage            (the MCP client)
          HTTP POST                        (each exchange with the MCP server)
    agent.turn
      chat gpt-4o
```

| Span | Kind | Attributes |
|---|---|---|
| HTTP request, named by route pattern (`POST /v1/agents/{team}/{agent}/chat`, never the raw path) | server | `http.request.method`, `http.route`, `http.response.status_code`, `grounded.request_id` (also in the request's log line and the `X-Request-ID` response header) |
| `agent.answer` | internal | `grounded.team_id`, `grounded.agent_id`, `grounded.agent_version`, `grounded.channel` (`ui`, `api`, `openai`, `public`, `widget`, `mcp`, `test`) |
| `agent.retrieve` | internal | number of knowledge bases, whether judging is on, number of passages kept |
| `retrieval.search`, `retrieval.vector`, `retrieval.lexical`, `retrieval.fusion` | internal | `grounded.kb_id`, `grounded.team_id`, `top_k`, candidates, results, fusion weights, embedding tokens |
| `chat <model>`, `embeddings <model>` | client | `gen_ai.operation.name`, `gen_ai.request.model` (the upstream model ID), `gen_ai.usage.input_tokens` and `output_tokens`, for streams `grounded.llm.time_to_first_token_ms` and the stop reason, the number of tools offered, the number of inputs in an embedding batch |
| `rerank` | internal | the caller (`agent`, `retrieve`, `evaluation`), number of candidates, the time limit, the status (`ok`, `timeout`, `error`) and number of passages kept |
| `rerank <model>` | client | `gen_ai.operation.name` `rerank`, `gen_ai.request.model`, number of documents, input tokens |
| `systemone <feature>` | client | the feature (`judging`, `citations`, `scope`, `moderation`, `test`), the SystemOne model, number of questions, input tokens |
| `moderation.paragraph` | internal | an answer streamed in checked paragraphs ([`../moderation-streaming.md`](../moderation-streaming.md)): one per check, with the paragraph's number, the length of the text checked and the decision |
| `agent.turn` | internal | turn number, whether it's the final turn (no tools), stop reason, number of tool calls |
| `execute_tool <tool>` | internal | `gen_ai.tool.name` (`search_knowledge`, or an MCP tool's name as the model sees it) |
| `tools/call <tool>` | client | `mcp.method.name`, `gen_ai.tool.name`, `grounded.mcp.server` (its name in the registry), `grounded.mcp.server_id`, the outcome, the result's size in bytes |
| `HTTP <method>` | client | `http.request.method`, `server.address` (host only), `http.response.status_code`. For MCP servers and the crawler, one span per exchange |
| `tools/call search`, `tools/call ask`, `tools/list`, … | server | Grounded's own MCP server (`POST /mcp`): `mcp.method.name`, `gen_ai.tool.name` |
| `job <kind>` | consumer | a River job: `grounded.job.kind`, `queue`, `attempt`, `id`, the outcome |

A failed span has status Error and an `error.type`: a gateway error kind (`rate_limited`, `unavailable`, …), an HTTP status, an outcome such as `timeout`, or the error's Go type. The error message isn't recorded, because it can quote input.

## What's recorded

Recorded: IDs (team, agent, knowledge base, MCP server, request, job), names an admin chose in the catalog (models, MCP servers and their tools), route patterns, counts, sizes, token counts, durations, outcomes and error classes.

Never recorded: the question, the rewritten query, the answer, prompts and system prompts, passages and document text, tool arguments and results, MCP `_meta` other than trace context, URLs with their paths and queries, API keys and headers, and people's names or email addresses. A test answers a question through the full pipeline and checks that no span contains any of its words, the answer or a passage.

## Trace context

Grounded uses W3C Trace Context (`traceparent`, `tracestate`). Baggage isn't propagated, because it could carry personal data between systems.

- **Incoming HTTP:** a request's `traceparent` continues the caller's trace (except on public routes, see [Sampling](#sampling)).
- **Model gateways:** chat, embedding, moderation and SystemOne requests carry `traceparent`, so a traced proxy (LiteLLM, an OpenTelemetry-instrumented gateway) can join the trace.
- **MCP server (`POST /mcp`):** per the MCP `2026-07-28` revision, a request's `params._meta.traceparent` (and `tracestate`) continues the caller's trace. The MCP span is then a child of the caller's span and links to the HTTP request's span. If the client also sent a `traceparent` header for the same trace, the MCP span stays under the HTTP span. The Go SDK (v1.8) passes `_meta` through but doesn't handle trace context itself; Grounded reads it in a receiving middleware.
- **MCP client (agents' tools):** each request to an MCP server carries the trace context in `params._meta` and in the HTTP `traceparent` header.
- **Crawler:** requests to web sites get client spans but no `traceparent`, so web sites never see Grounded's trace IDs.
- **Jobs:** a job enqueued during a traced request carries the trace context in its River metadata (`traceparent`, `tracestate`). Its `job <kind>` span continues that trace, even when the job runs later or on another worker. Retries continue it too. Periodic jobs (`ingest.dispatch` every few seconds, sweeps, schedules) aren't traced, because each run would make a trace. The jobs they enqueue, such as each document's processing (`ingest.document`) or a scheduled crawl, start their own traces.

## Logs and traces

Log lines written during a traced request or job carry `trace_id` and `span_id` next to `request_id`:

```json
{"time":"…","level":"INFO","msg":"http request","mode":"api","method":"POST","route":"POST /v1/agents/{team}/{agent}/chat","status":200,"request_id":"k3J…","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7"}
```

Only sampled traces add the fields, so every `trace_id` in the logs can be opened in the trace store. In Grafana, add a derived field to the Loki data source: name `TraceID`, regex `"trace_id":"(\w+)"`, and an internal link to the Tempo data source with the query `${__value.raw}`. In the other direction, Tempo's "Trace to logs" setting with the Loki data source and the filter `trace_id` finds a trace's log lines.

## Examples

### Grafana Tempo

Tempo receives OTLP when its distributor enables the receiver:

```yaml
distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: 0.0.0.0:4318
        grpc:
          endpoint: 0.0.0.0:4317
```

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.monitoring.svc:4318
# Multi-tenant Tempo (or Grafana Cloud through a gateway):
OTEL_EXPORTER_OTLP_HEADERS=X-Scope-OrgID=grounded
```

With a Grafana Alloy or OpenTelemetry Collector agent in front of Tempo, point Grounded at the agent instead. For example, `http://alloy.monitoring.svc:4318` with an `otelcol.receiver.otlp` component.

### Jaeger

Jaeger accepts OTLP directly. For a local trial:

```sh
docker run --rm --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:latest
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_SERVICE_NAME=grounded-dev ./bin/grounded serve
```

Ask a question, then open `http://127.0.0.1:16686` and search for the service `grounded-dev`. The HTTP API returns the same data: `curl 'http://127.0.0.1:16686/api/traces?service=grounded-dev&limit=5'`.

## Overhead and failures

Spans are batched: every 5 seconds or 512 spans, with at most 2,048 waiting (the SDK's defaults, `OTEL_BSP_*`). If the collector is unreachable, spans are dropped once the queue is full, and a warning is logged at most once a minute. Answers never wait for the collector. At shutdown, buffered spans get 5 seconds to flush after the servers and the worker have stopped.

Tracing costs little CPU next to model calls. The exporters add about 3.5 MB to the binary. The gRPC exporter adds only about 0.2 MB, because the OTLP protobuf packages already link gRPC.

## Not yet

- Trace links from the Grafana dashboards and metric exemplars.
- Per-stage timings in the product itself (roadmap F1's "for admins"): today they're in the trace store.
- Grounded's MCP server doesn't name tools the client made up: a `tools/call` for an unknown tool is recorded as `tools/call unknown`.
