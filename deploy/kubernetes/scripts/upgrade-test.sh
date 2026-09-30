#!/usr/bin/env bash
# Upgrade test (docs/operations/upgrades.md): the previous image migrates an
# empty database and gets fixture data through its API; then the new image
# migrates it, and both the old and the new code must work against the
# migrated schema (expand/contract, ADR-0013):
#
#   1. Postgres, Valkey and a network, all named grounded-upgrade-<id>-*.
#   2. OLD: migrate; `serve` (API + worker); `demo --serve-fake-models` seeds
#      the Demo team and serves the fake model gateway; the harness adds an
#      upload source with a known document to the Demo knowledge base, a chat
#      (a stored conversation) and an API key.
#   3. NEW: migrate, with the old process still running.
#   4. OLD, still running: readiness and reads (sources, the conversation,
#      retrieval, the API key).
#   5. NEW `api`: readiness, the same reads, and a chat with the fake model.
#   6. OLD once more, now next to the new process.
#
# Images:
#   NEW_IMAGE   the image under test (default: built from this checkout)
#   OLD_IMAGE   the previous image; default: ghcr.io/ncecere/grounded at
#               OLD_REF if it can be pulled, else built from OLD_REF
#   OLD_REF     default: the last release tag before HEAD, or HEAD^ while there
#               is none (v0.1.0 compares the previous main commit)
#   BASELINE_IMAGE  used when HEAD has no parent (the first public commit):
#               the last image built from the private development history
# Other settings: OLD_PORT (18181) and NEW_PORT (18182) on 127.0.0.1,
# RUN_ID (names), KEEP=1 (leave everything running for a look).
#
# Development only: dev sign-in and the example keys, on loopback.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
RUN_ID=${RUN_ID:-$$}
P=grounded-upgrade-$RUN_ID
NET=$P-net
OLD_PORT=${OLD_PORT:-18181}
NEW_PORT=${NEW_PORT:-18182}
PG_IMAGE=${PG_IMAGE:-pgvector/pgvector:pg17}
VALKEY_IMAGE=${VALKEY_IMAGE:-valkey/valkey:8-alpine}
REGISTRY_IMAGE=${REGISTRY_IMAGE:-ghcr.io/ncecere/grounded}
KEEP=${KEEP:-0}
WORK=$(mktemp -d)

log() { printf '==> %s\n' "$*"; }
fail() {
	printf 'FAIL: %s\n' "$*" >&2
	for c in old new models; do
		docker logs --tail 40 "$P-$c" 2>&1 | sed "s/^/[$c] /" >&2 || true
	done
	exit 1
}

cleanup() {
	local code=$?
	if [ "$KEEP" = 1 ]; then
		log "KEEP=1: containers $P-* and network $NET left running"
	else
		docker rm -f "$P-old" "$P-new" "$P-models" "$P-pg" "$P-valkey" >/dev/null 2>&1 || true
		docker volume rm "$P-blobs" >/dev/null 2>&1 || true
		docker network rm "$NET" >/dev/null 2>&1 || true
		if [ -d "$WORK/old-src" ]; then git -C "$ROOT" worktree remove --force "$WORK/old-src" >/dev/null 2>&1 || true; fi
	fi
	rm -rf "$WORK"
	exit "$code"
}
trap cleanup EXIT

# ---- images ------------------------------------------------------------------------

build() { # tag dir ref
	log "building $1 from $3"
	docker build -q --build-arg VERSION="upgrade-$3" --build-arg COMMIT="$3" -t "$1" "$2" >/dev/null
}

if [ -z "${OLD_IMAGE:-}" ] && [ -z "${OLD_REF:-}" ] && ! git -C "$ROOT" rev-parse -q --verify HEAD^ >/dev/null; then
	OLD_IMAGE=${BASELINE_IMAGE:-$REGISTRY_IMAGE:sha-a73588e}
	docker pull -q "$OLD_IMAGE" >/dev/null || fail "no parent commit, and the baseline image $OLD_IMAGE can't be pulled"
