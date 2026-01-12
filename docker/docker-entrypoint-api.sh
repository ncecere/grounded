#!/bin/sh
set -e

echo "Running database migrations..."
bun run --filter @grounded/db migrate

echo "Starting API server..."
exec bun run apps/api/src/index.ts
