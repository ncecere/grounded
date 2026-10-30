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
# Writes, not only reads (#195). Reads cannot show that the previous release's
# code survives the new schema, or that the new code reads what the old one
# wrote; the harness therefore also writes with the OLD code, in a database
# created with --locale=C (where the database's lower() folds ASCII only, so
# the previous release's index accepts template names that differ beyond
# ASCII):
#   - before the new migrate: two template names that differ only in a
#     non-ASCII letter's case (the migration renames the later one), and a
#     team request approved with a CHANGED classification;
#   - after the new migrate, the old process still running: a template saved
#     as a Unicode-only twin of another, a template renamed onto a twin
#     name, and a second request approved with a changed classification. None
#     of it may be a 5xx (the stricter unique index that once did that is a
#     later release's, ADR-0013);
#   - once the NEW code runs: it lists those templates, refuses a new twin
#     and a rename onto a twin with 409 template_name_taken and changes nothing
#     for the refusal, and both requests show the classification the
#     reviewer approved (the migration does not backfill; the API resolves
#     it from the audit log).
# A twin saved by an old pod next to the new one is accepted by design
# (docs/operations/upgrades.md, "Staged constraints").
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
# RUN_ID (names), KEEP=1 (leave everything running for a look), PG_INITDB_ARGS
# (default --locale=C --encoding=UTF8, the cluster the template-name steps need).
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
PG_INITDB_ARGS=${PG_INITDB_ARGS:---locale=C --encoding=UTF8}
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
	-e POSTGRES_DB=grounded -e POSTGRES_INITDB_ARGS="$PG_INITDB_ARGS" "$PG_IMAGE" >/dev/null
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

# signin port [account]: a dev session (default: the platform admin, the Demo team's owner), kept per port and account.
signin() {
	local url=http://127.0.0.1:$1 account=${2:-admin} jar=$WORK/jar-$1-${2:-admin}
	rm -f "$jar"
	curl -sf -c "$jar" -H "Origin: $url" -H 'Content-Type: application/json' -d "{\"account\":\"$account\"}" "$url/auth/dev" >/dev/null ||
		fail "dev sign-in as $account on :$1"
	curl -sf -b "$jar" "$url/v1/me" | jq -r .data.csrfToken >"$WORK/csrf-$1-$account"
}

# call port method path [json] [header]: a session call (as $WHO, default admin) that never fails by itself: sets CODE and BODY.
call() {
	local url=http://127.0.0.1:$1 method=$2 path=$3 body=${4:-} hdr=${5:-} who=${WHO:-admin}
	local args=(-sS -b "$WORK/jar-$1-$who" -X "$method" -H "Origin: $url" -H "X-CSRF-Token: $(cat "$WORK/csrf-$1-$who")" -w '\n%{http_code}')
	if [ -n "$hdr" ]; then args+=(-H "$hdr"); fi
	if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' -d "$body"); fi
	local out
	out=$(curl "${args[@]}" "$url$path")
	CODE=${out##*$'\n'}
	BODY=${out%$'\n'*}
}

# api port method path [json] [header]: call, and fail on a non-2xx.
api() {
	call "$@"
	case "$CODE" in 2*) printf '%s' "$BODY" ;; *) fail "$2 $3 on :$1 as ${WHO:-admin} = $CODE $BODY" ;; esac
}

