#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f ".venv/bin/python" ]; then
    echo "[ERROR] venv not found. Run ./setup.sh first."
    exit 1
fi

source .venv/bin/activate

# Create default .env if not exists
if [ ! -f ".env" ]; then
    cat > .env << 'ENVEOF'
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_CLAUDE_COMMAND=claude
CCR_PASSWORD=changeme
CCR_JWT_SECRET=change-this-secret-key
CCR_JWT_EXPIRE_HOURS=72
CCR_DB_PATH=sessions.db
# CCR_ALLOWED_ORIGINS=https://ccr.yourdomain.com,http://localhost:8080
ENVEOF
    echo "[OK] .env created with defaults"
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
