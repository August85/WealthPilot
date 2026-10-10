#!/usr/bin/env bash
# Local Postgres for WealthPilot development and API tests, on 127.0.0.1:55432 (user postgres, trust auth).
#
#   scripts/dev-db.sh up        start (Docker if available, else a local cluster under var/pg via initdb/pg_ctl)
#   scripts/dev-db.sh down      stop it
#   scripts/dev-db.sh migrate   create the "wealthpilot" database if needed and run Alembic migrations
#   scripts/dev-db.sh psql      open psql on the dev database
#
# Trust auth on a loopback-only port is for local development only.
set -euo pipefail

PORT="${WP_DEV_DB_PORT:-55432}"
NAME="wealthpilot-dev-db"
IMAGE="postgres:16"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA_DIR="$ROOT/var/pg"
DB_NAME="wealthpilot"

# Debian/Ubuntu install server binaries outside PATH.
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$PATH:$d"; done

have() { command -v "$1" >/dev/null 2>&1; }

use_docker() { have docker && docker info >/dev/null 2>&1; }

wait_ready() {
  for _ in $(seq 1 60); do
    if have pg_isready; then
      pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && return 0
    elif use_docker; then
      docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && return 0
    fi
    sleep 1
  done
  echo "postgres did not become ready on port $PORT" >&2
  return 1
}

up() {
  if use_docker; then
    if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
      docker start "$NAME" >/dev/null
    else
      docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" \
        -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C.UTF-8" \
        "$IMAGE" >/dev/null
    fi
  else
    have initdb && have pg_ctl || { echo "need Docker or PostgreSQL server binaries (initdb, pg_ctl)" >&2; exit 1; }
    if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
      mkdir -p "$PGDATA_DIR"
      initdb -D "$PGDATA_DIR" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
    pg_ctl -D "$PGDATA_DIR" -l "$ROOT/var/pg.log" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -w start
  fi
  wait_ready
  echo "postgres ready on 127.0.0.1:$PORT"
}

down() {
  if use_docker && docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    docker stop "$NAME" >/dev/null
  elif [ -f "$PGDATA_DIR/postmaster.pid" ]; then
    pg_ctl -D "$PGDATA_DIR" -m fast stop
  fi
}

run_psql() {
  if have psql; then
    psql -h 127.0.0.1 -p "$PORT" -U postgres "$@"
  else
    docker exec -i "$NAME" psql -U postgres "$@"
  fi
}

migrate() {
  if [ "$(run_psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" != "1" ]; then
    run_psql -d postgres -c "CREATE DATABASE $DB_NAME ENCODING 'UTF8' TEMPLATE template0" >/dev/null
  fi
  (cd "$ROOT/services/api" && \
    WP_DATABASE_URL="${WP_DATABASE_URL:-postgresql+psycopg://postgres@127.0.0.1:${PORT}/${DB_NAME}}" \
    uv run alembic upgrade head)
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  migrate) migrate ;;
  psql) shift; run_psql -d "$DB_NAME" "$@" ;;
  *) echo "usage: $0 {up|down|migrate|psql}" >&2; exit 2 ;;
esac
