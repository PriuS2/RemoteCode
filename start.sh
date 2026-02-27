#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f ".venv/bin/python" ]; then
    echo "[ERROR] venv not found. Run ./setup.sh first."
    exit 1
fi

source .venv/bin/activate

# Check .env exists
if [ ! -f ".env" ]; then
    echo "[ERROR] .env not found. Run ./setup.sh first."
    exit 1
fi

# Load .env
while IFS='=' read -r key value; do
    key="$(echo "$key" | xargs)"
    [ -z "$key" ] && continue
    [[ "$key" == \#* ]] && continue
    value="$(echo "$value" | xargs)"
    export "$key=$value"
done < .env
echo "[OK] .env loaded"

echo ""
echo "==============================="
echo "  Claude Code Remote"
echo "==============================="
echo ""
echo "  URL: http://localhost:${CCR_PORT:-8080}"
echo ""

python -m uvicorn backend.main:app --host 0.0.0.0 --port "${CCR_PORT:-8080}"
