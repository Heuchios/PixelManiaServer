"use strict";
// Isolated loopback server, development identities and disposable data only.
// Delays simulate application RTT/jitter with ordered delivery, not TCP loss.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const root = path.resolve(__dirname, "..");
const output = path.resolve(process.env.PERF_OUTPUT_DIR || path.join(os.tmpdir(), `pixelmania-perf-${Date.now()}`));
fs.mkdirSync(output, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let requestSequence = 0;
const req = prefix => `${prefix}-${++requestSequence}`;
const clients = [];
let server;
let moving;

function percentile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
}

class Client {
  constructor(port, index, rtt) {
    this.index = index;
    this.rtt = rtt;
    this.messages = [];
    this.cells = new Map();
    this.drops = new Map();
    this.waiters = new Set();
    this.nextSend = 0;
    this.nextReceive = 0;
    this.sequence = 0;
    this.movementBytes = 0;
    this.movementItems = 0;
    this.legacyEquivalentBytes = 0;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on("error", error => { this.error = error; });
    this.ws.on("message", raw => {
      const data = JSON.parse(raw.toString());
      if (data.type === "player_position_batch") {
        this.movementBytes += raw.length;
        this.movementItems += (data.players || []).length;
        const aliases = { equipped_tool:"hand", equipped_back_item:"back", equipped_back:"back", equipped_hat_item:"hat",
          equipped_hair_item:"hair", equipped_eyewear_item:"eyewear", equipped_shirt_item:"shirt", equipped_pants_item:"pants",
          equipped_shoes_item:"shoes", equipped_ride_item:"ride" };
        const expanded = { ...data, players: (data.players || []).map(item => {
          const result = {...item};
          if (item.equipment_slots) for (const [alias,slot] of Object.entries(aliases)) result[alias]=item.equipment_slots[slot] || "";
          return result;
        }) };
        this.legacyEquivalentBytes += Buffer.byteLength(JSON.stringify(expanded));
      }
      const due = Math.max(this.nextReceive, performance.now() + this.delay());
      this.nextReceive = due;
      setTimeout(() => this.receive(data), Math.max(0, due - performance.now()));
    });
  }
  delay() { return this.rtt / 2 + Math.sin(++requestSequence * 1.7) * this.rtt * 0.15; }
  receive(data) {
    if (data.type === "world_update_batch") {
      for (const item of data.updates || []) this.receive({ world: data.world, ...item });
      return;
    }
    if (data.type === "world_block_update" && ["break", "place"].includes(data.action)) {
      this.cells.set(`${data.layer}:${data.x}:${data.y}`, data.action === "break" ? "" : data.block_type);
    }
    if (data.type === "drop_spawned") {
      assert(data.drop_id, "Drop must have an authoritative ID");
      this.drops.set(data.drop_id, data);
    }
    this.messages.push(data);
    if (this.messages.length > 3000) this.messages.shift();
    for (const waiter of this.waiters) {
      if (waiter.predicate(data)) {
        clearTimeout(waiter.timeout);
        this.waiters.delete(waiter);
        waiter.resolve(data);
      }
    }
  }
  send(data) {
    const due = Math.max(this.nextSend, performance.now() + this.delay());
    this.nextSend = due;
    setTimeout(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ client_version: "999.0.0", ...data }));
    }, Math.max(0, due - performance.now()));
  }
  until(predicate, label, timeoutMs = 8000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timeout: setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`${label}; recent=${JSON.stringify(this.messages.slice(-5).map(m => ({type:m.type,reason:m.reason,action:m.action,request_id:m.request_id})))}`));
      }, timeoutMs) };
      this.waiters.add(waiter);
    });
  }
  async operation(data) {
    const request_id = data.request_id || req(data.action || data.type);
    const started = performance.now();
    this.send({ world: "PERF_LOCAL", ...data, request_id });
    const response = await this.until(m => (m.request_id === request_id || m.action_id === request_id) &&
      ["world_block_update", "world_block_reconcile", "action_rejected", "rate_limited", "client_pong"].includes(m.type), request_id);
    return { response, ms: performance.now() - started, request_id };
  }
  async inventory() {
    const request_id = req("inventory");
    this.send({ type: "player_state_request", request_id });
    const state = await this.until(m => m.type === "player_state" && m.request_id === request_id, request_id);
    const inventory = Object.fromEntries(Object.entries(state.player_data || {}).filter(([key]) => key.startsWith("inventory")));
    assert(Object.keys(inventory).length > 0, "Inventory assertion must inspect real authoritative fields");
    return inventory;
  }
  move(elapsed) {
    this.send({ type: "player_position", world: "PERF_LOCAL", x: this.spawn.spawn_x + Math.sin(elapsed / 300) * 4,
      y: this.spawn.spawn_y, velocity_x: Math.cos(elapsed / 300) * 13.33, velocity_y: 0,
      on_floor: true, facing: 1, allow_join: false, movement_sequence: ++this.sequence,
      client_time_msec: Math.round(performance.now()), animation_state: "idle" });
  }
}

