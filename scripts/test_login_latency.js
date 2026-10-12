"use strict";

// Real client and WebSocket transport, disposable profile, synthetic auth server.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const http = require("node:http"), { spawn } = require("node:child_process");
const { WebSocketServer } = require("ws");
const root = path.resolve(__dirname, "..");
const client = process.env.PIXELMANIA_CLIENT_ROOT || path.resolve(root, "../pixel-mania");
const engine = process.env.GODOT_BIN || path.resolve(root, "../Godot/Godot_v4.7.1-stable_win64_console.exe");
const output = process.env.LOGIN_TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-login-"));
fs.mkdirSync(output, { recursive: true });

async function run(mode) {
  const server = http.createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end('{"entries":[]}'); });
  const sockets = new WebSocketServer({ server });
  let authRequests = 0;
  sockets.on("connection", socket => {
    socket.send(JSON.stringify({ type: "connected", player_id: "fixture-player" }));
    socket.on("message", raw => {
      const data = JSON.parse(raw);
      if (data.type === "login") socket.send(JSON.stringify({ type: "login_ok", name: "LatencyProbe" }));
      if (data.type === "client_ping") socket.send(JSON.stringify({ type: "client_pong", request_id: data.request_id }));
      if (!["account_login", "account_token_login"].includes(data.type)) return;
      authRequests++;
      assert.equal(data.type, mode === "saved" ? "account_token_login" : "account_login");
      const success = ["password", "saved", "slow"].includes(mode);
      const payload = success ? {
        type: "account_auth_ok", ok: true, request_id: data.request_id,
        username: "LatencyProbe", email: "latency@example.invalid", role: "player",
        session_token: "fixture-session-token", refresh_token: "fixture-refresh-token",
      } : {
        type: mode === "legacy" ? "rate_limited" : "account_auth_error", ok: false,
        action: data.type, reason: "rate_limited", message: "Fixture rate limit response",
        ...(mode === "legacy" ? {} : { request_id: data.request_id }),
      };
      setTimeout(() => { if (socket.readyState === 1) socket.send(JSON.stringify(payload)); }, mode === "slow" ? 8200 : 0);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(engine, ["--headless", "--path", client, "--script", "res://tests/login_latency_smoke.gd", "--",
        "--pixelmania-ws-url", `ws://127.0.0.1:${port}`, "--pixelmania-api-base", `http://127.0.0.1:${port}`, "--login-smoke-mode", mode],
      { windowsHide: true, env: { ...process.env, APPDATA: path.join(output, mode, "appdata"), XDG_DATA_HOME: path.join(output, mode, "data") } });
      let log = "";
      child.stdout.on("data", bytes => { log += bytes; });
      child.stderr.on("data", bytes => { log += bytes; });
      const timeout = setTimeout(() => child.kill(), 40000);
      child.once("error", reject);
      child.once("exit", code => {
        clearTimeout(timeout);
        fs.writeFileSync(path.join(output, `${mode}.log`), log);
        if (code !== 0 || /SCRIPT ERROR|Parse Error|Assertion failed/.test(log)) return reject(new Error(`${mode}: client failed; see ${output}`));
        const match = log.match(/LOGIN_LATENCY_SMOKE (\{[^\n]+\})/);
        if (!match) return reject(new Error(`${mode}: client did not finish login`));
        resolve(JSON.parse(match[1]));
      });
    });
    assert.equal(result.ok, true);
    assert.equal(authRequests, 1, "A successful first attempt must not replay credentials");
    console.log(result);
    return result;
  } finally {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
}
(async () => {
  const results = [];
  for (const mode of ["password", "saved", "legacy", "rejected", "slow"]) results.push(await run(mode));
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log("LOGIN_LATENCY_OK", output);
})().catch(error => { console.error(error); process.exitCode = 1; });
