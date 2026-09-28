// Command sparkbench compares self-hosted models (the owner's DGX Spark:
// qwen3-embedding-4b and qwen3.8-27b) with an OpenAI-compatible AI gateway's models
// (nomic-embed-text-v1.5 and gpt-oss-120b) for Grounded. It is measurement code:
// it reads Grounded databases (and creates scratch tables only in the benchmark
// database, for the storage command), never writes Grounded's own tables and
// never changes Grounded. Results are in docs/benchmarks/spark-models.md.
//
// Endpoints come from the environment (set -a && . ./ai.env && set +a):
//
//	gateway:   URL, KEY, EMBEDDING_MODEL, LLM_MODEL
//	spark:     SPARK_EMBEDDING_URL/_KEY/_MODEL, SPARK_LLM_URL/_KEY/_MODEL
//	judge:     SPARK_SYSTEMONE_URL/_KEY/_MODEL (TypeSafe-compatible /v1/systemone)
//
// Keys are read from the environment only and never printed. /v1 is
// appended to base URLs when missing.
package main

import (
	"fmt"
	"os"
)

const usage = `usage: sparkbench <command> [flags]

commands:
  embed-probe  embedding endpoint: dimensions, norm, Matryoshka "dimensions"
               support, maximum input, throughput at several batch sizes
  retrieval    FiQA (10k-document grounded_bench KB) or a URL-judged set (urlset):
               vector-only and hybrid (Grounded's fusion) nDCG/recall/MRR for the
               stored nomic vectors and qwen3 vectors of the same chunks, with
               query-instruction and truncated-dimension variants
  storage      scratch halfvec tables for 768/1024/2560 dims in the benchmark
               database: table and index size, exact and HNSW search latency
  chat-probe   chat endpoint behaviour: streaming, reasoning fields, usage in
               the final chunk, tool calls, tool_choice, token limits; records
               SSE fixtures
  answer       answer a URL-judged set with Grounded's system prompt and the top
               6 chunks (exact search over the stored nomic vectors); latency,
               tokens, citations, refusals (JSONL out)
  judge        grade answer files with SystemOne (correct/partially/incorrect
               against the expected page) and print the comparison tables
  replay       parse recorded SSE streams with Grounded's own provider
               (internal/llm) to check compatibility offline

Run "sparkbench <command> -h" for the flags of each command.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	cmds := map[string]func([]string) error{
		"embed-probe": cmdEmbedProbe,
		"retrieval":   cmdRetrieval,
		"storage":     cmdStorage,
		"chat-probe":  cmdChatProbe,
		"answer":      cmdAnswer,
		"judge":       cmdJudge,
		"replay":      cmdReplay,
	}
	name := os.Args[1]
	if name == "-h" || name == "--help" || name == "help" {
		fmt.Print(usage)
		return
	}
	fn, ok := cmds[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", name, usage)
		os.Exit(2)
	}
	if err := fn(os.Args[2:]); err != nil {
		fmt.Fprintln(os.Stderr, "sparkbench:", err)
		os.Exit(1)
	}
}
