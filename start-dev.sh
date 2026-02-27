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

# Claude Code (Bedrock)
# CLAUDE_CODE_USE_BEDROCK=1
# AWS_REGION=us-west-2
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
# ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0
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

BACKEND_PID=""

cleanup() {
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
        echo "Backend stopped."
    fi
}

trap cleanup EXIT INT TERM

VITE_PORT="${CCR_VITE_PORT:-5173}"

echo ""
echo "Starting Claude Code Remote (DEV MODE)"
echo "  Backend:  http://localhost:${CCR_PORT:-8080}"
echo "  Frontend: http://localhost:${VITE_PORT}"
echo ""

python -m uvicorn backend.main:app --host 0.0.0.0 --port "${CCR_PORT:-8080}" --reload &
BACKEND_PID=$!

cd frontend
npm run dev
