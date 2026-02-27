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

# Load .env
BACKEND_PORT="8080"
VITE_PORT="5173"
DOMAIN="example.com"

if [ -f ".env" ]; then
    while IFS='=' read -r key value; do
        key="$(echo "$key" | xargs)"
        [ -z "$key" ] && continue
        [[ "$key" == \#* ]] && continue
        value="$(echo "$value" | xargs)"
        case "$key" in
            CCR_PORT)      BACKEND_PORT="$value" ;;
            CCR_VITE_PORT) VITE_PORT="$value" ;;
            CCR_DOMAIN)    DOMAIN="$value" ;;
        esac
    done < .env
fi

# Generate config.yml
TUNNEL_ID="7592bba9-abe6-4da3-ac60-d37e918f25b4"
CRED_FILE="$HOME/.cloudflared/$TUNNEL_ID.json"
CONFIG_PATH="$HOME/.cloudflared/config.yml"

cat > "$CONFIG_PATH" << EOF
tunnel: $TUNNEL_ID
credentials-file: $CRED_FILE

ingress:
  - hostname: $DOMAIN
    service: http://localhost:$VITE_PORT
  - service: http_status:404
EOF

echo ""
echo "==============================="
echo "  Cloudflare Named Tunnel"
echo "==============================="
echo ""
echo "  Local:  http://localhost:$VITE_PORT -> :$BACKEND_PORT (proxy)"
echo "  Public: https://$DOMAIN"
echo ""
echo "  (Ctrl+C to stop)"
echo ""

cloudflared tunnel run ccr-tunnel
