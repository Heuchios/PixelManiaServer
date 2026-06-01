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
  PIXELMANIA_DATA_DIR: env("PIXELMANIA_DATA_DIR", "/var/lib/pixelmania"),
  POSTGRES_ENABLED: env("POSTGRES_ENABLED", "true"),
  POSTGRES_AUTHORITATIVE: env("POSTGRES_AUTHORITATIVE", "true"),
  POSTGRES_HOST: env("POSTGRES_HOST", "127.0.0.1"),
  POSTGRES_PORT: env("POSTGRES_PORT", "5432"),
  POSTGRES_DATABASE: env("POSTGRES_DATABASE", "pixelmania"),
  POSTGRES_USER: env("POSTGRES_USER", "pixelmania"),
  POSTGRES_PASSWORD: env("POSTGRES_PASSWORD"),
  POSTGRES_SSL: env("POSTGRES_SSL", "false"),
  POSTGRES_SCHEMA: env("POSTGRES_SCHEMA", "pixelmania"),
  REDIS_ENABLED: env("REDIS_ENABLED", "false"),
  REDIS_URL: env("REDIS_URL"),
  WORLD_SNAPSHOT_STORAGE: env("WORLD_SNAPSHOT_STORAGE", "local"),
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
