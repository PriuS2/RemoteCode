#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check cloudflared
if ! command -v cloudflared &>/dev/null; then
    echo "[!] cloudflared not found."
    echo "    macOS:  brew install cloudflare/cloudflare/cloudflared"
    echo "    Linux:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
fi

# Load .env to read port
PORT="8080"
if [ -f ".env" ]; then
    while IFS='=' read -r key value; do
        key="$(echo "$key" | xargs)"
        [ -z "$key" ] && continue
        [[ "$key" == \#* ]] && continue
        value="$(echo "$value" | xargs)"
        if [ "$key" = "CCR_PORT" ]; then
            PORT="$value"
        fi
    done < .env
fi

echo ""
echo "==============================="
echo "  Cloudflare Quick Tunnel"
echo "==============================="
echo ""
echo "  Local:  http://localhost:$PORT"
echo "  Tunnel: Starting..."
echo ""
echo "  (Ctrl+C to stop)"
echo ""

cloudflared tunnel --url "http://localhost:$PORT"
