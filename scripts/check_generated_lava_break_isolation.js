const assert = require("assert/strict");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");

const backendRoot = path.resolve(__dirname, "..");
const port = 18112;
const worldName = `LAVA_BREAK_${Date.now()}`;
const username = `Lava${Date.now() % 100000}`;
const dataFolder = path.join(os.tmpdir(), `pixelmania-lava-break-${process.pid}-${Date.now()}`);
const clientVersion = "1.0.1";
const serverOutput = [];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeKey(entry) {
  return `${Number(entry.x)},${Number(entry.y)}`;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`));
        }
      });
    });
    request.on("error", reject);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  const url = `http://127.0.0.1:${port}/dev/custom-movement/world-state?world=${worldName}`;
  while (Date.now() < deadline) {
    try {
      return await requestJson(url);
    } catch (_error) {
      await wait(100);
    }
  }
  throw new Error(`Backend did not become ready.\n${serverOutput.join("")}`);
}

function connectClient() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  const waiters = [];

  function send(payload) {
    ws.send(JSON.stringify({
      ...payload,
      client_version: clientVersion,
      client_platform: "lava_break_test",
    }));
  }

  function notify(message) {
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (!waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  function waitFor(predicate, label, timeoutMs = 10000) {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${label}.`));
      }, timeoutMs);
      waiters.push({ predicate, resolve, reject, timer });
    });
  }

  ws.on("message", (raw) => {
    try {
      notify(JSON.parse(String(raw)));
    } catch (_error) {
      // Ignore non-JSON frames in this protocol-level regression.
    }
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), 10000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({ ws, send, waitFor, messages });
    });
    ws.once("error", reject);
  });
}

function findBreakTarget(foreground) {
  const byKey = new Map(foreground.map((entry) => [makeKey(entry), entry]));
  const lava = foreground.filter((entry) => entry.block_type === "lava");
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (const lavaEntry of lava) {
    if (Number(lavaEntry.x) < 6 || Number(lavaEntry.x) > 93) continue;
    for (const [dx, dy] of offsets) {
      const candidate = byKey.get(`${Number(lavaEntry.x) + dx},${Number(lavaEntry.y) + dy}`);
      if (candidate && ["dirt", "sand", "stone"].includes(String(candidate.block_type))) {
        return candidate;
      }
    }
  }
  throw new Error("Fresh generated world did not contain a breakable block beside lava.");
}

async function run() {
  fs.rmSync(dataFolder, { recursive: true, force: true });
  const server = spawn(process.execPath, ["server.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      PUBLIC_WS_URL: `ws://127.0.0.1:${port}`,
      ENVIRONMENT: "development",
      NODE_ENV: "development",
      PIXELMANIA_ALLOW_DEV_TOOLS: "1",
      PIXELMANIA_ENABLE_DEV_BACKEND_LOGIN: "1",
      CUSTOM_TRUSTED_PLAYER_STATE_ENABLED: "true",
      TRUSTED_MOVEMENT_ALLOWLIST_ENABLED: "true",
      TRUSTED_MOVEMENT_ALLOWLIST: username,
      MAX_TRUSTED_POSITION_AGE_MS: "2000",
      MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION: "1500",
      POSTGRES_ENABLED: "false",
      REDIS_ENABLED: "false",
      DATA_FOLDER: dataFolder,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));

  let client = null;
  try {
    const beforePayload = await waitForServer();
    const beforeForeground = beforePayload.world_state.foreground;
    const breakTarget = findBreakTarget(beforeForeground);
    const lavaBefore = new Set(
      beforeForeground.filter((entry) => entry.block_type === "lava").map(makeKey)
    );
    assert(lavaBefore.size > 0, "Fresh generated world should contain bottom lava.");

    client = await connectClient();
    client.send({
      type: "dev_backend_login",
      request_id: "lava-login",
      username,
      world: worldName,
      movement_mode: "CUSTOM_AUTHORITATIVE",
    });
    await client.waitFor(
      (message) => message.type === "account_auth_ok" && message.action === "dev_backend_login",
      "dev backend login"
    );

    const playerX = Number(breakTarget.x) * 32;
    const playerY = Number(breakTarget.y) * 32;
    client.send({
      type: "custom_trusted_player_state",
      request_id: "lava-position",
      movement_mode: "CUSTOM_AUTHORITATIVE",
      world: worldName,
      world_id: worldName,
      x: playerX,
      y: playerY,
      velocity_x: 0,
      velocity_y: 0,
      facing: 1,
      peer_id: 77,
      tick: 1,
      player_node_path: "/root/LavaBreakTest",
    });
    await wait(100);

    client.send({
      type: "custom_trusted_player_state",
      request_id: "lava-position-wrong-type",
      movement_mode: "CUSTOM_AUTHORITATIVE",
      world: worldName,
      world_id: worldName,
      x: playerX,
      y: playerY,
      velocity_x: 0,
      velocity_y: 0,
      facing: 1,
      peer_id: 77,
      tick: 2,
      player_node_path: "/root/LavaBreakTest",
    });
    await wait(20);
    client.send({
      type: "world_block_update",
      request_id: "lava-wrong-type",
      action: "hit",
      layer: "foreground",
      x: Number(breakTarget.x),
      y: Number(breakTarget.y),
      block_type: "lava",
      world: worldName,
      hit_power: 1,
    });
    const wrongTypeResult = await client.waitFor(
      (message) => (
        message.request_id === "lava-wrong-type" &&
        (message.type === "world_block_update" || message.type === "action_rejected")
      ),
      "generated block wrong-type rejection"
    );
    assert.equal(wrongTypeResult.type, "action_rejected", JSON.stringify(wrongTypeResult));
    assert.equal(wrongTypeResult.reason, "block_changed", JSON.stringify(wrongTypeResult));
    await wait(80);

    let broke = false;
    for (let hit = 1; hit <= 8 && !broke; hit += 1) {
      const requestId = `lava-hit-${hit}`;
      client.send({
        type: "custom_trusted_player_state",
        request_id: `lava-position-${hit}`,
        movement_mode: "CUSTOM_AUTHORITATIVE",
        world: worldName,
        world_id: worldName,
        x: playerX,
        y: playerY,
        velocity_x: 0,
        velocity_y: 0,
        facing: 1,
        peer_id: 77,
        tick: hit + 2,
        player_node_path: "/root/LavaBreakTest",
      });
      await wait(20);
      client.send({
        type: "world_block_update",
        request_id: requestId,
        action: "hit",
        layer: "foreground",
        x: Number(breakTarget.x),
        y: Number(breakTarget.y),
        block_type: String(breakTarget.block_type),
        world: worldName,
        hit_power: 1,
      });
      const result = await client.waitFor(
        (message) => (
          message.request_id === requestId &&
          (message.type === "world_block_update" || message.type === "action_rejected")
        ),
        `block hit ${hit}`
      );
      assert.notEqual(result.type, "action_rejected", JSON.stringify(result));
      broke = result.action === "break";
      if (!broke) await wait(100);
    }
    assert.equal(broke, true, "Generated neighbor block should break within eight hits.");

    await wait(200);
    const afterPayload = await requestJson(
      `http://127.0.0.1:${port}/dev/custom-movement/world-state?world=${worldName}`
    );
    const afterForeground = afterPayload.world_state.foreground;
    const lavaAfter = new Set(
      afterForeground.filter((entry) => entry.block_type === "lava").map(makeKey)
    );

    assert.equal(afterForeground.some((entry) => makeKey(entry) === makeKey(breakTarget)), false);
    assert.deepEqual(lavaAfter, lavaBefore, "Breaking a generated neighbor must not add, move, or remove lava.");
    assert.deepEqual(
      afterPayload.world_state.removed_foreground.map(makeKey),
      [makeKey(breakTarget)],
      "Only the broken generated coordinate should be persisted as removed."
    );

    console.log(
      `[generated-lava-break-isolation] success world=${worldName} lava=${lavaBefore.size} broken=${makeKey(breakTarget)}`
    );
  } finally {
    if (client && client.ws) client.ws.close();
    server.kill("SIGINT");
    await wait(100);
    fs.rmSync(dataFolder, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error("[generated-lava-break-isolation] failed:", error.stack || error.message || error);
  process.exitCode = 1;
});
