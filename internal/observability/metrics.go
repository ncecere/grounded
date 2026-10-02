package observability

import (
	"runtime"
	"time"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/ncecere/grounded/internal/buildinfo"
)

// Application metrics shared by the packages that record them. They are
// package-level so that a service needs no wiring to record one; NewMetrics
// registers them all in the process registry (docs/operations/monitoring.md
// lists them).
//
// Labels are low-cardinality by rule: route patterns, channels, kinds,
// outcomes and admin-named connections, never team, user, agent, document
// or conversation IDs.

// Latency buckets.
var (
	// fastBuckets suit database-bound work (retrieval, a moderation check).
	fastBuckets = []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}
	// modelBuckets suit model calls and answers (seconds to minutes).
	modelBuckets = []float64{.05, .1, .25, .5, 1, 2, 5, 10, 20, 30, 60, 120, 300}
	// jobBuckets suit background jobs (a crawl runs for minutes).
	jobBuckets = []float64{.01, .05, .1, .5, 1, 5, 15, 60, 300, 900, 1800, 3600}
)

var (
	// BuildInfo is 1, labelled with the binary's version and the process
	// mode (serve, api or worker); SetBuildInfo sets it.
	BuildInfo = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "grounded_build_info",
		Help: "Always 1: the version, commit, Go version and process mode (serve, api, worker).",
	}, []string{"version", "commit", "goversion", "mode"})

	// ChatAnswers counts finished answers by channel and outcome (ok,
	// no_answer, moderated, model_busy, aborted, error).
	ChatAnswers = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_chat_answers_total",
		Help: "Chat answers by channel (ui, api, openai, public, widget, mcp, test) and outcome.",
	}, []string{"channel", "outcome"})
	ChatFirstToken = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_chat_first_token_seconds",
		Help:    "Time from the question to the answer's first streamed token, by channel.",
		Buckets: modelBuckets,
	}, []string{"channel"})
	ChatDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_chat_duration_seconds",
		Help:    "Time from the question to the end of the answer, by channel.",
		Buckets: modelBuckets,
	}, []string{"channel"})

	// RetrievalDuration times one hybrid search over one knowledge base
	// (query embedding, vector and keyword search, fusion).
	RetrievalDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_retrieval_duration_seconds",
		Help:    "Hybrid search over one knowledge base, by outcome (ok, error).",
		Buckets: fastBuckets,
	}, []string{"outcome"})

	// ModelRequests counts requests to model connections; see ModelObserver.
	ModelRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_model_requests_total",
		Help: "Requests to model connections by connection name, model kind and outcome (ok, rate_limited, throttled, unavailable, auth, not_found, bad_request, bad_response, canceled).",
	}, []string{"connection", "kind", "outcome"})
	ModelRequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_model_request_duration_seconds",
		Help:    "Model request latency (to the response headers for streams) by connection name and model kind.",
		Buckets: modelBuckets,
	}, []string{"connection", "kind"})

	SystemOneRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_systemone_requests_total",
		Help: "SystemOne requests by feature (moderation, judging, citations, scope, test) and outcome (ok, timeout, error).",
	}, []string{"feature", "outcome"})
	SystemOneDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_systemone_request_duration_seconds",
		Help:    "SystemOne request latency by feature, after a concurrency slot is free.",
		Buckets: modelBuckets,
	}, []string{"feature"})

	// RerankRequests counts searches' /rerank calls (docs/v0.4.0.md §3);
	// timeout and error kept the fusion order (fail open).
	RerankRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_rerank_requests_total",
		Help: "Rerank calls by caller (agent, retrieve, evaluation) and status (ok, timeout, error, skipped).",
	}, []string{"caller", "status"})
	RerankDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_rerank_duration_seconds",
		Help:    "Rerank call latency by caller, bounded by the platform's rerank time limit.",
		Buckets: modelBuckets,
	}, []string{"caller"})

	ModerationDecisions = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_moderation_decisions_total",
		Help: "Moderation checks by stage (input, output) and decision (pass, flag, block, support, error).",
	}, []string{"stage", "decision"})
	// ModerationFirstRelease is how long after the question an answer
	// streamed in checked paragraphs (docs/v0.4.0.md §4) showed its first
	// paragraph; ModerationChunkChecks counts that mode's checks by
	// decision.
	ModerationFirstRelease = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_moderation_first_release_seconds",
		Help:    "Time from the question to the first checked paragraph of an answer streamed in checked paragraphs, by channel.",
		Buckets: modelBuckets,
	}, []string{"channel"})
	ModerationChunkChecks = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_moderation_paragraph_checks_total",
		Help: "Output checks of answers streamed in checked paragraphs (one per paragraph, of the text so far), by decision.",
	}, []string{"decision"})

	JobsWorked = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_jobs_worked_total",
		Help: "Background jobs worked by kind and outcome (ok, error, snoozed, cancelled, panic).",
	}, []string{"kind", "outcome"})
	JobDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_job_duration_seconds",
		Help:    "Background job run time by kind.",
		Buckets: jobBuckets,
	}, []string{"kind"})

	IngestDocuments = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_ingest_documents_total",
		Help: "Documents processed by the ingest pipeline by outcome (indexed, failed, skipped, retried, deferred, parked, superseded).",
	}, []string{"outcome"})
	IngestDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "grounded_ingest_document_duration_seconds",
		Help:    "Time to parse, chunk, embed and index one document.",
		Buckets: jobBuckets,
	})
	EmbeddingBatchInputs = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "grounded_embedding_batch_inputs",
		Help:    "Inputs per embedding request sent by the ingest pipeline.",
		Buckets: []float64{1, 2, 4, 8, 16, 32, 64, 128, 256},
	})

	CrawlPages = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_crawl_pages_total",
		Help: "Crawled frontier URLs by result (done, failed, skipped).",
	}, []string{"result"})
	CrawlFetchDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "grounded_crawl_fetch_duration_seconds",
		Help:    "Time to fetch one crawled page.",
		Buckets: fastBuckets,
	})

	BreakGlassSessions = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_breakglass_sessions_total",
		Help: "Break-glass session transitions by the status reached (pending, active, ended, cancelled, denied, expired, request_expired).",
	}, []string{"status"})
	BreakGlassReads = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_breakglass_reads_total",
		Help: "Audited reads under break-glass sessions by read kind.",
	}, []string{"kind"})

	// MCPToolCalls counts the MCP server's tool calls (docs/mcp.md).
	MCPToolCalls = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_mcp_tool_calls_total",
		Help: "MCP server tool calls by tool (search, ask) and outcome (ok, refused, error).",
	}, []string{"tool", "outcome"})
	// MCPClientCalls counts the tool calls agents make to registered MCP
	// servers (docs/mcp-client.md). Server and tool names are admin-bounded:
	// only approved tools of registered servers are called.
	MCPClientCalls = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_mcp_client_calls_total",
		Help: "Agents' calls to MCP server tools by server, tool and outcome (ok, tool_error, refused, timeout, too_large, error).",
	}, []string{"server", "tool", "outcome"})
	MCPClientCallDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_mcp_client_call_duration_seconds",
		Help:    "Latency of agents' calls to MCP server tools, by server and tool.",
		Buckets: modelBuckets,
	}, []string{"server", "tool"})
	// HealthChecks counts stored health checks (docs/operations/health.md)
	// by subject kind, trigger (manual, scheduled) and status (healthy,
	// failing); grounded_health_failing (state.go) is the current state.
	HealthChecks = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_health_checks_total",
		Help: "Stored health checks of connections, models and MCP servers by subject kind, trigger (manual, scheduled) and status (healthy, failing).",
	}, []string{"kind", "trigger", "status"})
	HealthCheckDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grounded_health_check_duration_seconds",
		Help:    "Latency of the test behind a stored health check, by subject kind.",
		Buckets: modelBuckets,
	}, []string{"kind"})

	// GapQuestions counts failed questions kept for the gap report
	// (docs/gaps.md) by signal; GapTopicChanges the topics job's work.
	GapQuestions = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_gap_questions_total",
		Help: "Failed questions kept for the gap report by signal (no_context, refused, judged_out, out_of_scope, unsupported, uncited, thumbs_down).",
	}, []string{"signal"})
	GapTopicChanges = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_gap_topic_changes_total",
		Help: "The gap topics job's work by kind (embedded, assigned, new_topic, merged, confirmed, reopened, resolved, labelled, pruned).",
	}, []string{"kind"})

	// AnswerCacheLookups counts the answer cache's lookups
	// (docs/answer-cache.md): hits by match (exact, near) and misses by
	// reason; AnswerCacheTokensSaved the model tokens hits didn't spend.
	// grounded_answer_cache_entries (state.go) is the live entries.
	AnswerCacheLookups = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_answer_cache_lookups_total",
		Help: "Answer cache lookups by result (hit, miss) and reason (exact, near; no_entry, near_rejected, follow_up, error).",
	}, []string{"result", "reason"})
	AnswerCacheTokensSaved = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "grounded_answer_cache_tokens_saved_total",
		Help: "Model tokens the original answers spent that answers served from the cache did not spend again.",
	})

	ValkeyErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "grounded_valkey_errors_total",
		Help: "Valkey commands and dials that failed (a missing key is not an error), by command.",
	}, []string{"command"})
)

