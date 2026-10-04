#!/usr/bin/env bash
# Integration tests for the start/stop scripts (requires a running Docker engine and
# a built `finally` image, or it will be built). Uses an isolated container, volume and
# port so it never touches the user's `finally` container or `finally-data` volume.
#
#   bash scripts/tests/test_scripts.sh            # bash scripts (+ PowerShell ones if available)
#
# Covers: stop is idempotent with exit 0 (regression: stop_windows.ps1 leaked exit 1),
# start is idempotent and only returns once /api/health answers (regression: the app's
# ~10s cold start outran the old 10s/-NoOpen-skipped wait), and data in the volume
# survives a stop/start cycle.
set -uo pipefail
export MSYS_NO_PATHCONV=1   # keep Git Bash from mangling "vol:/app/db"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export FINALLY_CONTAINER="finally-scripttest"
export FINALLY_VOLUME="finally-scripttest-data"
export FINALLY_PORT="${FINALLY_TEST_PORT:-18011}"
URL="http://localhost:${FINALLY_PORT}"

PASS=0; FAIL=0
ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }

ENV_CREATED=0
[ -f "${ROOT}/.env" ] || ENV_CREATED=1

cleanup() {
  docker rm -f "${FINALLY_CONTAINER}" >/dev/null 2>&1 || true
  docker volume rm "${FINALLY_VOLUME}" >/dev/null 2>&1 || true
  # Don't leave a placeholder .env behind if the test caused it to be created
  if [ "${ENV_CREATED}" -eq 1 ]; then rm -f "${ROOT}/.env"; fi
}
trap cleanup EXIT

docker info >/dev/null 2>&1 || { echo "SKIP: Docker engine not running"; exit 0; }
cleanup; ENV_CREATED=$([ -f "${ROOT}/.env" ] && echo 0 || echo 1)

healthy_now()       { curl -fs --max-time 3 "${URL}/api/health" >/dev/null; }
container_absent()  { ! docker container inspect "${FINALLY_CONTAINER}" >/dev/null 2>&1; }
volume_present()    { docker volume inspect "${FINALLY_VOLUME}" >/dev/null 2>&1; }
has_ticker()        { curl -fs "${URL}/api/watchlist" | grep -q "\"$1\""; }

run_suite() {
  local label="$1" start="$2" stop="$3"
  echo "== ${label} =="

  $stop >/dev/null 2>&1; check "stop with nothing running exits 0" [ $? -eq 0 ]

  $start >/dev/null 2>&1; check "first start exits 0" [ $? -eq 0 ]
  check "app healthy as soon as start returns" healthy_now

  $start >/dev/null 2>&1; check "second start (idempotent) exits 0" [ $? -eq 0 ]
  check "app healthy after restart" healthy_now

  curl -fs -X POST -H 'Content-Type: application/json' -d '{"ticker":"ZZTEST"}' \
    "${URL}/api/watchlist" >/dev/null
  check "added ticker visible" has_ticker ZZTEST

  $stop >/dev/null 2>&1; check "stop exits 0" [ $? -eq 0 ]
  check "container removed" container_absent
  check "volume kept" volume_present

  $stop >/dev/null 2>&1; check "second stop (idempotent) exits 0" [ $? -eq 0 ]

  $start >/dev/null 2>&1; check "start after stop exits 0" [ $? -eq 0 ]
  check "data persisted across stop/start" has_ticker ZZTEST

  $stop >/dev/null 2>&1
  docker volume rm "${FINALLY_VOLUME}" >/dev/null 2>&1 || true
}

run_suite "bash scripts" "bash ${ROOT}/scripts/start_mac.sh --no-open" "bash ${ROOT}/scripts/stop_mac.sh"

PS=""
command -v powershell.exe >/dev/null 2>&1 && PS="powershell.exe"
command -v pwsh >/dev/null 2>&1 && [ -z "$PS" ] && PS="pwsh"
if [ -n "$PS" ]; then
  WIN_ROOT="$(cygpath -w "${ROOT}" 2>/dev/null || echo "${ROOT}")"
  run_suite "PowerShell scripts" \
    "$PS -NoProfile -ExecutionPolicy Bypass -File ${WIN_ROOT}/scripts/start_windows.ps1 -NoOpen" \
    "$PS -NoProfile -ExecutionPolicy Bypass -File ${WIN_ROOT}/scripts/stop_windows.ps1"
else
  echo "== PowerShell scripts: SKIPPED (no powershell) =="
fi

echo ""
echo "Result: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ]
