#!/usr/bin/env bash
set -euo pipefail

ROOT="${PIXELMANIA_BACKEND_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

PORT_A="${ROUTE_PRODUCTION_PORT_A:-18091}"
PORT_B="${ROUTE_PRODUCTION_PORT_B:-18092}"
ROUTE_BASE_WS_URL="${ROUTE_PRODUCTION_BASE_WS_URL:-wss://api.pixelmaniagame.com}"
ROUTE_A_WS_URL="${ROUTE_A_WS_URL:-${ROUTE_BASE_WS_URL%/}/ws-a}"
ROUTE_B_WS_URL="${ROUTE_B_WS_URL:-${ROUTE_BASE_WS_URL%/}/ws-b}"
DATA_ROOT="${ROUTE_PRODUCTION_DATA_ROOT:-/var/lib/pixelmania-route-production}"
CONFIG_PATH="${ROUTE_PRODUCTION_PM2_CONFIG:-$ROOT/ecosystem.route-production.config.js}"
ENFORCEMENT="${ROUTE_PRODUCTION_ENFORCEMENT_ENABLED:-true}"
REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT="${REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT:-$ENFORCEMENT}"
QUIET="${ROUTE_PRODUCTION_QUIET:-false}"

mkdir -p "$DATA_ROOT/a" "$DATA_ROOT/b"

cat > "$CONFIG_PATH" <<EOF
"use strict";

const path = require("path");
const root = process.env.PIXELMANIA_BACKEND_ROOT || __dirname;
const baseConfig = require(path.join(root, "ecosystem.config.js"));
for (const key of Object.keys(process.env)) {
  if (key.startsWith("OPS_DASHBOARD_")) {
    delete process.env[key];
  }
}

function withoutOpsDashboardEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("OPS_DASHBOARD_")));
}

const baseApp = baseConfig.apps && baseConfig.apps[0] ? baseConfig.apps[0] : {};
const baseEnv = withoutOpsDashboardEnv({
  ...(baseApp.env || {}),
  ...(baseApp.env_production || {}),
});

const commonEnv = {
  ...baseEnv,
  NODE_ENV: "production",
  ENVIRONMENT: "production",
  HOST: "127.0.0.1",
  REDIS_ENABLED: "true",
  POSTGRES_ENABLED: "true",
  POSTGRES_AUTHORITATIVE: "true",
  POSTGRES_AUTO_BOOTSTRAP: "false",
  ALLOW_AUTHORITATIVE_JSON_FALLBACK: "false",
  REQUIRE_POSTGRES_AUTHORITATIVE_FOR_GAMEPLAY: "true",
  REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT: "$REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT",
  PIXELMANIA_ALLOW_DEV_TOOLS: "false",
  PIXELMANIA_ENABLE_DEV_BACKEND_LOGIN: "false",
  WORLD_ROUTE_ENFORCEMENT_ENABLED: "$ENFORCEMENT",
  WORLD_SNAPSHOT_INTERVAL_MINUTES: "0",
  WORLD_SNAPSHOT_STARTUP_RUN: "false",
};

module.exports = {
  apps: [
    {
      name: "pixelmania-a",
      script: "server.js",
      cwd: root,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "512M",
      env: {
        ...commonEnv,
        PORT: "$PORT_A",
        PIXELMANIA_DATA_DIR: "$DATA_ROOT/a",
        PUBLIC_WS_URL: "$ROUTE_A_WS_URL",
        SERVER_INSTANCE_ID: "pixelmania-a",
        SERVER_INSTANCE_WS_URL: "$ROUTE_A_WS_URL"
      }
    },
    {
      name: "pixelmania-b",
      script: "server.js",
      cwd: root,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "512M",
      env: {
        ...commonEnv,
        PORT: "$PORT_B",
        PIXELMANIA_DATA_DIR: "$DATA_ROOT/b",
        PUBLIC_WS_URL: "$ROUTE_B_WS_URL",
        SERVER_INSTANCE_ID: "pixelmania-b",
        SERVER_INSTANCE_WS_URL: "$ROUTE_B_WS_URL"
      }
    }
  ]
};
EOF

node --check "$CONFIG_PATH"
pm2 delete pixelmania-a pixelmania-b >/dev/null 2>&1 || true
pm2 startOrReload "$CONFIG_PATH" --update-env
pm2 save

if [ "$QUIET" = "true" ]; then
  cat <<EOF
[route-production] started:
  pixelmania-a -> 127.0.0.1:$PORT_A ($ROUTE_A_WS_URL)
  pixelmania-b -> 127.0.0.1:$PORT_B ($ROUTE_B_WS_URL)
  enforcement  -> $ENFORCEMENT
EOF
else
  cat <<EOF
[route-production] started:
  pixelmania-a -> 127.0.0.1:$PORT_A ($ROUTE_A_WS_URL)
  pixelmania-b -> 127.0.0.1:$PORT_B ($ROUTE_B_WS_URL)
  enforcement  -> $ENFORCEMENT

Add these Caddy routes inside the api.pixelmaniagame.com site block before the
default reverse_proxy:

handle /ws-a* {
  reverse_proxy 127.0.0.1:$PORT_A
}

handle /ws-b* {
  reverse_proxy 127.0.0.1:$PORT_B
}

Then run:
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  curl -s http://127.0.0.1:$PORT_A/health | head
  curl -s http://127.0.0.1:$PORT_B/health | head

ROUTE_PRODUCTION_ENFORCEMENT_ENABLED defaults to true for route sharding.
Set it to false only for an emergency single-route fallback.
EOF
fi