fi
if [ -z "${OLD_IMAGE:-}" ]; then
	if [ -z "${OLD_REF:-}" ]; then
		OLD_REF=$(git -C "$ROOT" describe --tags --abbrev=0 --match 'v*' HEAD^ 2>/dev/null || git -C "$ROOT" rev-parse HEAD^)
	fi
	OLD_SHA=$(git -C "$ROOT" rev-parse --short=7 "$OLD_REF^{commit}")
	case "$OLD_REF" in v*) candidate=$REGISTRY_IMAGE:$OLD_REF ;; *) candidate=$REGISTRY_IMAGE:sha-$OLD_SHA ;; esac
	if docker pull -q "$candidate" >/dev/null 2>&1; then
		OLD_IMAGE=$candidate
	else
		OLD_IMAGE=$P-old:$OLD_SHA
		git -C "$ROOT" worktree add --detach "$WORK/old-src" "$OLD_REF" >/dev/null 2>&1
		build "$OLD_IMAGE" "$WORK/old-src" "$OLD_REF"
	fi
fi
if [ -z "${NEW_IMAGE:-}" ]; then
	NEW_IMAGE=$P-new:$(git -C "$ROOT" rev-parse --short=7 HEAD)
	build "$NEW_IMAGE" "$ROOT" "$(git -C "$ROOT" rev-parse --short=7 HEAD)"
fi
log "old image: $OLD_IMAGE"
log "new image: $NEW_IMAGE"

# ---- infrastructure ------------------------------------------------------------------

log "starting Postgres and Valkey ($P-*)"
docker network create "$NET" >/dev/null
docker volume create "$P-blobs" >/dev/null
docker run -d --name "$P-pg" --network "$NET" -e POSTGRES_USER=grounded -e POSTGRES_PASSWORD=upgrade-test-only \
	-e POSTGRES_DB=grounded "$PG_IMAGE" >/dev/null
docker run -d --name "$P-valkey" --network "$NET" "$VALKEY_IMAGE" valkey-server --save '' --appendonly no >/dev/null
for _ in $(seq 1 60); do
	docker exec "$P-pg" pg_isready -U grounded -d grounded >/dev/null 2>&1 && break
	sleep 1
done
docker exec "$P-pg" pg_isready -U grounded -d grounded >/dev/null || fail "Postgres did not start"

# app runs the image with the shared settings; APP_URL is loopback on the
# host port, which the process also listens on inside the container, so
# development sign-in accepts the requests.
app() { # image port name command [docker run options...]
	local image=$1 port=$2 name=$3 cmd=$4
	shift 4
	docker run --network "$NET" --name "$name" -v "$P-blobs:/home/nonroot" \
		-e APP_URL="http://127.0.0.1:$port" -e HTTP_ADDR="0.0.0.0:$port" \
		-e DATABASE_URL="postgres://grounded:upgrade-test-only@$P-pg:5432/grounded?sslmode=disable" \
		-e VALKEY_URL="redis://$P-valkey:6379/0" -e MIGRATE_ON_START=false -e DEV_AUTH=true \
		-e ENCRYPTION_KEY=dhi4PJ88URUmYkB0gc7BGWkWI2KrYJBM5bdj7IfEfTo= -e API_KEY_PEPPER=FKaLRuR10brhXmbFfmm+9j92BGr82C9qu2OYaBxwfic= \
		-e BLOB_DIR=/home/nonroot/blobs -e LOG_FORMAT=text \
		"$@" "$image" "$cmd"
}

migrate() { # image label
	log "$2: migrate"
	docker rm -f "$P-migrate" >/dev/null 2>&1 || true
	app "$1" "$OLD_PORT" "$P-migrate" migrate --rm >"$WORK/migrate-$2.log" 2>&1 || { cat "$WORK/migrate-$2.log" >&2; fail "$2 migrate"; }
	log "$2: schema version $(docker exec "$P-pg" psql -U grounded -d grounded -tAc 'SELECT max(version_id) FROM goose_db_version')"
}

