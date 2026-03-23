#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_BIN="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON_BIN=".venv/bin/python"
fi

VERSION="${BUILD_VERSION:-dev}"
MACHINE="$("$PYTHON_BIN" -c 'import platform; print(platform.machine().lower())')"
case "$MACHINE" in
  amd64|x86_64)
    ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    ARCH="$MACHINE"
    ;;
esac

echo "[1/4] Installing build dependencies..."
"$PYTHON_BIN" -m pip install -r backend/requirements.txt -r requirements-build.txt

echo "[2/4] Building frontend..."
(
  cd frontend
  npm ci
  npm run build
)

echo "[3/4] Building executable..."
rm -rf build dist
"$PYTHON_BIN" -m PyInstaller remote-code.spec --clean --noconfirm

echo "[4/4] Packaging archive..."
mkdir -p release
ARCHIVE="release/remote-code-${VERSION}-macos-${ARCH}.zip"
rm -f "$ARCHIVE"
ditto -c -k --sequesterRsrc --keepParent "dist/Remote Code.app" "$ARCHIVE"

echo
echo "Created $ARCHIVE"