async function main() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", ENVIRONMENT: "development", NODE_ENV: "development",
    PIXELMANIA_ALLOW_DEV_TOOLS: "true", PIXELMANIA_ENABLE_DEV_BACKEND_LOGIN: "true",
    POSTGRES_ENABLED: "false", POSTGRES_AUTHORITATIVE: "false", DATABASE_URL: "", POSTGRES_URL: "",
    REDIS_ENABLED: "false", REDIS_URL: "", SMTP_HOST: "", MIN_CLIENT_VERSION: "0.0.0",
    WORLD_ROUTE_ENFORCEMENT_ENABLED: "false", PIXELMANIA_DATA_DIR: path.join(output, "data"),
    PIXELMANIA_RUNTIME_PROFILE: "1", BLOCK_ACTION_PROFILE_LOGS: "1" };
  const log = fs.createWriteStream(path.join(output, "server.log"));
  server = spawn(process.execPath, [path.join(root, "server.js")], { cwd: output, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.pipe(log); server.stderr.pipe(log);
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try { healthy = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).ok; } catch {}
    if (healthy) break;
    await wait(250);
  }
  assert(healthy, "Isolated server failed to start; inspect server.log");
  const count = Number(process.env.PERF_PLAYERS || 6);
  for (let i = 0; i < count; i++) {
    const client = new Client(port, i, [30,75,150][i % 3]); clients.push(client);
    await new Promise((resolve, reject) => { client.ws.once("open", resolve); client.ws.once("error", reject); });
    client.send({ type: "dev_backend_login", username: `RuntimePerf${i}`, world: "LOBBY", request_id: req("login") });
    await client.until(m => m.type === "account_auth_ok", "login");
    const joinId = req("join");
    client.send({ type: "join_world", world: "PERF_LOCAL", request_id: joinId });
    client.spawn = await client.until(m => m.type === "join_world_ok", "join");
    await client.until(m => m.type === "world_state" || m.type === "world_state_stream_end", "snapshot");
  }
  const started = performance.now();
  moving = setInterval(() => { for (const client of clients) client.move(performance.now() - started); }, 50);
  await wait(1000);
  const measurements = [];
  for (let i = 0; i < Math.min(3, count); i++) {
    const client = clients[i];
    const target = { type: "world_block_update", layer: "foreground", x: client.spawn.spawn_grid_x + 2,
      y: client.spawn.spawn_grid_y - 1, block_type: "dirt" };
    const placed = await client.operation({ ...target, action: "place" });
    assert.equal(placed.response.type, "world_block_update", JSON.stringify(placed.response));
    assert.equal(placed.response.action, "place");
    const inventoryAfterPlace = await client.inventory();
    await client.operation({ ...target, action: "place", request_id: placed.request_id });
    // Wait for the distinct reconciliation, not the old place echo.
    await client.until(m => m.type === "world_block_reconcile" && m.request_id === placed.request_id, "place replay");
    assert.deepEqual(await client.inventory(), inventoryAfterPlace, "Place replay changed authoritative inventory");
    const rival = clients[(i + 1) % count];
    let removed;
    for (let hit = 0; hit < 20; hit++) {
      await wait(310);
      const response = await client.operation({ ...target, action: "break", source_tool: "punch" });
      assert.equal(response.response.type, "world_block_update", JSON.stringify(response.response));
      if (response.response.action === "break") { removed = response; break; }
    }
    assert(removed, "Break never completed");
    await wait(250);
    const dropsBeforeReplay = clients.map(c => c.drops.size);
    assert(dropsBeforeReplay[0] > 0, "Harness must observe real drop broadcasts");
    const inventoryAfterBreak = await client.inventory();
    const rivalInventory = await rival.inventory();
    await rival.operation({ ...target, action: "break", source_tool: "punch" });
    await client.operation({ ...target, action: "break", request_id: removed.request_id });
    await wait(350);
    assert.deepEqual(await client.inventory(), inventoryAfterBreak, "Break replay changed authoritative inventory");
    assert.deepEqual(await rival.inventory(), rivalInventory, "Rival duplicate break changed authoritative inventory");
    const key = `${target.layer}:${target.x}:${target.y}`;
    for (const [index, peer] of clients.entries()) {
      assert.equal(peer.cells.get(key), "", "Ghost block / missing authoritative broadcast");
      assert.equal(peer.drops.size, dropsBeforeReplay[index], "Duplicate operation generated a new drop");
    }
    const ping = await client.operation({ type: "client_ping" });
    assert.equal(ping.response.type, "client_pong");
    measurements.push({players:count,rtt_ms:client.rtt,place_ms:placed.ms,final_break_ms:removed.ms,application_ping_ms:ping.ms});
  }
  await wait(5500);
  clearInterval(moving);
  await wait(300);
  const corrections = clients.flatMap(c => c.messages.filter(m => m.type === "action_rejected" && m.action === "player_position"));
  assert.equal(corrections.length, 0, `Movement corrections: ${JSON.stringify(corrections.slice(0,3))}`);
  const result = { scope:"local development storage, ordered application RTT with deterministic jitter; no GPU or production database",
    players:count, duration_ms:performance.now()-started, movement_corrections:corrections.length,drops_observed:clients.map(c=>c.drops.size),measurements,
    duplicate_inventory_invariants_passed:true,
    movement_wire_bytes:clients.reduce((n,c)=>n+c.movementBytes,0), movement_items:clients.reduce((n,c)=>n+c.movementItems,0),
    equivalent_uncompacted_bytes:clients.reduce((n,c)=>n+c.legacyEquivalentBytes,0),
    place_p95_ms:percentile(measurements.map(m=>m.place_ms),0.95), break_p95_ms:percentile(measurements.map(m=>m.final_break_ms),0.95) };
  fs.writeFileSync(path.join(output,"results.json"), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  clearInterval(moving);
  for(const client of clients) client.ws.terminate();
  if(server) { server.kill(); await Promise.race([new Promise(resolve=>server.once("exit",resolve)),wait(3000)]); }
});
