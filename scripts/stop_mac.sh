#!/usr/bin/env bash
# Stop FinAlly (macOS/Linux). Removes the container but keeps the data volume.
# Idempotent: safe to run when nothing is running.
set -euo pipefail

CONTAINER_NAME="${FINALLY_CONTAINER:-finally}"
VOLUME_NAME="${FINALLY_VOLUME:-finally-data}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on PATH." >&2
  exit 1
fi

if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "Stopping and removing container '${CONTAINER_NAME}'..."
  docker rm -f "${CONTAINER_NAME}" >/dev/null
  echo "Stopped. Data volume '${VOLUME_NAME}' was kept."
else
  echo "Container '${CONTAINER_NAME}' is not running. Nothing to do."
fi
exit 0
