// Package limits implements team limits (DESIGN.md §11.1): a registry of
// limit keys, platform defaults and ceilings, per-team overrides, and the
// checks the services call.
//
// Semantics, following yoink's inheritance model:
//
//   - Every key has a platform default (nil = unlimited) and an optional
//     ceiling (nil = none). Built-in defaults below apply until a platform
//     admin changes them.
//   - A team may override a key. No override (null) inherits the default; 0
//     blocks the resource entirely. An override may not exceed the ceiling.
//   - Effective = override ?? default, capped by the ceiling (so lowering a
//     ceiling also caps existing overrides).
//
// Where limits are enforced:
//
//   - Resource caps (storage, documents, sources, knowledge bases) are
//     checked against Postgres when something is created, uploaded or
//     crawled: 409 limit_reached with details {limit, max, current}.
//   - Daily caps (crawled pages, queries) are summed from the usage ledger in
//     Postgres since UTC midnight, so a Valkey outage cannot reset them.
//   - Per-minute query rates are Valkey fixed-window counters; authenticated
//     traffic fails open when Valkey is unavailable (ADR-0015).
//   - Concurrency (crawls, ingestion jobs) is counted from live rows; chat
//     concurrency per person is a Valkey counter with a TTL.
//
// Platform-shared sources belong to no team and count against no limit.
//
// To add a limit,
// add a Key and a Def to registry below, enforce it where the resource is
// created or used, and optionally report usage in Service.TeamUsage.
package limits

import (
	"fmt"
	"strconv"
)

// Key names a limit. Keys are stable identifiers stored in the database and
// used by the API.
type Key string

// Limit keys.
const (
	StorageBytes           Key = "storage_bytes"
	Documents              Key = "documents"
	DataSources            Key = "data_sources"
	KnowledgeBases         Key = "knowledge_bases"
	CrawlPagesPerDay       Key = "crawl_pages_per_day"
	ConcurrentCrawls       Key = "concurrent_crawls"
	ConcurrentIngestJobs   Key = "concurrent_ingest_jobs"
	OCRPagesPerDay         Key = "ocr_pages_per_day"
	QueriesPerMinute       Key = "queries_per_minute"
	QueriesPerDay          Key = "queries_per_day"
	APIKeyQueriesPerMinute Key = "api_key_queries_per_minute"
	UserQueriesPerMinute   Key = "user_queries_per_minute"
	Agents                 Key = "agents"
	ChatTokensPerDay       Key = "chat_tokens_per_day"
	ConcurrentChatsPerUser Key = "concurrent_chats_per_user"
	// MCPCallsPerAnswer bounds the MCP tool calls of one answer
	// (docs/mcp-client.md); calls past it get an error the model reads.
	MCPCallsPerAnswer Key = "mcp_calls_per_answer"

	// Public agents (docs/phase4-publishing.md §7): apply per agent to
	// anonymous public-page and widget traffic.
	PublicQueriesPerIPPerMinute      Key = "public_queries_per_ip_per_minute"
	PublicQueriesPerSessionPerMinute Key = "public_queries_per_session_per_minute"
	PublicQueriesPerAgentPerDay      Key = "public_queries_per_agent_per_day"
	PublicTokensPerAgentPerDay       Key = "public_tokens_per_agent_per_day"
	PublicConcurrentChatsPerAgent    Key = "public_concurrent_chats_per_agent"
	PublicMessageMaxChars            Key = "public_message_max_chars"

	// Evaluations (docs/evaluations.md §1): enforced when a set or a
	// question is created (and before an import is added).
	EvaluationSets            Key = "evaluation_sets"
	EvaluationQuestionsPerSet Key = "evaluation_questions_per_set"
)

// Group is where a limit is shown in the UI.
type Group string

const (
	GroupResources Group = "resources"
	GroupIngestion Group = "ingestion"
	GroupQueries   Group = "queries"
	GroupPublic    Group = "public"
	// GroupEvaluations: evaluation sets and their questions (Admin → Limits ›
	// Evaluations, next to the platform switch).
	GroupEvaluations Group = "evaluations"
)

// Unit says how a value is measured.
type Unit string

const (
	UnitCount Unit = "count"
	UnitBytes Unit = "bytes"
)

// Period is the window a value counts over: none (a total or a concurrency
// level), a minute or a UTC day.
type Period string

