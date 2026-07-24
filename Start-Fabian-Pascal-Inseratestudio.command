#!/bin/zsh
set -euo pipefail

APP_ROOT="${0:A:h}"
WORK_ROOT="$APP_ROOT/work"
DATA_ROOT="$HOME/Library/Application Support/Fabian-Pascal Inseratestudio"

mkdir -p "$WORK_ROOT" "$DATA_ROOT"
chmod 700 "$DATA_ROOT"

NODE_BIN="$(command -v node || true)"
PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$NODE_BIN" && -x "$HOME/.local/bin/node" ]]; then
  NODE_BIN="$HOME/.local/bin/node"
fi
if [[ -z "$PNPM_BIN" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm" ]]; then
  PNPM_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
fi
if [[ -z "$NODE_BIN" || -z "$PNPM_BIN" ]]; then
  print -u2 "Node.js 22 und pnpm wurden nicht gefunden."
  read -k 1 "?Taste drücken zum Schließen …"
  exit 1
fi
if ! /usr/bin/swift --version >/dev/null 2>&1; then
  print -u2 "Swift wurde nicht gefunden. Bitte zuerst 'xcode-select --install' ausführen."
  read -k 1 "?Taste drücken zum Schließen …"
  exit 1
fi

export PATH="${NODE_BIN:h}:${PNPM_BIN:h}:$PATH"

if [[ ! -d "$APP_ROOT/node_modules" ]]; then
  cd "$APP_ROOT"
  "$PNPM_BIN" install --frozen-lockfile
fi

if ! /usr/bin/curl --silent --fail --max-time 2 "http://127.0.0.1:43182/health" >/dev/null 2>&1; then
  cd "$APP_ROOT"
  nohup "$NODE_BIN" local-upload-server.mjs > "$WORK_ROOT/helper.out.log" 2> "$WORK_ROOT/helper.err.log" &
fi

if ! /usr/bin/curl --silent --fail --max-time 2 "http://127.0.0.1:43181" >/dev/null 2>&1; then
  cd "$APP_ROOT"
  "$PNPM_BIN" run build > "$WORK_ROOT/build.out.log" 2> "$WORK_ROOT/build.err.log"
  nohup "$PNPM_BIN" run start > "$WORK_ROOT/studio.out.log" 2> "$WORK_ROOT/studio.err.log" &
fi

for attempt in {1..30}; do
  if /usr/bin/curl --silent --fail --max-time 1 "http://127.0.0.1:43181" >/dev/null 2>&1 \
    && /usr/bin/curl --silent --fail --max-time 1 "http://127.0.0.1:43182/health" >/dev/null 2>&1; then
    /usr/bin/open "http://127.0.0.1:43181/"
    exit 0
  fi
  sleep 1
done

print -u2 "Das Inseratestudio konnte nicht gestartet werden. Details stehen unter $WORK_ROOT."
read -k 1 "?Taste drücken zum Schließen …"
exit 1
