#!/usr/bin/env bash
# Load tests (docs/benchmarks/load.md): prepares an install and runs the k6
# scenarios with the official grafana/k6 image (pinned by digest; nothing to
# install but docker).
#
#   deploy/loadtest/run.sh [scenario ...]    # default: chat retrieve openai ingest mixed
#
# TARGET=kind (default) builds the image from the working tree, creates a
# throwaway kind cluster running deploy/kubernetes/test/load (the
# example-small shape: 2 api, 2 worker, single Postgres and Valkey, an S3
# test server, and `grounded demo --serve-fake-models`), runs everything,
# samples per-pod CPU and Postgres connections, reads the server-side
# figures from Postgres, and deletes the cluster (KEEP=1 keeps it).
#
# TARGET=url runs against an install you already have, at BASE_URL as the
# k6 container sees it (for example http://host.docker.internal:8128). It
# needs DEV_AUTH (setup signs in as the development admin) and the demo's
# fake models (`grounded demo --serve-fake-models --fake-word-delay 20ms`).
# Set PSQL to a command that runs psql against its database (for example
# "docker exec -i grounded-postgres-1 psql -U grounded -d grounded_load") for
# the server-side figures. Never point it at an install people use.
#
# KEEP=1 keeps the cluster; REUSE=1 KUBECONFIG_FILE=<its kubeconfig> runs on
# it again (no rebuild). APP_HOST is APP_URL's host (localhost:8080 on kind).
#
# Settings: SEED_DOCS (1000), CHAT_WORD_DELAY (20ms; scenarios chat and
# openai), MIXED_WORD_DELAY (80ms: an answer streams for about 14 s, like
# the one-GPU model), RESULTS (deploy/loadtest/results/<time>), INGEST_JOBS
# (the team's concurrent_ingest_jobs; default: the platform's), and each
# script's own variables (LEVELS, HOLD, DOCS, DURATION, ...), passed through.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "${here}/../.." && pwd)"
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34}"
TARGET="${TARGET:-kind}"
SEED_DOCS="${SEED_DOCS:-1000}"
CHAT_WORD_DELAY="${CHAT_WORD_DELAY:-20ms}"
MIXED_WORD_DELAY="${MIXED_WORD_DELAY:-80ms}"
run_id="$(date -u +%Y%m%dT%H%M%SZ)"
results="${RESULTS:-${here}/results/${run_id}}"
scenarios=("$@")
[ ${#scenarios[@]} -gt 0 ] || scenarios=(chat retrieve openai ingest mixed)
mkdir -p "$results"
chmod 777 "$results" # the k6 image runs as its own user
docker_network=()
sampler=""

if [ "$TARGET" = kind ]; then
  # shellcheck source=../kubernetes/scripts/kind-lib.sh
  . "${repo}/deploy/kubernetes/scripts/kind-lib.sh"
  BASE_URL="$(kind_url)"
  docker_network=(--network kind)
  PSQL_FN=psql_q
elif [ "$TARGET" = url ]; then
  : "${BASE_URL:?set BASE_URL for TARGET=url}"
  PSQL_FN=psql_cmd
else
  echo "TARGET must be kind or url" >&2
  exit 2
fi

psql_cmd() {
  if [ -z "${PSQL:-}" ]; then return 1; fi
  # shellcheck disable=SC2086
  $PSQL -X -q -v ON_ERROR_STOP=1 -At -F ' | ' "$@"
}

cleanup() {
  status=$?
  if [ -n "$sampler" ]; then kill "$sampler" 2>/dev/null || true; wait "$sampler" 2>/dev/null || true; fi
  if [ "$TARGET" = kind ]; then
    if [ "$status" -ne 0 ] && [ -s "$kubeconfig" ]; then kind_diagnostics; fi
    kind_down
  fi
  echo "results: ${results}"
  exit "$status"
}
trap cleanup EXIT

# Passes the scripts' own variables through to k6.
k6_env=()
for v in LEVELS HOLD FOLLOW_UP TARGET_CONCURRENCY TTFT_P95_MS RETRIEVE_P95_MS RETRIEVE_P95_UP_TO DOCS BATCH UPLOADERS \
  TARGET_CHUNKS_PER_S DURATION CHAT_VUS RETRIEVE_RATE OPENAI_RATE UPLOAD_EVERY BROWSE_RATE BROWSE_P95_MS SEED INGEST_JOBS APP_HOST RAMP; do
  if [ -n "${!v:-}" ]; then k6_env+=(-e "${v}=${!v}"); fi
done

k6() { # script [k6 args...]; a failed threshold (exit 99) is reported, not fatal
  local script="$1"
  shift
  local rc=0
  docker run --rm ${docker_network[@]+"${docker_network[@]}"} -v "${here}:/scripts:ro" -v "${results}:/results" \
    "$K6_IMAGE" run --quiet -e BASE_URL="$BASE_URL" -e RUN_ID="$run_id" ${k6_env[@]+"${k6_env[@]}"} "$@" "/scripts/${script}" \
    >"${results}/${script%.js}.log" 2>&1 || rc=$?
  if [ "$rc" -eq 99 ]; then
    echo "(thresholds failed; see ${results}/${script%.js}.log)"
  elif [ "$rc" -ne 0 ]; then
    tail -n 30 "${results}/${script%.js}.log" >&2
    return "$rc"
  fi
}

# sample_start writes per-pod CPU/memory and Postgres connection counts every
# 10 s to $1 until sample_stop.
sample_start() {
  [ "$TARGET" = kind ] || return 0
  (
    while true; do
      ts="$(date -u +%H:%M:%S)"
      kc top pods --no-headers 2>/dev/null | awk -v ts="$ts" '{print ts, "pod", $1, $2, $3}' || true
      psql_q -c "SELECT state, count(*) FROM pg_stat_activity WHERE datname = 'grounded' GROUP BY state" 2>/dev/null |
        awk -v ts="$ts" '{print ts, "pg", $0}' || true
      sleep 10
    done
  ) >"$1" 2>/dev/null &
  sampler=$!
}
sample_stop() {
  [ -n "$sampler" ] || return 0
  kill "$sampler" 2>/dev/null || true
  wait "$sampler" 2>/dev/null || true
  sampler=""
  # Peak CPU and memory per pod (replica suffixes kept), and peak connections.
  echo "peak per pod (CPU millicores, memory MiB):"
  awk '$2 == "pod" { cpu = $4 + 0; mem = $5 + 0; if (cpu > c[$3]) c[$3] = cpu; if (mem > m[$3]) m[$3] = mem }
       END { for (p in c) printf "  %-48s %6dm %6dMi\n", p, c[p], m[p] }' "$1" | sort
  awk '$2 == "pg" { split($0, f, " \\| "); n = f[2] + 0; s = $3; if (n > pg[s]) pg[s] = n }
       END { for (s in pg) printf "  postgres connections %-24s peak %d\n", s, pg[s] }' "$1" | sort
}

# answers_sql prints the server's own figures for answers since $1 (UTC).
answers_sql() {
  "$PSQL_FN" -c "
    SELECT channel, count(*),
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms)) AS ttft_p50,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms)) AS ttft_p95,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)) AS total_p50,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)) AS total_p95,
      count(*) FILTER (WHERE error_code <> '') AS errors,
      coalesce(string_agg(DISTINCT nullif(error_code, ''), ','), '') AS codes
    FROM message_events WHERE created_at >= '$1' GROUP BY channel ORDER BY channel" 2>/dev/null |
    { echo "server-side answers (channel | answers | TTFT p50 | TTFT p95 | total p50 | total p95 ms | errors | codes):"; sed 's/^/  /'; } ||
    echo "(no server-side figures: set PSQL)"
}

