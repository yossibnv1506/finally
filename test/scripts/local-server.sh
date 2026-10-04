#!/usr/bin/env bash
# Local (no-Docker) app server control for the E2E suite.
#   bash test/scripts/local-server.sh start|stop|restart
# Serves frontend/out via STATIC_DIR, LLM_MOCK=true, scratch DB at $E2E_DB_PATH
# (default: test/.e2e-data/finally.db, wiped on `start`). Port: $E2E_PORT (default 8000).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${E2E_PORT:-8000}"
DATA_DIR="$ROOT/test/.e2e-data"
DB="${E2E_DB_PATH:-$DATA_DIR/finally.db}"
LOG="$DATA_DIR/server.log"

listening_pids() {
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique" 2>/dev/null | tr -d '\r'
  else
    (lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)
  fi
}

stop() {
  local pids
  pids="$(listening_pids || true)"
  for pid in $pids; do
    [ -z "$pid" ] && continue
    if command -v powershell >/dev/null 2>&1; then
      powershell -NoProfile -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue" || true
    else
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "server did not become healthy; see $LOG" >&2
  return 1
}

launch() {
  mkdir -p "$DATA_DIR"
  (
    cd "$ROOT/backend"
    LLM_MOCK=true MASSIVE_API_KEY="" DB_PATH="$DB" STATIC_DIR="$ROOT/frontend/out" \
      nohup uv run uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >>"$LOG" 2>&1 &
  )
  wait_healthy
}

case "${1:-}" in
  start)
    stop
    mkdir -p "$DATA_DIR"
    rm -f "$DB" "$DB-journal" "$DB-wal" "$DB-shm" "$LOG"
    launch
    echo "app up on http://127.0.0.1:$PORT (db: $DB)"
    ;;
  stop)
    stop
    echo "stopped"
    ;;
  restart)
    stop
    sleep "${E2E_RESTART_DOWNTIME:-3}"
    launch
    echo "restarted"
    ;;
  *)
    echo "usage: $0 start|stop|restart" >&2
    exit 2
    ;;
esac
