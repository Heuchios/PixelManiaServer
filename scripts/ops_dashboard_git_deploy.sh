#!/usr/bin/env bash
set -euo pipefail

ROOT="${PIXELMANIA_BACKEND_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

REMOTE="${OPS_DEPLOY_REMOTE:-origin}"
BRANCH="${OPS_DEPLOY_BRANCH:-main}"
ALLOW_WITH_PLAYERS="${OPS_DEPLOY_ALLOW_WITH_PLAYERS:-false}"
MAIN_HEALTH_URL="${OPS_DEPLOY_MAIN_HEALTH_URL:-http://127.0.0.1:8080/health}"
ROUTE_A_HEALTH_URL="${OPS_DEPLOY_ROUTE_A_HEALTH_URL:-http://127.0.0.1:18091/health}"
ROUTE_B_HEALTH_URL="${OPS_DEPLOY_ROUTE_B_HEALTH_URL:-http://127.0.0.1:18092/health}"

section() {
  printf '\n== %s ==\n' "$1"
}

health_players() {
  local label="$1"
  local url="$2"
  local body
  local players
  if body="$(curl -fsS "$url" 2>/dev/null)" && players="$(printf '%s' "$body" | node -e '
    let body = "";
    process.stdin.on("data", (chunk) => body += chunk);
    process.stdin.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const persistence = payload.persistence || {};
      const worldIndex = persistence.world_index || {};
      const players = Number(worldIndex.indexed_player_count || 0);
      console.log(Number.isFinite(players) ? Math.max(0, players) : 0);
    });
  ' 2>/dev/null)"; then
    echo "$players"
    return 0
  fi
  echo "Could not read health for ${label} at ${url}." >&2
  echo 0
}

wait_for_health() {
  local label="$1"
  local url="$2"
  local attempt
  local body
  local last_error=""
  local error_file
  error_file="$(mktemp)"
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if body="$(curl -fsS "$url" 2>"$error_file")"; then
      if printf '%s' "$body" | node -e '
      let body = "";
      process.stdin.on("data", (chunk) => body += chunk);
      process.stdin.on("end", () => {
        const payload = JSON.parse(body || "{}");
        const persistence = payload.persistence || {};
        if (payload.ok === false) process.exit(1);
        if (!persistence.postgres_ready || !persistence.redis_ready) process.exit(1);
      });
    ' 2>"$error_file"; then
        rm -f "$error_file"
        echo "${label}: healthy"
        return 0
      fi
      last_error="health payload is not ready yet"
    else
      last_error="$(cat "$error_file" 2>/dev/null || true)"
    fi
    echo "${label}: waiting for health (${attempt}/10)"
    sleep 2
  done
  echo "${label}: health check failed at ${url}" >&2
  if [ -n "$last_error" ]; then
    echo "$last_error" >&2
  fi
  rm -f "$error_file"
  return 1
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Deploy aborted: ${ROOT} is not a git checkout." >&2
  exit 1
fi

if [ "$ALLOW_WITH_PLAYERS" != "true" ]; then
  section "Player guard"
  main_players="$(health_players main "$MAIN_HEALTH_URL")"
  route_a_players="$(health_players ws-a "$ROUTE_A_HEALTH_URL")"
  route_b_players="$(health_players ws-b "$ROUTE_B_HEALTH_URL")"
  total_players=$((main_players + route_a_players + route_b_players))
  echo "players: main=${main_players}, ws-a=${route_a_players}, ws-b=${route_b_players}"
  if [ "$total_players" -gt 0 ]; then
    echo "Deploy blocked: ${total_players} player(s) online." >&2
    exit 42
  fi
fi

section "Fetch"
git fetch "$REMOTE" "$BRANCH" 2>&1
current_ref="$(git rev-parse HEAD)"
remote_ref="$(git rev-parse "${REMOTE}/${BRANCH}" 2>/dev/null || git rev-parse FETCH_HEAD)"
echo "current: ${current_ref}"
echo "remote:  ${remote_ref}"

if [ "$current_ref" != "$remote_ref" ]; then
  section "Fast-forward"
  if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
    echo "Deploy aborted: tracked files are dirty. Run the local deploy or clean/commit production changes before pulling from git." >&2
    git status --short | sed -n '1,80p' >&2
    exit 1
  fi
  git pull --ff-only "$REMOTE" "$BRANCH" 2>&1
else
  echo "Already at ${REMOTE}/${BRANCH}; validating and reloading current server files."
fi

section "Install"
npm install --omit=dev

section "Syntax checks"
node --check server.js
node --check server_item_database.js
node --check item_atlas_db.js
node --check postgres_store.js
node --check redis_store.js
node --check ops_dashboard_server.js
node --check ecosystem.config.js
node --check ecosystem.ops.config.js
bash -n scripts/start_route_production_instances.sh
bash -n scripts/ops_dashboard_git_deploy.sh

section "Security wiring checks"
npm run check:security

section "Reload PM2"
pm2 startOrReload ecosystem.config.js --env production --update-env
ROUTE_PRODUCTION_QUIET=true bash scripts/start_route_production_instances.sh
pm2 save

section "Health"
wait_for_health main "$MAIN_HEALTH_URL"
wait_for_health ws-a "$ROUTE_A_HEALTH_URL"
wait_for_health ws-b "$ROUTE_B_HEALTH_URL"

section "Done"
echo "Deploy completed successfully."
