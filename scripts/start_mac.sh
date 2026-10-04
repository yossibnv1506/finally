#!/usr/bin/env bash
# Start FinAlly in Docker (macOS/Linux). Idempotent: safe to run repeatedly.
# Usage: scripts/start_mac.sh [--build] [--no-open]
set -euo pipefail

IMAGE_NAME="finally"
CONTAINER_NAME="${FINALLY_CONTAINER:-finally}"
VOLUME_NAME="${FINALLY_VOLUME:-finally-data}"
PORT="${FINALLY_PORT:-8000}"
URL="http://localhost:${PORT}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

FORCE_BUILD=0
OPEN_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --build|-b) FORCE_BUILD=1 ;;
    --no-open)  OPEN_BROWSER=0 ;;
    -h|--help)
      echo "Usage: $0 [--build] [--no-open]"
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on PATH." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Error: the Docker daemon is not running. Start Docker and retry." >&2
  exit 1
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example — edit it to add your OPENROUTER_API_KEY."
  else
    echo "Error: neither .env nor .env.example found in ${PROJECT_ROOT}." >&2
    exit 1
  fi
fi

if [ "${FORCE_BUILD}" -eq 1 ] || ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  echo "Building Docker image '${IMAGE_NAME}'..."
  docker build -t "${IMAGE_NAME}" .
fi

if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "Removing existing container '${CONTAINER_NAME}'..."
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

echo "Starting container '${CONTAINER_NAME}'..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  -v "${VOLUME_NAME}:/app/db" \
  -p "${PORT}:8000" \
  --env-file .env \
  "${IMAGE_NAME}" >/dev/null

# Wait for /api/health before reporting (cold start takes ~10s), even with --no-open.
WAIT_SECS="${FINALLY_WAIT_SECS:-60}"
READY=0
container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null)" = "true" ]
}
for _ in $(seq 1 "${WAIT_SECS}"); do
  if curl -fs --max-time 2 "${URL}/api/health" >/dev/null 2>&1; then READY=1; break; fi
  container_running || break
  sleep 1
done

echo ""
if [ "${READY}" -eq 1 ]; then
  echo "FinAlly is running at ${URL}"
else
  if ! container_running; then
    echo "Error: container '${CONTAINER_NAME}' exited during startup. Check: docker logs ${CONTAINER_NAME}" >&2
    exit 1
  fi
  echo "Warning: FinAlly did not report healthy within ${WAIT_SECS}s; it may still be starting. Check: docker logs ${CONTAINER_NAME}" >&2
  echo "URL: ${URL}"
fi
echo "Stop it with: scripts/stop_mac.sh  (data in volume '${VOLUME_NAME}' is kept)"

if [ "${OPEN_BROWSER}" -eq 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open "${URL}" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" >/dev/null 2>&1 || true
  fi
fi