# ---- HTTP helpers (curl + jq) ----------------------------------------------------------

# signin port: a dev session as the platform admin (the Demo team's owner).
signin() {
	local url=http://127.0.0.1:$1 jar=$WORK/jar-$1
	rm -f "$jar"
	curl -sf -c "$jar" -H "Origin: $url" -H 'Content-Type: application/json' -d '{"account":"admin"}' "$url/auth/dev" >/dev/null ||
		fail "dev sign-in on :$1"
	curl -sf -b "$jar" "$url/v1/me" | jq -r .data.csrfToken >"$WORK/csrf-$1"
}

# api port method path [json]: a session call; prints the body, fails on non-2xx.
api() {
	local url=http://127.0.0.1:$1 method=$2 path=$3 body=${4:-}
	local args=(-sS -b "$WORK/jar-$1" -X "$method" -H "Origin: $url" -H "X-CSRF-Token: $(cat "$WORK/csrf-$1")" -w '\n%{http_code}')
	if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' -d "$body"); fi
	local out code
	out=$(curl "${args[@]}" "$url$path")
	code=${out##*$'\n'}
	out=${out%$'\n'*}
	case "$code" in 2*) printf '%s' "$out" ;; *) fail "$method $path on :$1 = $code $out" ;; esac
}

wait_ready() { # port label
	for _ in $(seq 1 90); do
		[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/readyz")" = 200 ] && return 0
		sleep 1
	done
	fail "$2 not ready on :$1"
}

# ---- 1-2. the old version, with data ------------------------------------------------------

migrate "$OLD_IMAGE" old
log "old: serve on :$OLD_PORT"
app "$OLD_IMAGE" "$OLD_PORT" "$P-old" serve -d -p "127.0.0.1:$OLD_PORT:$OLD_PORT" >/dev/null
wait_ready "$OLD_PORT" old
log "old: grounded demo --serve-fake-models"
app "$OLD_IMAGE" "$OLD_PORT" "$P-models" demo -d -e DEMO_MODELS=fake -e DEMO_SERVE_FAKE_MODELS=true \
	-e DEMO_FAKE_ADDR=0.0.0.0:8090 -e DEMO_FAKE_URL="http://$P-models:8090/v1" >/dev/null
# Sign in only once the demo has seeded: it creates the admin account itself,
# and a sign-in that gets there first makes an older demo refuse to seed.
for _ in $(seq 1 90); do
	docker logs "$P-models" 2>&1 | grep -q 'Serving the fake model gateway' && break
	docker ps -q -f "name=^$P-models\$" | grep -q . || { docker logs "$P-models" >&2; fail "the demo exited"; }
	sleep 1
done

signin "$OLD_PORT"
for _ in $(seq 1 60); do
	n=$(curl -s -b "$WORK/jar-$OLD_PORT" "http://127.0.0.1:$OLD_PORT/v1/teams/demo/agents" | jq '[.data[]? | select(.status == "active")] | length' 2>/dev/null || echo 0)
	[ "${n:-0}" -ge 1 ] && break
	sleep 2
done
[ "${n:-0}" -ge 1 ] || fail "the demo was not seeded"

log "old: fixture data"
# The demo's web source crawls go.dev; the test doesn't need it.
for src in $(api "$OLD_PORT" GET /v1/teams/demo/sources | jq -r '.data[] | select(.activeCrawl != null) | .id + "/crawls/" + .activeCrawl.id'); do
	curl -s -o /dev/null -b "$WORK/jar-$OLD_PORT" -X POST -H "Origin: http://127.0.0.1:$OLD_PORT" \
		-H "X-CSRF-Token: $(cat "$WORK/csrf-$OLD_PORT")" "http://127.0.0.1:$OLD_PORT/v1/teams/demo/sources/$src/cancel" || true
