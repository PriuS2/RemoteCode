#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "==============================="
echo "  Remote Code - Setup"
echo "==============================="
echo ""

# 1. Create default .env if not exists
if [ -f ".env" ]; then
    echo "[OK] .env already exists"
else
    echo "[1/4] Creating default .env..."
    cat > .env << 'ENVEOF'
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_CLAUDE_COMMAND=claude
CCR_PASSWORD=changeme
CCR_JWT_SECRET=change-this-secret-key
CCR_JWT_EXPIRE_HOURS=72
CCR_DB_PATH=sessions.db
# CCR_ALLOWED_ORIGINS=https://ccr.yourdomain.com,http://localhost:8080

# Cloudflare Tunnel (Named Tunnel)
# CCR_VITE_PORT=5173
# CCR_DOMAIN=example.com

# ============================================================
# Claude Code Provider 설정
# 아래 3가지 중 하나만 주석 해제하여 사용하세요.
# ============================================================

# --- Option 1: AWS Bedrock ---
# CLAUDE_CODE_USE_BEDROCK=1
# AWS_REGION=us-west-2
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
# ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0

# --- Option 2: Anthropic API (Direct) ---
# ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx
# ANTHROPIC_MODEL=claude-sonnet-4-20250514

# --- Option 3: LM Studio / OpenAI-compatible API ---
# ANTHROPIC_BASE_URL=http://localhost:1234/v1
# ANTHROPIC_API_KEY=lm-studio
# ANTHROPIC_MODEL=your-model-name
ENVEOF
    echo "[OK] .env created with defaults"
fi

# 2. Python venv
if [ -f ".venv/bin/python" ]; then
    echo "[OK] Python venv already exists"
else
    echo "[2/4] Creating Python virtual environment..."
    python3 -m venv .venv
    echo "[OK] venv created"
fi

source .venv/bin/activate
echo "[OK] venv activated"

# 3. Backend dependencies
echo ""
echo "[3/4] Installing backend dependencies..."
pip install -r backend/requirements.txt
echo "[OK] Backend dependencies installed"

# 4. Frontend dependencies
echo ""
echo "[4/4] Installing frontend dependencies..."
(cd frontend && npm install)
echo "[OK] Frontend dependencies installed"

echo ""
echo "==============================="
echo "  Setup complete!"
echo "==============================="
echo ""
echo "  Dev mode:  ./start-dev.sh"
echo "  Prod mode: ./start.sh"
echo ""
