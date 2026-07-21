#!/usr/bin/env bash
set -Eeuo pipefail

BACKEND_ROOT="${1:?Usage: activate_main_release.sh BACKEND_ROOT [APP_NAME]}"
APP_NAME="${2:-pixelmania}"
CONFIG_FILE="$BACKEND_ROOT/ecosystem.config.js"
EXPECTED_SCRIPT="$BACKEND_ROOT/server.js"

if [ ! -f "$CONFIG_FILE" ] || [ ! -f "$EXPECTED_SCRIPT" ]; then
  echo "Release activation requires $CONFIG_FILE and $EXPECTED_SCRIPT." >&2
  exit 1
fi

pm2_script_path() {
  pm2 jlist | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const appName = process.argv[1];
      const app = JSON.parse(input).find((entry) => entry && entry.name === appName);
      process.stdout.write(String(app && app.pm2_env && app.pm2_env.pm_exec_path || ""));
    });
  ' "$APP_NAME"
}

script_matches_release() {
  local candidate="$1"
  local candidate_real=""
  local expected_real=""
  [ -n "$candidate" ] || return 1
  [ "$candidate" = "$EXPECTED_SCRIPT" ] && return 0
  candidate_real="$(readlink -f -- "$candidate" 2>/dev/null || true)"
  expected_real="$(readlink -f -- "$EXPECTED_SCRIPT" 2>/dev/null || true)"
  [ -n "$candidate_real" ] && [ "$candidate_real" = "$expected_real" ]
}

current_script="$(pm2_script_path)"
if [ -n "$current_script" ] && ! script_matches_release "$current_script"; then
  echo "Recreating $APP_NAME so PM2 adopts the versioned release path."
  pm2 delete "$APP_NAME"
fi

export PIXELMANIA_BACKEND_ROOT="$BACKEND_ROOT"
cd "$BACKEND_ROOT"
pm2 startOrReload ecosystem.config.js --only "$APP_NAME" --env production --update-env

active_script="$(pm2_script_path)"
if ! script_matches_release "$active_script"; then
  echo "$APP_NAME is still using '${active_script:-unknown}', expected $EXPECTED_SCRIPT." >&2
  exit 1
fi

echo "$APP_NAME PM2 path: $active_script"
