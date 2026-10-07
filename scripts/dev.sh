#!/bin/zsh
# Starts the API and the Vite dev server together without going through npm
# (used by the desktop preview, where npm's update check can stall).
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")/.."
exec node node_modules/concurrently/dist/bin/index.js -k -n api,web -c magenta,cyan \
  "node --watch --env-file-if-exists=.env --disable-warning=ExperimentalWarning server/index.ts" \
  "node node_modules/vite/bin/vite.js"
