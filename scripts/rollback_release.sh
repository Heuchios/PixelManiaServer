#!/usr/bin/env bash
set -Eeuo pipefail

YES=false
STATUS_ONLY=false
HEALTH_URL="http://127.0.0.1:8080/health"
HEALTH_ATTEMPTS=30

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes|-y)
      YES=true
      shift
      ;;
    --status)
      STATUS_ONLY=true
      shift
      ;;
    --health-url)
      HEALTH_URL="${2:?--health-url requires a value}"
      shift 2
      ;;
    --attempts)
      HEALTH_ATTEMPTS="${2:?--attempts requires a value}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if ! [[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "--attempts must be a positive integer." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${PIXELMANIA_RELEASE_ROOT:-}" ]; then
  BASE_DIR="$(cd "$PIXELMANIA_RELEASE_ROOT" && pwd)"
elif [ "$(basename "$SCRIPT_DIR")" = "bin" ]; then
  BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  BASE_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
fi

CURRENT_LINK="$BASE_DIR/current"
PREVIOUS_LINK="$BASE_DIR/previous"
SHARED_DIR="$BASE_DIR/shared"

describe_target() {
  local label="$1"
  local link_path="$2"
  local target=""
  if [ -L "$link_path" ]; then
    target="$(readlink -f "$link_path")"
  fi
  printf '%-8s -> %s\n' "$label" "${target:-missing}"
  if [ -n "$target" ] && [ -f "$target/release.json" ]; then
    sed -n '1,24p' "$target/release.json"
  fi
}

if [ "$STATUS_ONLY" = "true" ]; then
  describe_target "current" "$CURRENT_LINK"
  describe_target "previous" "$PREVIOUS_LINK"
  exit 0
fi

if [ ! -L "$CURRENT_LINK" ] || [ ! -L "$PREVIOUS_LINK" ]; then
  echo "Rollback requires both $CURRENT_LINK and $PREVIOUS_LINK symlinks." >&2
  exit 1
fi

current_target="$(readlink -f "$CURRENT_LINK")"
previous_target="$(readlink -f "$PREVIOUS_LINK")"
if [ "$current_target" = "$previous_target" ]; then
  echo "Rollback refused because current and previous resolve to the same directory." >&2
  exit 1
fi
if [ ! -f "$current_target/ecosystem.config.js" ] || [ ! -f "$previous_target/ecosystem.config.js" ]; then
  echo "Rollback target validation failed; both targets must contain ecosystem.config.js." >&2
  exit 1
fi

echo "PixelMania release rollback"
printf 'current  -> %s\n' "$current_target"
printf 'previous -> %s\n' "$previous_target"
if [ "$YES" != "true" ]; then
  read -r -p "Swap current and previous releases? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Rollback canceled."; exit 0 ;;
  esac
fi

swap_release_links() {
  local next_current="$1"
  local next_previous="$2"
  local current_temp="${CURRENT_LINK}.next.$$"
  local previous_temp="${PREVIOUS_LINK}.next.$$"
  rm -f -- "$current_temp" "$previous_temp"
  ln -s "$next_current" "$current_temp"
  ln -s "$next_previous" "$previous_temp"
  mv -Tf "$previous_temp" "$PREVIOUS_LINK"
  mv -Tf "$current_temp" "$CURRENT_LINK"
}

had_routes=0
if pm2 describe pixelmania-a >/dev/null 2>&1 || pm2 describe pixelmania-b >/dev/null 2>&1; then
  had_routes=1
fi
had_ops=0
if pm2 describe pixelmania-ops >/dev/null 2>&1; then
  had_ops=1
fi

activate_current() {
  local target="$(readlink -f "$CURRENT_LINK")"
  unset PIXELMANIA_RELEASE_ID SERVER_CLIENT_VERSION MIN_CLIENT_VERSION UPDATE_URL
  export PIXELMANIA_RELEASE_ROOT="$BASE_DIR"
  if [ -f "$target/.release-env" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$target/.release-env" || return 1
    set +a
  fi

  cd "$CURRENT_LINK" || return 1
  pm2 startOrReload ecosystem.config.js --env production --update-env || return 1
  if [ "$had_routes" = "1" ]; then
    PIXELMANIA_BACKEND_ROOT="$CURRENT_LINK" \
    PIXELMANIA_RELEASE_ROOT="$BASE_DIR" \
    ROUTE_PRODUCTION_PM2_CONFIG="$SHARED_DIR/ecosystem.route-production.config.js" \
    ROUTE_PRODUCTION_QUIET=true \
      bash scripts/start_route_production_instances.sh || return 1
  fi
  if [ "$had_ops" = "1" ]; then
    pm2 startOrReload ecosystem.ops.config.js --env production --update-env || return 1
  fi
  pm2 save || return 1
}

wait_for_health() {
  local attempt http_code active_release expected_release target
  target="$(readlink -f "$CURRENT_LINK")"
  expected_release=""
  if [ -f "$target/release.json" ]; then
    expected_release="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.release_id||""));' "$target/release.json")"
  fi
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    http_code="$(curl -sS "$HEALTH_URL" -o /tmp/pixelmania-rollback-health.json -w "%{http_code}" 2>/tmp/pixelmania-rollback-health.err || true)"
    if [ "$http_code" = "200" ]; then
      active_release="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.release_id||""));' /tmp/pixelmania-rollback-health.json)"
      if [ "$active_release" = "$expected_release" ]; then
        cat /tmp/pixelmania-rollback-health.json
        return 0
      fi
      echo "Rollback health is from release '${active_release:-legacy-root}', waiting for '${expected_release:-legacy-root}'."
    else
      echo "Rollback health is not ready: attempt ${attempt}/${HEALTH_ATTEMPTS} (http ${http_code:-curl_failed})."
    fi
    sleep 2
  done
  cat /tmp/pixelmania-rollback-health.err 2>/dev/null || true
  cat /tmp/pixelmania-rollback-health.json 2>/dev/null || true
  return 1
}

swap_release_links "$previous_target" "$current_target"

if activate_current && wait_for_health; then
  active_target="$(readlink -f "$CURRENT_LINK")"
  active_release="legacy-root"
  if [ -f "$active_target/release.json" ]; then
    active_release="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.release_id||"unknown"));' "$active_target/release.json")"
  fi
  printf '%s\n' "$active_release" > "$SHARED_DIR/current_release"
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$active_release" "rollback" >> "$SHARED_DIR/deployments.log"
  echo "Rollback complete."
  describe_target "current" "$CURRENT_LINK"
  describe_target "previous" "$PREVIOUS_LINK"
  exit 0
fi

echo "Rollback target failed health; restoring the original release." >&2
swap_release_links "$current_target" "$previous_target"
activate_current || true
wait_for_health || true
exit 1
