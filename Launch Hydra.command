#!/bin/bash
# Click-to-launch wrapper for Hydra.app
# Double-click in Finder; macOS opens this in Terminal.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/Hydra.app"

# ── symlink helper ──────────────────────────────────────────────────────
if [ ! -d "$APP" ]; then
  # check if the real build exists even if symlink is broken
  REAL="release/mac-arm64/Hydra.app"
  if [ -d "$REAL" ]; then
    ln -sf "$(pwd)/$REAL" "$APP"
    echo "Hydra.app → $REAL re-linked"
  fi
fi

if [ ! -d "$APP/Contents/MacOS/Hydra" ] && [ ! -f "$APP/Contents/MacOS/Hydra" ]; then
  echo "Hydra.app not built yet."
  echo ""
  echo "Run:  npm run electron:build"
  echo "Then double-click this again."
  read -r -p "Build now? (y/N) " yn
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    npm run electron:build
    if [ -d "$APP/Contents/MacOS/Hydra" ] || [ -f "$APP/Contents/MacOS/Hydra" ]; then
      echo "Build complete. Launching..."
    else
      echo "Build may have failed. Check output above."
      exit 1
    fi
  else
    exit 1
  fi
fi

echo "🚀 Launching Hydra..."
open -a "$APP"
echo "Hydra started. You can close this window."
