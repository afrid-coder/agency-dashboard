#!/usr/bin/env bash
# Off-site copy of the database, in addition to your provider's automated
# backups. Writes to ./backups (git-ignored). Schedule it with cron or your
# CI runner if you want an extra copy you control.
#
#   ./scripts/backup.sh                  # uses DATABASE_URL (from env or .env)
#
# Restore a PostgreSQL dump into an EMPTY database:
#   pg_restore --no-owner --dbname "$DATABASE_URL" backups/lumera-<stamp>.dump
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)

if [ -n "${DATABASE_URL:-}" ]; then
  if ! command -v pg_dump >/dev/null; then
    echo "pg_dump not found. Install the PostgreSQL client tools (version ≥ your server's)." >&2
    exit 1
  fi
  pg_dump --format=custom --no-owner --no-privileges --file "backups/lumera-$stamp.dump" "$DATABASE_URL"
  echo "Wrote backups/lumera-$stamp.dump"
else
  # Development: embedded database. Copy it only while nothing has it open.
  lock="${DATA_DIR:-data}/pg/.lumera-lock"
  if [ -f "$lock" ] && kill -0 "$(cat "$lock")" 2>/dev/null; then
    echo "The dev server is using the embedded database. Stop it first, then run this again." >&2
    exit 1
  fi
  tar -czf "backups/lumera-embedded-$stamp.tar.gz" -C "${DATA_DIR:-data}" pg
  echo "Wrote backups/lumera-embedded-$stamp.tar.gz (restore: stop the server, extract into ${DATA_DIR:-data}/)"
fi
