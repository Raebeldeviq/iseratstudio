#!/bin/zsh
set -euo pipefail
APP_ROOT="${0:A:h}"
NODE_BIN="$HOME/.local/bin/node"
if [[ ! -x "$NODE_BIN" ]]; then
  print -u2 "Die installierte Node-Laufzeit fehlt. Es wird keine Ersatz-Runtime gestartet."
  exit 1
fi
exec "$NODE_BIN" "$APP_ROOT/desktop-launcher.mjs"
