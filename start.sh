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

if [ "$RUNTIME" = "chromium" ]; then
    if [ ! -d "node_modules" ]; then
        echo "[ERROR] root node_modules not found. Run ./setup.sh first."
        exit 1
    fi

    echo ""
    echo "==============================="
    echo "  Remote Code Desktop"
    echo "==============================="
    echo ""
    echo "  Runtime: Desktop shell"
    echo ""

    npm run desktop:start
    exit $?
fi

echo ""
echo "==============================="
echo "  Remote Code"
echo "==============================="
echo ""
echo "  URL: http://localhost:${CCR_PORT:-8080}"
echo ""

python -m uvicorn backend.main:app --host 0.0.0.0 --port "${CCR_PORT:-8080}"