// appCollectors are registered by NewMetrics.
func appCollectors() []prometheus.Collector {
	return []prometheus.Collector{
		BuildInfo, ChatAnswers, ChatFirstToken, ChatDuration, RetrievalDuration,
		ModelRequests, ModelRequestDuration, SystemOneRequests, SystemOneDuration, RerankRequests, RerankDuration, ModerationDecisions,
		ModerationFirstRelease, ModerationChunkChecks,
		JobsWorked, JobDuration, IngestDocuments, IngestDuration, EmbeddingBatchInputs,
		CrawlPages, CrawlFetchDuration, BreakGlassSessions, BreakGlassReads, MCPToolCalls, MCPClientCalls, MCPClientCallDuration, HealthChecks, HealthCheckDuration,
		GapQuestions, GapTopicChanges, AnswerCacheLookups, AnswerCacheTokensSaved, ValkeyErrors,
	}
}

// SetBuildInfo records the binary's version and the process mode.
func SetBuildInfo(mode string) {
	BuildInfo.Reset()
	BuildInfo.WithLabelValues(buildinfo.Version, buildinfo.Commit, runtime.Version(), mode).Set(1)
}

// ObserveChat records a finished answer. firstToken is 0 when nothing was
// streamed.
func ObserveChat(channel, outcome string, total, firstToken time.Duration) {
	ChatAnswers.WithLabelValues(channel, outcome).Inc()
	ChatDuration.WithLabelValues(channel).Observe(total.Seconds())
	if firstToken > 0 {
		ChatFirstToken.WithLabelValues(channel).Observe(firstToken.Seconds())
	}
}

