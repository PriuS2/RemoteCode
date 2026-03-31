#!/usr/bin/env bash
set -euo pipefail

TARGET="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="$2"
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

echo "[1/5] Installing build dependencies..."
"$PYTHON_BIN" -m pip install -r backend/requirements.txt -r requirements-build.txt
npm ci

echo "[2/5] Building frontend..."
(
  cd frontend
  npm ci
  npm run build
)

mkdir -p release

if [ "$TARGET" = "web" ] || [ "$TARGET" = "all" ]; then
  echo "[3/5] Building web package..."
  rm -rf build dist
  "$PYTHON_BIN" -m PyInstaller remote-code.spec --clean --noconfirm

  ARCHIVE="release/remote-code-${VERSION}-macos-${ARCH}.zip"
  rm -f "$ARCHIVE"
  ditto -c -k --sequesterRsrc --keepParent "dist/Remote Code.app" "$ARCHIVE"
  echo "Created $ARCHIVE"
fi

if [ "$TARGET" = "chromium" ] || [ "$TARGET" = "all" ]; then
  echo "[4/5] Building chromium backend server..."
  rm -rf build dist desktop-build-resources desktop-dist
  "$PYTHON_BIN" -m PyInstaller remote-code-server.spec --clean --noconfirm

  mkdir -p desktop-build-resources/backend
  cp "dist/remote-code-server" "desktop-build-resources/backend/remote-code-server"

  echo "[5/5] Packaging chromium desktop app..."
  npm run desktop:package:mac

  APP_BUNDLE="$(find desktop-dist -type d -name 'Remote Code Chromium.app' | head -n 1)"
  if [ -z "$APP_BUNDLE" ]; then
    echo "[ERROR] Unable to find packaged Chromium app bundle."
    exit 1
  fi

  ARCHIVE="release/remote-code-chromium-${VERSION}-macos-${ARCH}.zip"
  rm -f "$ARCHIVE"
  ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ARCHIVE"
  echo "Created $ARCHIVE"
fi
