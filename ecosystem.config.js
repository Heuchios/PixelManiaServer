const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

const productionEnv = {
  NODE_ENV: env("NODE_ENV", "production"),
  HOST: env("HOST", "127.0.0.1"),
  PORT: env("PORT", "8080"),
  PUBLIC_BASE_URL: env("PUBLIC_BASE_URL", "https://api.pixelmaniagame.com"),
  PUBLIC_WS_URL: env("PUBLIC_WS_URL", "wss://api.pixelmaniagame.com/ws"),
  SERVER_CLIENT_VERSION: env("SERVER_CLIENT_VERSION", "1.0.1"),
  MIN_CLIENT_VERSION: env("MIN_CLIENT_VERSION", env("SERVER_CLIENT_VERSION", "1.0.1")),
  UPDATE_URL: env("UPDATE_URL", "https://pixelmaniagame.com"),
  PIXELMANIA_DATA_DIR: env("PIXELMANIA_DATA_DIR", "/var/lib/pixelmania"),
  ALLOW_LEGACY_PLAYER_STATE_IMPORT: env("ALLOW_LEGACY_PLAYER_STATE_IMPORT", "false"),
  POSTGRES_ENABLED: env("POSTGRES_ENABLED", "true"),
  POSTGRES_AUTHORITATIVE: env("POSTGRES_AUTHORITATIVE", "true"),
  POSTGRES_AUTO_BOOTSTRAP: env("POSTGRES_AUTO_BOOTSTRAP", "true"),
  POSTGRES_HOST: env("POSTGRES_HOST", "127.0.0.1"),
  POSTGRES_PORT: env("POSTGRES_PORT", "5432"),
  POSTGRES_DATABASE: env("POSTGRES_DATABASE", "pixelmania"),
  POSTGRES_USER: env("POSTGRES_USER", "pixelmania"),
  POSTGRES_PASSWORD: env("POSTGRES_PASSWORD"),
  POSTGRES_SSL: env("POSTGRES_SSL", "false"),
  POSTGRES_SCHEMA: env("POSTGRES_SCHEMA", "pixelmania"),
  POSTGRES_POOL_MAX: env("POSTGRES_POOL_MAX", "10"),
  POSTGRES_WRITE_QUEUE_MAX: env("POSTGRES_WRITE_QUEUE_MAX", "1000"),
  POSTGRES_BOOTSTRAP_SQL_PATH: env("POSTGRES_BOOTSTRAP_SQL_PATH", "docs/postgres_security_foundation.sql"),
  REDIS_ENABLED: env("REDIS_ENABLED", "false"),
  REDIS_URL: env("REDIS_URL", "redis://127.0.0.1:6379"),
  REDIS_KEY_PREFIX: env("REDIS_KEY_PREFIX", "pixelmania"),
  REDIS_CONNECT_TIMEOUT_MS: env("REDIS_CONNECT_TIMEOUT_MS", "1500"),
  REDIS_ACTION_LOCK_TTL_MS: env("REDIS_ACTION_LOCK_TTL_MS", "5000"),
  REDIS_PRESENCE_TTL_MS: env("REDIS_PRESENCE_TTL_MS", "45000"),
  REDIS_ACTIVE_SESSION_TTL_MS: env("REDIS_ACTIVE_SESSION_TTL_MS", "120000"),
  WORLD_SNAPSHOT_STORAGE: env("WORLD_SNAPSHOT_STORAGE", "local"),
  WORLD_SNAPSHOT_SPACES_TARGET: env("WORLD_SNAPSHOT_SPACES_TARGET"),
  WORLD_SNAPSHOT_SPACES_ENDPOINT: env("WORLD_SNAPSHOT_SPACES_ENDPOINT"),
  WORLD_SNAPSHOT_SPACES_REGION: env("WORLD_SNAPSHOT_SPACES_REGION", "tor1"),
  WORLD_SNAPSHOT_POSTGRES_INLINE: env("WORLD_SNAPSHOT_POSTGRES_INLINE", "false"),
  SMTP_HOST: env("SMTP_HOST"),
  SMTP_PORT: env("SMTP_PORT", "587"),
  SMTP_SECURE: env("SMTP_SECURE", "false"),
  SMTP_USER: env("SMTP_USER"),
  SMTP_PASS: env("SMTP_PASS"),
  SMTP_FROM: env("SMTP_FROM", "PixelMania <no-reply@pixelmaniagame.com>"),
  TEST_EMAIL_TO: env("TEST_EMAIL_TO"),
};

module.exports = {
  apps: [
    {
      name: "pixelmania",
      script: "server.js",
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "512M",
      env: productionEnv,
      env_production: productionEnv,
    },
  ],
};
