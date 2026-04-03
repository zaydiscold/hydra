#!/bin/bash
# ─────────────────────────────────────────────────────────────────
#  Hydra — Mac Launcher
#  Double-click this file in Finder to start Hydra.
#  (If macOS blocks it, right-click → Open)
# ─────────────────────────────────────────────────────────────────

# Resolve the directory this script lives in (works from Finder double-click)
cd "$(dirname "$0")" || exit 1

# ── Check for Node.js ──────────────────────────────────────────
if ! command -v node &>/dev/null; then
  osascript -e 'display dialog "Node.js is not installed.\n\nHydra requires Node.js v18 or higher.\n\nClick OK to open the download page." buttons {"OK"} with icon caution'
  open "https://nodejs.org/en/download"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 18 ]; then
  osascript -e "display dialog \"Node.js v18+ is required.\n\nYou have v${NODE_VER}.\n\nClick OK to download the latest version.\" buttons {\"OK\"} with icon caution"
  open "https://nodejs.org/en/download"
  exit 1
fi

# ── Launch ─────────────────────────────────────────────────────
echo ""
echo "  ╔════════════════════════════════╗"
echo "  ║   H Y D R A  L A U N C H E R  ║"
echo "  ╚════════════════════════════════╝"
echo ""

node launch.js

# Keep the terminal open if there was an error
if [ $? -ne 0 ]; then
  echo ""
  echo "  ✗ Hydra failed to start. See the error above."
  echo "  Press any key to close this window."
  read -n 1
fi
