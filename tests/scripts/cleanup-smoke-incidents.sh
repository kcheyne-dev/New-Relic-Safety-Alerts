#!/usr/bin/env bash
# Wrapper for cleanup-smoke-incidents.sql so `npm run cleanup` works without
# the user having to remember the connection string. Override DATABASE_URL
# if your local Postgres connection differs.

set -euo pipefail

DB="${DATABASE_URL:-postgres://nrsa:nrsa@localhost:5432/nrsa}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SQL_FILE="$SCRIPT_DIR/cleanup-smoke-incidents.sql"

echo "→ Running cleanup against $DB"
echo "→ SQL file: $SQL_FILE"
echo "→ NOTE: defaults to ROLLBACK. Edit the SQL file's last line to COMMIT for real deletes."
echo ""

psql "$DB" -f "$SQL_FILE"
