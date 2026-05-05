#!/bin/bash
# Click-to-launch wrapper for the packaged Electron app.
# Double-click in Finder; macOS will run this as a Terminal command.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$DIR/Hydra.app"
if [ ! -e "$APP" ]; then
  echo "Hydra.app not found at $APP"
  echo "Run \`npm run electron:build\` first."
  exit 1
fi
exec open -W "$APP"
