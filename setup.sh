#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "==============================="
echo "  Claude Code Remote - Setup"
echo "==============================="
echo ""

# 1. Python venv
if [ -f ".venv/bin/python" ]; then
    echo "[OK] Python venv already exists"
else
    echo "[1/3] Creating Python virtual environment..."
    python3 -m venv .venv
    echo "[OK] venv created"
fi

source .venv/bin/activate
echo "[OK] venv activated"

# 2. Backend dependencies
echo ""
echo "[2/3] Installing backend dependencies..."
pip install -r backend/requirements.txt
echo "[OK] Backend dependencies installed"

# 3. Frontend dependencies
echo ""
echo "[3/3] Installing frontend dependencies..."
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