# ingest_sql prints documents/min and chunks/s for documents named $1*.
ingest_sql() {
  "$PSQL_FN" -c "
    SELECT count(*), count(*) FILTER (WHERE status = 'ready'), count(*) FILTER (WHERE status = 'failed'),
      sum(chunk_count), round(extract(epoch FROM max(processed_at) - min(created_at))::numeric, 1),
      round(count(*) FILTER (WHERE status = 'ready') / nullif(extract(epoch FROM max(processed_at) - min(created_at)), 0) * 60),
      round((sum(chunk_count) / nullif(extract(epoch FROM max(processed_at) - min(created_at)), 0))::numeric, 1),
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM processed_at - created_at))::numeric, 1),
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM processed_at - created_at))::numeric, 1)
    FROM documents WHERE external_id LIKE '$1%'" 2>/dev/null |
    { echo "server-side ingest (documents | ready | failed | chunks | first upload to last ready s | documents/min | chunks/s | upload-to-ready p50 s | p95 s):"; sed 's/^/  /'; } ||
    echo "(no server-side figures: set PSQL)"
}

now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

{
  echo "# Load test run ${run_id}"
  echo
  echo "- commit: $(git -C "$repo" rev-parse --short HEAD)$(git -C "$repo" diff --quiet || echo ' (with local changes)')"
  echo "- target: ${TARGET} (${BASE_URL})"
  echo "- host: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), $(sysctl -n hw.ncpu 2>/dev/null || nproc) CPUs," \
    "$(($(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824)) GiB;" \
    "docker: $(docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes, {{.OperatingSystem}}' 2>/dev/null)"
  echo "- k6: ${K6_IMAGE}"
} >"${results}/summary.md"

if [ "$TARGET" = kind ]; then
  # REUSE=1 with KUBECONFIG_FILE: a cluster kept by an earlier KEEP=1 run.
  if [ "${REUSE:-0}" != 1 ]; then
    kind_build
    kind_create
    kind_metrics_server
    kind_secrets
  fi
  kind_apply
  kind_wait
  echo "--- waiting for the demo's crawl to finish"
  kind_wait_indexed 900
  kind_word_delay "$CHAT_WORD_DELAY"
  kc get pods -o wide >>"${results}/pods.txt"
fi

echo "--- preparing the install (${SEED_DOCS} seed documents)"
t0=$(date +%s)
k6 setup.js -e SEED_DOCS="$SEED_DOCS"
echo "- prepared in $(($(date +%s) - t0)) s: $(grep -o 'seed: .*' "${results}/setup.log" | head -n 1)" >>"${results}/summary.md"

for s in "${scenarios[@]}"; do
  echo "--- scenario ${s}"
  delay="$CHAT_WORD_DELAY"
  [ "$s" = mixed ] && delay="$MIXED_WORD_DELAY"
  if [ "$TARGET" = kind ] && { [ "$s" = mixed ] || [ "$s" = chat ] || [ "$s" = openai ]; }; then
    kind_word_delay "$delay"
  fi
  start="$(now_utc)"
  sample_start "${results}/${s}-samples.txt"
  k6 "${s}.js" -e WORD_DELAY="$delay"
  {
    echo
    cat "${results}/${s}.md" 2>/dev/null || echo "(no summary for ${s})"
    echo "word delay: ${delay}; started ${start}"
    echo
    echo '```'
    case "$s" in
      chat | openai | mixed) answers_sql "$start" ;;
    esac
    case "$s" in
      ingest) ingest_sql "ingest-${run_id}" ;;
      mixed) ingest_sql "mixed-${run_id}" ;;
    esac
    sample_stop "${results}/${s}-samples.txt"
    echo '```'
  } | tee -a "${results}/summary.md"
done
echo "--- done: ${results}/summary.md"
