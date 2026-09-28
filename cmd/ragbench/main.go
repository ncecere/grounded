// Command ragbench measures ingest scale and retrieval quality of a running
// Grounded against a BEIR dataset (for example FiQA-2018), through the public API.
//
// Typical run (see docs/benchmarks/scale-10k.md):
//
//	set -a && . ./ai.env && set +a          # URL, KEY, EMBEDDING_MODEL
//	ragbench setup   -base http://127.0.0.1:8081
//	ragbench upload  -data /tmp/ragbench/fiqa
//	ragbench wait
//	ragbench eval    -data /tmp/ragbench/fiqa -tag hnsw
//	ragbench dense   -data /tmp/ragbench/fiqa -dsn "$BENCH_DATABASE_URL" -vectors-out q.jsonl
//	ragbench offline -data /tmp/ragbench/fiqa -doc-prefix "" -query-prefix ""
//	ragbench stats   -dsn "$BENCH_DATABASE_URL" -blob-dir /tmp/ragbench/blobs
//
// Some gateways limit each key to a fixed number of requests per minute (the
// one used in docs/benchmarks allowed 120). "ragbench throttle" is a pacing
// proxy to put in front of such a gateway (Grounded's connection and the
// -gateway-url of dense/offline then point at the proxy).
//
// Grounded must run with DEV_AUTH=true (the tool signs in as the "admin"
// persona). The gateway key is read from the environment variable named by
// -key-env and is never printed.
package main

import (
	"fmt"
	"os"
)

const usage = `usage: ragbench <command> [flags]

commands:
  setup    sign in as the dev admin and create the model connection, embedding
           model, embedding profile, team, upload source and knowledge base
  upload   upload a BEIR corpus as one .txt document per corpus entry
  wait     poll the source until ingestion finishes; print throughput
  eval     run BEIR queries through POST /retrieve; recall@k, nDCG@k, latency
  dense    dense-only exact search over the profile table (no lexical/RRF),
           and export the query vectors for vecbench -real-table
  offline  embed corpus and queries directly through the gateway and evaluate
           in memory (for prefix ablations; does not touch Grounded)
  sweep    fusion tuning: vector + keyword-query variants x keyword weights,
           fused with Grounded's code over the stored vectors (no gateway calls
           with -query-vectors)
  urlset   the same sweep (or /retrieve with -api) for a URL-judged question
           set: questions whose answers are known pages (-eval is required)
  judge    SystemOne passage judging on sampled BEIR queries: fused vs re-rank vs
           routing vs batched (urlset -judge does the same for a URL-judged set)
  moderation  the labelled moderation set through a SystemOne model and a chat
           classifier: detection by category, false positives, latency
  citations   SystemOne citation checks on labelled claim/source pairs (supported,
           paraphrased, contradicted, unsupported): accuracy, confidence, latency
  scope    the SystemOne scope check on labelled messages (small talk, on topic,
           borderline, off topic): accuracy by threshold, latency
  stats    documents, chunks, tokens, timings, database and blob sizes
  throttle pacing reverse proxy for a rate-limited gateway (requests/min)

Run "ragbench <command> -h" for the flags of each command.
State (IDs created by setup, upload timings) is kept in -state.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	cmds := map[string]func([]string) error{
		"setup":      cmdSetup,
		"upload":     cmdUpload,
		"wait":       cmdWait,
		"eval":       cmdEval,
		"dense":      cmdDense,
		"offline":    cmdOffline,
		"stats":      cmdStats,
		"sweep":      cmdSweep,
		"urlset":     cmdURLSet,
		"judge":      cmdJudge,
		"moderation": cmdModeration,
		"citations":  cmdCitations,
		"scope":      cmdScope,
		"throttle":   cmdThrottle,
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
		fmt.Fprintln(os.Stderr, "ragbench:", err)
		os.Exit(1)
	}
}
