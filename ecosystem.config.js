const productionEnv = {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "8080",
  PUBLIC_BASE_URL: "https://api.pixelmaniagame.com",
  PUBLIC_WS_URL: "wss://api.pixelmaniagame.com/ws",
  PIXELMANIA_DATA_DIR: "/var/lib/pixelmania",
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
