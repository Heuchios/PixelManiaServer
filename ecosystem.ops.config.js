const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

module.exports = {
  apps: [
    {
      name: "pixelmania-ops",
      script: "ops_dashboard_server.js",
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: env("NODE_ENV", "production"),
        OPS_DASHBOARD_HOST: env("OPS_DASHBOARD_HOST", "127.0.0.1"),
        OPS_DASHBOARD_PORT: env("OPS_DASHBOARD_PORT", "9090"),
        OPS_DASHBOARD_TOKEN: env("OPS_DASHBOARD_TOKEN"),
        OPS_DASHBOARD_TOKEN_HASH: env("OPS_DASHBOARD_TOKEN_HASH"),
        OPS_DASHBOARD_ADMIN_USERNAME: env("OPS_DASHBOARD_ADMIN_USERNAME", "admin"),
        OPS_DASHBOARD_ADMIN_EMAIL: env("OPS_DASHBOARD_ADMIN_EMAIL"),
        OPS_DASHBOARD_ADMIN_PASSWORD_HASH: env("OPS_DASHBOARD_ADMIN_PASSWORD_HASH"),
        OPS_DASHBOARD_ACCOUNT_FILE: env("OPS_DASHBOARD_ACCOUNT_FILE"),
        OPS_DASHBOARD_SESSION_SECRET: env("OPS_DASHBOARD_SESSION_SECRET"),
        OPS_DASHBOARD_SESSION_TTL_HOURS: env("OPS_DASHBOARD_SESSION_TTL_HOURS", "12"),
        OPS_DASHBOARD_COOKIE_SECURE: env("OPS_DASHBOARD_COOKIE_SECURE", "false"),
        OPS_DASHBOARD_PUBLIC_BASE_URL: env("OPS_DASHBOARD_PUBLIC_BASE_URL", "http://127.0.0.1:9090"),
        OPS_DASHBOARD_EMAIL_VERIFICATION_TTL_MINUTES: env("OPS_DASHBOARD_EMAIL_VERIFICATION_TTL_MINUTES", "60"),
        OPS_DASHBOARD_PASSWORD_RESET_TTL_MINUTES: env("OPS_DASHBOARD_PASSWORD_RESET_TTL_MINUTES", "30"),
        OPS_DASHBOARD_MIN_PASSWORD_LENGTH: env("OPS_DASHBOARD_MIN_PASSWORD_LENGTH", "10"),
        OPS_DASHBOARD_LOGIN_CODE_ENABLED: env("OPS_DASHBOARD_LOGIN_CODE_ENABLED", "false"),
        OPS_DASHBOARD_LOGIN_CODE_TTL_MINUTES: env("OPS_DASHBOARD_LOGIN_CODE_TTL_MINUTES", "10"),
        SMTP_HOST: env("SMTP_HOST"),
        SMTP_PORT: env("SMTP_PORT", "587"),
        SMTP_SECURE: env("SMTP_SECURE", "false"),
        SMTP_USER: env("SMTP_USER"),
        SMTP_PASS: env("SMTP_PASS"),
        SMTP_FROM: env("SMTP_FROM", "PixelMania Ops <no-reply@pixelmania.local>"),
        OPS_DASHBOARD_HEALTH_URL: env("OPS_DASHBOARD_HEALTH_URL", "http://127.0.0.1:8080/health"),
        OPS_DASHBOARD_ROUTE_TARGETS: env("OPS_DASHBOARD_ROUTE_TARGETS", "ws-a|pixelmania-a|http://127.0.0.1:18091/health|wss://api.pixelmaniagame.com/ws-a;ws-b|pixelmania-b|http://127.0.0.1:18092/health|wss://api.pixelmaniagame.com/ws-b"),
        OPS_DASHBOARD_PM2_APP: env("OPS_DASHBOARD_PM2_APP", "pixelmania"),
        OPS_DASHBOARD_PM2_ECOSYSTEM: env("OPS_DASHBOARD_PM2_ECOSYSTEM", "ecosystem.config.js"),
        OPS_DASHBOARD_ALLOW_CONTROL: env("OPS_DASHBOARD_ALLOW_CONTROL", "false"),
        OPS_DASHBOARD_ALLOWED_ACTIONS: env("OPS_DASHBOARD_ALLOWED_ACTIONS", "restart"),
        OPS_DASHBOARD_RESTART_APPS: env("OPS_DASHBOARD_RESTART_APPS", "pixelmania,pixelmania-a,pixelmania-b"),
        OPS_DASHBOARD_RESTART_COMMAND: env("OPS_DASHBOARD_RESTART_COMMAND", "pm2 startOrReload ecosystem.config.js --env production --update-env && bash scripts/start_route_production_instances.sh"),
        OPS_DASHBOARD_START_COMMAND: env("OPS_DASHBOARD_START_COMMAND", "pm2 startOrReload ecosystem.config.js --env production --update-env && bash scripts/start_route_production_instances.sh"),
        OPS_DASHBOARD_STOP_COMMAND: env("OPS_DASHBOARD_STOP_COMMAND", "for app in pixelmania pixelmania-a pixelmania-b; do pm2 stop \"$app\" || true; done; pm2 save"),
        OPS_DASHBOARD_ALLOW_STOP_WITH_PLAYERS: env("OPS_DASHBOARD_ALLOW_STOP_WITH_PLAYERS", "false"),
        OPS_DASHBOARD_ALLOW_DEPLOY_WITH_PLAYERS: env("OPS_DASHBOARD_ALLOW_DEPLOY_WITH_PLAYERS", "false"),
        OPS_DASHBOARD_ALLOW_ROLLBACK_WITH_PLAYERS: env("OPS_DASHBOARD_ALLOW_ROLLBACK_WITH_PLAYERS", "false"),
        OPS_DASHBOARD_CONFIRM_ACTIONS: env("OPS_DASHBOARD_CONFIRM_ACTIONS", "stop,deploy,rollback"),
        OPS_DASHBOARD_DEPLOY_COMMAND: env("OPS_DASHBOARD_DEPLOY_COMMAND", "bash scripts/ops_dashboard_git_deploy.sh"),
        OPS_DASHBOARD_DEPLOY_CWD: env("OPS_DASHBOARD_DEPLOY_CWD", __dirname),
        OPS_DASHBOARD_ROLLBACK_COMMAND: env("OPS_DASHBOARD_ROLLBACK_COMMAND", "bash scripts/ops_dashboard_git_rollback.sh"),
        OPS_DASHBOARD_ROLLBACK_CWD: env("OPS_DASHBOARD_ROLLBACK_CWD", __dirname),
        OPS_DASHBOARD_LOG_FILE: env("OPS_DASHBOARD_LOG_FILE"),
        OPS_DASHBOARD_AUDIT_LOG_PATH: env("OPS_DASHBOARD_AUDIT_LOG_PATH"),
      },
      env_production: {
        NODE_ENV: env("NODE_ENV", "production"),
      },
    },
  ],
};
