#!/usr/bin/env bash
set -euo pipefail

ROOT="${PIXELMANIA_BACKEND_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

PORT_A="${ROUTE_STAGING_PORT_A:-18081}"
PORT_B="${ROUTE_STAGING_PORT_B:-18082}"
ROUTE_BASE_WS_URL="${ROUTE_STAGING_BASE_WS_URL:-wss://api.pixelmaniagame.com}"
ROUTE_A_WS_URL="${ROUTE_A_WS_URL:-${ROUTE_BASE_WS_URL%/}/staging-ws-a}"
ROUTE_B_WS_URL="${ROUTE_B_WS_URL:-${ROUTE_BASE_WS_URL%/}/staging-ws-b}"
REDIS_URL_VALUE="${REDIS_URL:-redis://127.0.0.1:6379}"
REDIS_KEY_PREFIX_VALUE="${ROUTE_STAGING_REDIS_KEY_PREFIX:-pixelmania_route_staging}"
DATA_ROOT="${ROUTE_STAGING_DATA_ROOT:-/tmp/pixelmania-route-staging}"
CONFIG_PATH="${ROUTE_STAGING_PM2_CONFIG:-$ROOT/ecosystem.route-staging.config.js}"

mkdir -p "$DATA_ROOT/a" "$DATA_ROOT/b"

cat > "$CONFIG_PATH" <<EOF
"use strict";

const commonEnv = {
  NODE_ENV: "development",
  ENVIRONMENT: "development",
  HOST: "127.0.0.1",
  PUBLIC_BASE_URL: "https://api.pixelmaniagame.com",
  SERVER_CLIENT_VERSION: "0.0.0",
  MIN_CLIENT_VERSION: "0.0.0",
  UPDATE_URL: "https://pixelmaniagame.com",
  PIXELMANIA_ALLOW_DEV_TOOLS: "true",
  PIXELMANIA_ENABLE_DEV_BACKEND_LOGIN: "true",
  MAX_PLAYERS_PER_WORLD: "50",
  REDIS_ENABLED: "true",
  REDIS_URL: "$REDIS_URL_VALUE",
  REDIS_KEY_PREFIX: "$REDIS_KEY_PREFIX_VALUE",
  REDIS_CONNECT_TIMEOUT_MS: "1500",
  WORLD_ADMISSION_TTL_MS: "45000",
  WORLD_ROUTE_TTL_MS: "45000",
  WORLD_ROUTE_ENFORCEMENT_ENABLED: "true",
  REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT: "true",
  POSTGRES_ENABLED: "false",
  POSTGRES_AUTHORITATIVE: "false",
  POSTGRES_AUTO_BOOTSTRAP: "false",
  DISABLE_POSTGRES: "true",
  PIXELMANIA_DISABLE_POSTGRES: "true",
  WORLD_SNAPSHOT_INTERVAL_MINUTES: "0",
  WORLD_SNAPSHOT_STARTUP_RUN: "false",
  WORLD_SNAPSHOT_STORAGE: "local",
  SMTP_HOST: ""
};

module.exports = {
  apps: [
    {
      name: "pixelmania-route-a",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "256M",
      env: {
        ...commonEnv,
        PORT: "$PORT_A",
        PIXELMANIA_DATA_DIR: "$DATA_ROOT/a",
        PUBLIC_WS_URL: "$ROUTE_A_WS_URL",
        SERVER_INSTANCE_ID: "route-stage-a",
        SERVER_INSTANCE_WS_URL: "$ROUTE_A_WS_URL"
      }
    },
    {
      name: "pixelmania-route-b",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "256M",
      env: {
        ...commonEnv,
        PORT: "$PORT_B",
        PIXELMANIA_DATA_DIR: "$DATA_ROOT/b",
        PUBLIC_WS_URL: "$ROUTE_B_WS_URL",
        SERVER_INSTANCE_ID: "route-stage-b",
        SERVER_INSTANCE_WS_URL: "$ROUTE_B_WS_URL"
      }
    }
  ]
};
EOF

node --check "$CONFIG_PATH"
pm2 startOrReload "$CONFIG_PATH" --update-env
pm2 save

cat <<EOF
[route-staging] started:
  pixelmania-route-a -> 127.0.0.1:$PORT_A ($ROUTE_A_WS_URL)
  pixelmania-route-b -> 127.0.0.1:$PORT_B ($ROUTE_B_WS_URL)
  redis prefix       -> $REDIS_KEY_PREFIX_VALUE

Add these Caddy routes inside the api.pixelmaniagame.com site block before the
default reverse_proxy:

@pixelmaniaRouteStageA path /staging-ws-a*
reverse_proxy @pixelmaniaRouteStageA 127.0.0.1:$PORT_A

@pixelmaniaRouteStageB path /staging-ws-b*
reverse_proxy @pixelmaniaRouteStageB 127.0.0.1:$PORT_B

Then run:
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  npm run smoke:world-route:public -- --owner-url "$ROUTE_A_WS_URL" --other-url "$ROUTE_B_WS_URL"
EOF