const (
	PeriodNone   Period = ""
	PeriodMinute Period = "minute"
	PeriodDay    Period = "day"
)

// Def describes one limit key.
type Def struct {
	Key         Key
	Group       Group
	Unit        Unit
	Period      Period
	Label       string // "Data sources"
	Noun        string // plural, for messages: "data sources"
	Description string
	// Default is the built-in platform default; nil = unlimited.
	Default *int64
	// Max is a maximum built into Grounded (nil = none): no default,
	// ceiling or team value may be above it, and "unlimited" means it.
	Max *int64
}

func ptr(n int64) *int64 { return &n }

// DefaultMCPCallsPerAnswer is the built-in mcp_calls_per_answer, and
// MaxMCPCallsPerAnswer its maximum (an answer never makes more calls).
const (
	DefaultMCPCallsPerAnswer = 5
	MaxMCPCallsPerAnswer     = 25
)

const gib = int64(1) << 30

// registry lists every limit in display order. It is the only place keys
// are defined.
var registry = []Def{
	{Key: StorageBytes, Group: GroupResources, Unit: UnitBytes, Label: "Storage", Noun: "storage",
		Description: "Total size of the team's original documents (uploads and crawled pages).", Default: ptr(10 * gib)},
	{Key: Documents, Group: GroupResources, Unit: UnitCount, Label: "Documents", Noun: "documents",
		Description: "Documents across all of the team's data sources.", Default: ptr(50_000)},
	{Key: DataSources, Group: GroupResources, Unit: UnitCount, Label: "Data sources", Noun: "data sources",
		Description: "Upload and web data sources owned by the team.", Default: ptr(100)},
	{Key: KnowledgeBases, Group: GroupResources, Unit: UnitCount, Label: "Knowledge bases", Noun: "knowledge bases",
		Description: "Knowledge bases owned by the team.", Default: ptr(50)},
	{Key: Agents, Group: GroupResources, Unit: UnitCount, Label: "Agents", Noun: "agents",
		Description: "Agents owned by the team (deleted agents do not count).", Default: ptr(25)},
	{Key: CrawlPagesPerDay, Group: GroupIngestion, Unit: UnitCount, Period: PeriodDay, Label: "Crawled pages per day", Noun: "crawled pages per day",
		Description: "Web pages fetched per UTC day. Crawls that reach it wait until the next day.", Default: ptr(5_000)},
	{Key: ConcurrentCrawls, Group: GroupIngestion, Unit: UnitCount, Label: "Concurrent crawls", Noun: "concurrent crawls",
		Description: "Web source syncs running at once. Further syncs wait in the queue.", Default: ptr(2)},
	{Key: ConcurrentIngestJobs, Group: GroupIngestion, Unit: UnitCount, Label: "Concurrent ingestion jobs", Noun: "concurrent ingestion jobs",
		Description: "Documents parsed and embedded at once (fair sharing between teams).", Default: ptr(8)},
	{Key: OCRPagesPerDay, Group: GroupIngestion, Unit: UnitCount, Period: PeriodDay, Label: "OCR pages per day", Noun: "OCR pages per day",
		Description: "Scanned pages read with OCR per UTC day. Documents that would pass it wait until the next day.", Default: ptr(1_000)},
	{Key: QueriesPerMinute, Group: GroupQueries, Unit: UnitCount, Period: PeriodMinute, Label: "Queries per minute (team)", Noun: "queries per minute",
		Description: "Retrieval queries per minute across the whole team.", Default: ptr(600)},
	{Key: QueriesPerDay, Group: GroupQueries, Unit: UnitCount, Period: PeriodDay, Label: "Queries per day (team)", Noun: "queries per day",
		Description: "Retrieval queries per UTC day across the whole team.", Default: ptr(50_000)},
	{Key: APIKeyQueriesPerMinute, Group: GroupQueries, Unit: UnitCount, Period: PeriodMinute, Label: "Queries per minute (each API key)", Noun: "queries per minute for this API key",
		Description: "Retrieval queries per minute for each of the team's API keys.", Default: ptr(300)},
	{Key: UserQueriesPerMinute, Group: GroupQueries, Unit: UnitCount, Period: PeriodMinute, Label: "Queries per minute (each person)", Noun: "queries per minute for each person",
		Description: "Retrieval queries per minute for each signed-in team member.", Default: ptr(120)},
	{Key: ChatTokensPerDay, Group: GroupQueries, Unit: UnitCount, Period: PeriodDay, Label: "Chat tokens per day (team)", Noun: "chat tokens per day",
		Description: "Chat model input and output tokens per UTC day across the team's agents. Answers are refused once it is reached.", Default: ptr(2_000_000)},
	{Key: ConcurrentChatsPerUser, Group: GroupQueries, Unit: UnitCount, Label: "Concurrent chats (each person or key)", Noun: "concurrent chats",
		Description: "Answers streaming at once for each person (or service key).", Default: ptr(3)},
	{Key: MCPCallsPerAnswer, Group: GroupQueries, Unit: UnitCount, Label: "MCP tool calls per answer", Noun: "MCP tool calls per answer",
		Description: "Calls an agent may make to MCP server tools while writing one answer, at most 25 (empty means 25, 0 means no calls). Calls past it are refused and the agent answers with what it has.",
		Default:     ptr(DefaultMCPCallsPerAnswer), Max: ptr(MaxMCPCallsPerAnswer)},
	{Key: PublicQueriesPerIPPerMinute, Group: GroupPublic, Unit: UnitCount, Period: PeriodMinute, Label: "Public questions per minute (each address)", Noun: "public questions per minute from one address",
		Description: "Anonymous questions to one public agent per minute from one network address (/24 or /48).", Default: ptr(10)},
	{Key: PublicQueriesPerSessionPerMinute, Group: GroupPublic, Unit: UnitCount, Period: PeriodMinute, Label: "Public questions per minute (each visitor)", Noun: "public questions per minute from one visitor",
		Description: "Anonymous questions per minute in one visitor session.", Default: ptr(6)},
	{Key: PublicQueriesPerAgentPerDay, Group: GroupPublic, Unit: UnitCount, Period: PeriodDay, Label: "Public questions per agent per day", Noun: "public questions per day",
		Description: "Anonymous questions to each public agent per UTC day, from the usage ledger.", Default: ptr(5_000)},
	{Key: PublicTokensPerAgentPerDay, Group: GroupPublic, Unit: UnitCount, Period: PeriodDay, Label: "Public chat tokens per agent per day", Noun: "public chat tokens per day",
		Description: "Chat model tokens of anonymous answers for each public agent per UTC day.", Default: ptr(2_000_000)},
	{Key: PublicConcurrentChatsPerAgent, Group: GroupPublic, Unit: UnitCount, Label: "Public concurrent chats per agent", Noun: "concurrent public chats",
		Description: "Anonymous answers streaming at once for each public agent.", Default: ptr(20)},
	{Key: PublicMessageMaxChars, Group: GroupPublic, Unit: UnitCount, Label: "Public message length", Noun: "characters",
		Description: "The longest question an anonymous visitor may send, in characters.", Default: ptr(2_000)},
	{Key: EvaluationSets, Group: GroupEvaluations, Unit: UnitCount, Label: "Evaluation sets", Noun: "evaluation sets",
		Description: "Evaluation sets across the team's knowledge bases and agents.", Default: ptr(50)},
	{Key: EvaluationQuestionsPerSet, Group: GroupEvaluations, Unit: UnitCount, Label: "Questions per evaluation set", Noun: "questions in this set",
		Description: "Test questions in one evaluation set, typed or imported.", Default: ptr(500)},
}

// Defs returns every limit definition in display order.
func Defs() []Def { return append([]Def(nil), registry...) }

// Lookup returns the definition of key.
func Lookup(k Key) (Def, bool) {
	for _, d := range registry {
		if d.Key == k {
			return d, true
		}
	}
	return Def{}, false
}

// Format renders an amount of this limit for people: "10 GiB", "100 data sources".
func (d Def) Format(n int64) string {
	if d.Unit == UnitBytes {
		return FormatBytes(n)
	}
	return strconv.FormatInt(n, 10) + " " + d.Noun
}

// FormatBytes renders a byte count with binary units.
func FormatBytes(n int64) string {
	units := []string{"B", "KiB", "MiB", "GiB", "TiB", "PiB"}
	v, i := float64(n), 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	if i == 0 {
		return fmt.Sprintf("%d B", n)
	}
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d %s", int64(v), units[i])
	}
	return fmt.Sprintf("%.1f %s", v, units[i])
}