# expect_code want port method path [json] [header]: call and fail unless the status is want. A 5xx never passes.
expect_code() {
	local want=$1
	shift
	call "$@"
	[ "$CODE" = "$want" ] || fail "$2 $3 on :$1 as ${WHO:-admin}: want $want, got $CODE $BODY"
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
	n=$(curl -s -b "$WORK/jar-$OLD_PORT-admin" "http://127.0.0.1:$OLD_PORT/v1/teams/demo/agents" | jq '[.data[]? | select(.status == "active")] | length' 2>/dev/null || echo 0)
	[ "${n:-0}" -ge 1 ] && break
	sleep 2
done
[ "${n:-0}" -ge 1 ] || fail "the demo was not seeded"

log "old: fixture data"
# The demo's web source crawls go.dev; the test doesn't need it.
for src in $(api "$OLD_PORT" GET /v1/teams/demo/sources | jq -r '.data[] | select(.activeCrawl != null) | .id + "/crawls/" + .activeCrawl.id'); do
	curl -s -o /dev/null -b "$WORK/jar-$OLD_PORT-admin" -X POST -H "Origin: http://127.0.0.1:$OLD_PORT" \
		-H "X-CSRF-Token: $(cat "$WORK/csrf-$OLD_PORT-admin")" "http://127.0.0.1:$OLD_PORT/v1/teams/demo/sources/$src/cancel" || true
done
SRC=$(api "$OLD_PORT" POST /v1/teams/demo/sources '{"name":"Upgrade fixture","classification":"open"}' | jq -r .data.id)
printf '# Aurora bell\n\nThe aurora bell in the upgrade courtyard rings every day at noon.\n' >"$WORK/aurora.md"
curl -sf -b "$WORK/jar-$OLD_PORT-admin" -H "Origin: http://127.0.0.1:$OLD_PORT" -H "X-CSRF-Token: $(cat "$WORK/csrf-$OLD_PORT-admin")" \
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

# ---- writes (#195): templates and team requests ------------------------------------------------

# The steps that need a feature the old version has (v0.6.0: templates, team requests) are skipped for an older OLD_REF.
AGENT_ID=$(api "$OLD_PORT" GET /v1/teams/demo/agents | jq -r '[.data[] | select(.status == "active")][0].id')
call "$OLD_PORT" GET /v1/agent-templates
[ "$CODE" = 200 ] && HAS_TEMPLATES=1 || HAS_TEMPLATES=0
call "$OLD_PORT" GET /v1/team-requests
[ "$CODE" = 200 ] && HAS_REQUESTS=1 || HAS_REQUESTS=0
# The cluster's character classes: with C the old index cannot tell a Unicode-only twin, so the old version saves it (201); in another
# locale its own lower() folds the name and it answers 409. Either is fine; a 5xx never is.
CTYPE=$(docker exec "$P-pg" psql -U grounded -d grounded -tAc 'SELECT datctype FROM pg_database WHERE datname = current_database()')
if [ "$CTYPE" = C ]; then TWIN_CODE=201; else TWIN_CODE=409; fi
log "old: templates=$HAS_TEMPLATES team requests=$HAS_REQUESTS, datctype=$CTYPE (a Unicode-only twin is $TWIN_CODE for the old version)"

# save_template port name: the Demo agent saved as a template by whoever the caller is; prints the status, then the id.
save_template() {
	call "$1" POST "/v1/teams/demo/agents/$AGENT_ID/save-as-template" "$(jq -nc --arg n "$2" '{name: $n}')"
	printf '%s %s' "$CODE" "$(printf '%s' "$BODY" | jq -r '.data.id // .id // empty' 2>/dev/null)"
}
# template_names port: the saved (not built-in) templates' names, one per line.
template_names() { api "$1" GET /v1/agent-templates | jq -r '.data[] | select(.builtIn | not) | .name'; }
# template_id port name: the id of the saved template with exactly this name.
template_id() { api "$1" GET /v1/agent-templates | jq -r --arg n "$2" '.data[] | select(.name == $n) | .id'; }
# ask port account name: a team request by that person (classification open); prints its id.
ask_request() {
	WHO=$2 api "$1" POST /v1/team-requests "$(jq -nc --arg n "$3" '{name: $n, purpose: "Upgrade rehearsal.", classification: "open"}')" | jq -r .data.id
}
# approve port id slug level: the platform admin approves with a classification that differs from the one asked for.
approve_request() {
	local rev
	rev=$(api "$1" GET "/v1/admin/team-requests/$2" | jq -r .data.revision)
	api "$1" POST "/v1/admin/team-requests/$2/approve" "$(jq -nc --arg s "$3" --arg l "$4" '{slug: $s, maxClassification: $l}')" "If-Match: \"$rev\"" >/dev/null
}
# approved port account id asked approved: what the person (or, for "admin", the review queue) is shown.
check_approved() {
	local port=$1 who=$2 id=$3 asked=$4 want=$5 got
	if [ "$who" = admin ]; then
		got=$(api "$port" GET "/v1/admin/team-requests/$id" | jq -r '.data | .classification + "/" + .approvedClassification')
	else
		got=$(WHO=$who api "$port" GET /v1/team-requests | jq -r --arg id "$id" '.data.items[] | select(.id == $id) | .classification + "/" + .approvedClassification')
	fi
	[ "$got" = "$asked/$want" ] || fail "request $id as $who on :$port: asked/approved = $got, want $asked/$want"
}

if [ "$HAS_REQUESTS" = 1 ]; then
	signin "$OLD_PORT" user
	signin "$OLD_PORT" alex
	rev=$(api "$OLD_PORT" GET /v1/admin/settings/team-requests | jq -r .data.revision)
	api "$OLD_PORT" PUT /v1/admin/settings/team-requests '{"enabled":true,"maxOpen":5,"allowedGroup":""}' "If-Match: \"$rev\"" >/dev/null
	REQ_A=$(ask_request "$OLD_PORT" user "Upgrade request A")
	REQ_B=$(ask_request "$OLD_PORT" alex "Upgrade request B")
	approve_request "$OLD_PORT" "$REQ_A" upgrade-a sensitive
	log "old: request A approved with sensitive (asked open), B pending"
fi
if [ "$HAS_TEMPLATES" = 1 ]; then
	# What the old version's own index allows in this cluster; the new migration renames the later one.
	[ "$(save_template "$OLD_PORT" 'Twin ÄÖ' | cut -d' ' -f1)" = 201 ] || fail "old: saving a template"
	[ "$(save_template "$OLD_PORT" 'TWIN äö' | cut -d' ' -f1)" = "$TWIN_CODE" ] || fail "old: saving a Unicode-only twin"
	log "old: templates saved, including a Unicode-only twin pair"
fi

# ---- 3-6. the new version ------------------------------------------------------------------

migrate "$NEW_IMAGE" new

# The old version writes on the migrated schema: a twin, a rename onto a twin, an approval with a changed classification. None of it may be
# a 5xx (v0.6.2 knows only agent_templates_name_key, so migration 00054 must not add a stricter unique index).
if [ "$HAS_TEMPLATES" = 1 ]; then
	[ "$(save_template "$OLD_PORT" 'Zoë Über' | cut -d' ' -f1)" = 201 ] || fail "old on the new schema: saving a template"
	[ "$(save_template "$OLD_PORT" 'ZOË ÜBER' | cut -d' ' -f1)" = "$TWIN_CODE" ] || fail "old on the new schema: saving a Unicode-only twin"
	MOVER=$(save_template "$OLD_PORT" 'Rename me' | cut -d' ' -f2)
	expect_code 200 "$OLD_PORT" PATCH "/v1/admin/agent-templates/$MOVER" '{"name":"zoë über"}'
	log "old on the migrated schema: template save, twin and rename-onto-twin answered, no 5xx"
fi
if [ "$HAS_REQUESTS" = 1 ]; then
	approve_request "$OLD_PORT" "$REQ_B" upgrade-b restricted
	log "old on the migrated schema: request B approved with restricted (asked open)"
fi
reads "$OLD_PORT" "old on the migrated schema"
log "new: api on :$NEW_PORT"
app "$NEW_IMAGE" "$NEW_PORT" "$P-new" api -d -p "127.0.0.1:$NEW_PORT:$NEW_PORT" >/dev/null
reads "$NEW_PORT" "new"

# The new code reads what the old one wrote, and enforces what the old one could not.
if [ "$HAS_TEMPLATES" = 1 ]; then
	signin "$NEW_PORT" admin
	names=$(template_names "$NEW_PORT")
	for n in 'Twin ÄÖ' 'TWIN äö (2)' 'Zoë Über' 'ZOË ÜBER' 'zoë über'; do
		printf '%s\n' "$names" | grep -qxF -- "$n" || fail "new: the template '$n' is missing from: $names"
	done
	if printf '%s\n' "$names" | grep -qxF -- 'TWIN äö'; then fail "new: migration 00054 did not rename the later duplicate"; fi
	# A new twin is refused, nothing is saved.
	before=$(template_names "$NEW_PORT" | sort | tr '\n' '|')
	expect_code 409 "$NEW_PORT" POST "/v1/teams/demo/agents/$AGENT_ID/save-as-template" '{"name":"zoë ÜBER"}'
	printf '%s' "$BODY" | jq -e '.error.code == "template_name_taken"' >/dev/null || fail "new: the twin refusal is not template_name_taken: $BODY"
	# A rename onto a twin is refused and changes nothing; a free name and the case of its own name are accepted.
	ID=$(template_id "$NEW_PORT" 'Twin ÄÖ')
	expect_code 409 "$NEW_PORT" PATCH "/v1/admin/agent-templates/$ID" '{"name":"ZOË ÜBER","description":"not saved"}'
	[ "$(template_names "$NEW_PORT" | sort | tr '\n' '|')" = "$before" ] || fail "new: a refused save or rename changed the templates"
	api "$NEW_PORT" GET /v1/agent-templates | jq -e --arg id "$ID" '.data[] | select(.id == $id) | .description != "not saved"' >/dev/null ||
		fail "new: a refused rename saved its description"
	expect_code 200 "$NEW_PORT" PATCH "/v1/admin/agent-templates/$ID" '{"name":"TWIN ÄÖ"}'
	# Written by the new code, then a twin by the old code next to it: the old pod's index cannot see it, so it is accepted (a temporary,
	# documented legacy behaviour, better than a 500); the new code refuses any further twin.
	[ "$(save_template "$NEW_PORT" 'Neu Ärger' | cut -d' ' -f1)" = 201 ] || fail "new: saving a template"
	[ "$(save_template "$OLD_PORT" 'NEU ärger' | cut -d' ' -f1)" = "$TWIN_CODE" ] || fail "old next to new: saving a Unicode-only twin"
	expect_code 409 "$NEW_PORT" POST "/v1/teams/demo/agents/$AGENT_ID/save-as-template" '{"name":"neu ärger"}'
	log "new: templates listed, twins and renames onto twins refused with 409"
fi
if [ "$HAS_REQUESTS" = 1 ]; then
	signin "$NEW_PORT" user
	signin "$NEW_PORT" alex
	check_approved "$NEW_PORT" user "$REQ_A" open sensitive
	check_approved "$NEW_PORT" alex "$REQ_B" open restricted
	check_approved "$NEW_PORT" admin "$REQ_A" open sensitive
	check_approved "$NEW_PORT" admin "$REQ_B" open restricted
	log "new: both approvals show the classification the reviewer approved (A before the migration, B by the old version after it)"
fi
api "$NEW_PORT" POST "/v1/agents/demo/$AGENT/chat" '{"message":"When does the aurora bell ring?","stream":false}' |
	jq -e '.data.text | length > 0' >/dev/null || fail "new: chat with the fake model"
log "new: chat ok"
reads "$OLD_PORT" "old next to the new version"
log "upgrade test passed: $OLD_IMAGE -> $NEW_IMAGE"