// ObserveRetrieval records one knowledge-base search.
func ObserveRetrieval(d time.Duration, err error) {
	RetrievalDuration.WithLabelValues(outcome(err)).Observe(d.Seconds())
}

// ModelObserver returns the function a gateway client calls after each
// request to a model connection (connection is the admin-given name, kind the
// model kind). Requests the connection's own limit refused (throttled) were
// never sent, so they have no latency.
func ModelObserver(connection, kind string) func(outcome string, elapsed time.Duration) {
	return func(outcome string, elapsed time.Duration) {
		ModelRequests.WithLabelValues(connection, kind, outcome).Inc()
		if outcome != "throttled" {
			ModelRequestDuration.WithLabelValues(connection, kind).Observe(elapsed.Seconds())
		}
	}
}

// ObserveSystemOne records one SystemOne request (outcome ok, timeout or
// error).
func ObserveSystemOne(feature, outcome string, d time.Duration) {
	SystemOneRequests.WithLabelValues(feature, outcome).Inc()
	SystemOneDuration.WithLabelValues(feature).Observe(d.Seconds())
}

// ObserveRerank records one search's rerank call (status ok, timeout,
// error or skipped; a skipped search sent nothing).
func ObserveRerank(caller, status string, d time.Duration) {
	RerankRequests.WithLabelValues(caller, status).Inc()
	if status != "skipped" {
		RerankDuration.WithLabelValues(caller).Observe(d.Seconds())
	}
}

// ObserveMCPClientCall records an agent's call to an MCP server tool.
func ObserveMCPClientCall(server, tool, outcome string, d time.Duration) {
	MCPClientCalls.WithLabelValues(server, tool, outcome).Inc()
	MCPClientCallDuration.WithLabelValues(server, tool).Observe(d.Seconds())
}

// ObserveHealthCheck records a stored health check.
func ObserveHealthCheck(kind, trigger, status string, d time.Duration) {
	HealthChecks.WithLabelValues(kind, trigger, status).Inc()
	HealthCheckDuration.WithLabelValues(kind).Observe(d.Seconds())
}

func outcome(err error) string {
	if err != nil {
		return "error"
	}
	return "ok"
}