done
SRC=$(api "$OLD_PORT" POST /v1/teams/demo/sources '{"name":"Upgrade fixture","classification":"open"}' | jq -r .data.id)
printf '# Aurora bell\n\nThe aurora bell in the upgrade courtyard rings every day at noon.\n' >"$WORK/aurora.md"
curl -sf -b "$WORK/jar-$OLD_PORT" -H "Origin: http://127.0.0.1:$OLD_PORT" -H "X-CSRF-Token: $(cat "$WORK/csrf-$OLD_PORT")" \
	-F "files=@$WORK/aurora.md" "http://127.0.0.1:$OLD_PORT/v1/teams/demo/sources/$SRC/documents" >/dev/null || fail "upload"
for _ in $(seq 1 60); do
	st=$(api "$OLD_PORT" GET "/v1/teams/demo/sources/$SRC/documents" | jq -r '.data.items[0].status')
	[ "$st" = ready ] && break
	[ "$st" = failed ] && fail "the fixture document failed to ingest"
	sleep 1
done
[ "$st" = ready ] || fail "the fixture document is $st"
KB=$(api "$OLD_PORT" GET /v1/teams/demo/kbs | jq -r '.data[0].id')
api "$OLD_PORT" PUT "/v1/teams/demo/kbs/$KB/sources/$SRC" >/dev/null
AGENT=$(api "$OLD_PORT" GET /v1/teams/demo/agents | jq -r '[.data[] | select(.status == "active")][0].slug')
CONV=$(api "$OLD_PORT" POST "/v1/agents/demo/$AGENT/chat" '{"message":"When does the aurora bell ring?","stream":false}' | jq -r .data.conversationId)
KEY=$(api "$OLD_PORT" POST /v1/teams/demo/api-keys '{"name":"upgrade test","scopes":["query"]}' | jq -r .data.secret)
[ -n "$CONV" ] && [ "$CONV" != null ] && [ -n "$KEY" ] || fail "fixture chat or key"
log "old: fixture source $SRC, kb $KB, agent $AGENT, conversation $CONV"

# reads port label: what every version must still serve from the fixture.
reads() {
	local port=$1 label=$2
	wait_ready "$port" "$label"
	signin "$port"
	api "$port" GET /v1/teams/demo/sources | jq -e '.data[] | select(.name == "Upgrade fixture")' >/dev/null ||
		fail "$label: the fixture source is missing"
	api "$port" GET "/v1/conversations/$CONV" | jq -e '.data.messages | length >= 2' >/dev/null || fail "$label: the conversation"
	api "$port" POST "/v1/teams/demo/kbs/$KB/retrieve" '{"query":"When does the aurora bell ring?"}' | grep -q 'aurora bell' ||
		fail "$label: retrieval does not find the fixture"
	[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "http://127.0.0.1:$port/v1/teams/demo/kbs")" = 200 ] ||
		fail "$label: the API key from the old version"
	log "$label: reads ok"
}
reads "$OLD_PORT" "old (before the upgrade)"

# ---- 3-6. the new version ------------------------------------------------------------------

migrate "$NEW_IMAGE" new
reads "$OLD_PORT" "old on the migrated schema"
log "new: api on :$NEW_PORT"
app "$NEW_IMAGE" "$NEW_PORT" "$P-new" api -d -p "127.0.0.1:$NEW_PORT:$NEW_PORT" >/dev/null
reads "$NEW_PORT" "new"
api "$NEW_PORT" POST "/v1/agents/demo/$AGENT/chat" '{"message":"When does the aurora bell ring?","stream":false}' |
	jq -e '.data.text | length > 0' >/dev/null || fail "new: chat with the fake model"
log "new: chat ok"
reads "$OLD_PORT" "old next to the new version"
log "upgrade test passed: $OLD_IMAGE -> $NEW_IMAGE"
