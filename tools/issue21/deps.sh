#!/usr/bin/env bash
# Disposable dependencies for the guarded issue21 test. No production access.
# Keep this helper versioned so the grant's clean source also binds its wrapper.
set -euo pipefail
id=${RUN_ID:?RUN_ID is required}
[[ "$id" =~ ^issue21-[a-f0-9-]+$ ]] || exit 2
NET=grounded-focused-$id-net
PG=grounded-focused-$id-pg
VK=grounded-focused-$id-valkey
for name in "$PG" "$VK"; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo "Refusing to replace an existing test container" >&2
    exit 2
  fi
done
if docker network inspect "$NET" >/dev/null 2>&1; then
  echo "Refusing to replace an existing test network" >&2
  exit 2
fi
docker network create "$NET" >/dev/null
cleanup() {
  status=$?
  trap - EXIT
  docker rm -f "$PG" "$VK" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
docker run --rm -d --name "$PG" --network "$NET" -p 127.0.0.1::5432 -e POSTGRES_USER=grounded -e POSTGRES_PASSWORD=validation-test-only -e POSTGRES_DB=grounded pgvector/pgvector:pg17 >/dev/null
docker run --rm -d --name "$VK" --network "$NET" -p 127.0.0.1::6379 valkey/valkey:8-alpine valkey-server --save '' --appendonly no >/dev/null
ready=0
for n in $(seq 1 60); do
  if docker exec "$PG" pg_isready -h 127.0.0.1 -U grounded -d grounded >/dev/null 2>&1 && docker exec "$VK" valkey-cli ping >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" = 1
PGPORT=$(docker port "$PG" 5432/tcp | cut -d: -f2)
VKPORT=$(docker port "$VK" 6379/tcp | cut -d: -f2)
export GROUNDED_TEST_DATABASE_URL="postgres://grounded:validation-test-only@127.0.0.1:$PGPORT/grounded?sslmode=disable"
export GROUNDED_TEST_VALKEY_URL="redis://127.0.0.1:$VKPORT/0"
"$@"
