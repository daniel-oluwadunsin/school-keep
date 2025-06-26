#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if ! nc -z 127.0.0.1 27017; then
  echo "MongoDB is not listening on 127.0.0.1:27017. Start it before running this script." >&2
  exit 1
fi
if [[ ! -f "$ROOT_DIR/server/.env" || ! -f "$ROOT_DIR/web/.env.local" ]]; then
  echo "Copy server/.env.example and web/.env.local.example to their local .env files first." >&2
  exit 1
fi
if [[ ! -x "$ROOT_DIR/ml/.venv/bin/uvicorn" ]]; then
  echo "Install the Python service in ml/.venv first (see README.md)." >&2
  exit 1
fi

(cd "$ROOT_DIR/ml" && .venv/bin/uvicorn research.api:app --host 127.0.0.1 --port 8001) &
ML_PID=$!
(cd "$ROOT_DIR/server" && npm run start:dev) &
API_PID=$!
(cd "$ROOT_DIR/web" && npm run dev) &
WEB_PID=$!
trap 'kill "$ML_PID" "$API_PID" "$WEB_PID" 2>/dev/null || true' EXIT INT TERM
wait
