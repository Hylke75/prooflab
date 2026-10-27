#!/usr/bin/env bash
# Recreates a local test database (Supabase shim + all migrations) and runs the RLS tests.
# Usage: PGHOST=/var/tmp PGPORT=54329 scripts/test-db.sh
set -euo pipefail
: "${PGHOST:=/var/tmp}" "${PGPORT:=54329}" "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
psql -q -v ON_ERROR_STOP=1 -c 'drop database if exists prooflab_test' -c 'create database prooflab_test'
psql -q -v ON_ERROR_STOP=1 -d prooflab_test -f tests/db/supabase-shim.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d prooflab_test -f "$f" >/dev/null; done
TEST_DATABASE_URL="postgresql://$PGUSER@localhost/prooflab_test?host=$PGHOST&port=$PGPORT" npx vitest run tests/db
