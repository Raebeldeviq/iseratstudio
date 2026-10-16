#!/bin/zsh
set -euo pipefail
SCRIPT_DIR="${0:A:h}"
RUNTIME_ROOT="${CODEX_PRIMARY_RUNTIME:-${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies}"
NODE_BIN="${RUNTIME_ROOT}/node/bin/node"
if [[ ! -x "${NODE_BIN}" || ! -d "${SCRIPT_DIR}/node_modules/@oai/artifact-tool" ]]; then
  print -u2 "Lokale Monitor-Abhängigkeiten fehlen. Keine Cloud-Alternative wird gestartet."
  exit 2
fi
exec "${NODE_BIN}" "${SCRIPT_DIR}/monitor.mjs" "$@"
