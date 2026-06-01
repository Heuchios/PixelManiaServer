const productionEnv = {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "8080",
  PUBLIC_BASE_URL: "https://api.pixelmaniagame.com",
  PUBLIC_WS_URL: "wss://api.pixelmaniagame.com/ws",
  PIXELMANIA_DATA_DIR: "/var/lib/pixelmania",
  POSTGRES_ENABLED: "true",
  POSTGRES_HOST: "127.0.0.1",
  POSTGRES_PORT: "5432",
  POSTGRES_DATABASE: "pixelmania",
  POSTGRES_USER: "pixelmania",
  POSTGRES_PASSWORD: "CHANGE_THIS_PASSWORD",
  POSTGRES_SSL: "false",
  POSTGRES_SCHEMA: "pixelmania",
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
