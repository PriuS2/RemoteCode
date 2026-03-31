#!/usr/bin/env bash
set -euo pipefail

RUNTIME="web"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime)
      RUNTIME="$2"
      shift 2
      ;;
    *)
      echo "[ERROR] Unknown argument: $1"
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f ".venv/bin/python" ]; then
    echo "[ERROR] venv not found. Run ./setup.sh first."
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "[ERROR] .env not found. Run ./setup.sh first."
    exit 1
fi

source .venv/bin/activate

while IFS='=' read -r key value; do
    key="$(echo "$key" | xargs)"
    [ -z "$key" ] && continue
    [[ "$key" == \#* ]] && continue
    value="$(echo "$value" | xargs)"
    export "$key=$value"
done < .env
echo "[OK] .env loaded"

BACKEND_PID=""
VITE_PID=""

cleanup() {
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
        echo "Backend stopped."
    fi
    if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
        kill "$VITE_PID" 2>/dev/null || true
        wait "$VITE_PID" 2>/dev/null || true
        echo "Vite stopped."
    fi
}

trap cleanup EXIT INT TERM

VITE_PORT="${CCR_VITE_PORT:-5173}"

if [ "$RUNTIME" = "chromium" ]; then
    if [ ! -d "node_modules" ]; then
        echo "[ERROR] root node_modules not found. Run ./setup.sh first."
        exit 1
    fi
    if [ ! -d "frontend/node_modules" ]; then
        echo "[ERROR] frontend node_modules not found. Run ./setup.sh first."
        exit 1
    fi

    echo ""
    echo "Starting Remote Code (DEV MODE - Desktop)"
    echo "  Backend:  http://localhost:${CCR_PORT:-8080}"
    echo "  Frontend: http://127.0.0.1:${VITE_PORT}"
    echo ""

    (
      cd frontend
      npm run dev -- --host 127.0.0.1
    ) &
    VITE_PID=$!

    export REMOTE_CODE_DEV_SERVER_URL="http://127.0.0.1:${VITE_PORT}"
    npm run desktop:start
    exit $?
fi

echo ""
echo "Starting Remote Code (DEV MODE)"
echo "  Backend:  http://localhost:${CCR_PORT:-8080}"
echo "  Frontend: http://localhost:${VITE_PORT}"
echo ""

python -m uvicorn backend.main:app --host 0.0.0.0 --port "${CCR_PORT:-8080}" --reload &
BACKEND_PID=$!

cd frontend
npm run dev
