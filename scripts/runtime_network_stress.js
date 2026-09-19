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
let trafficPhase = false;

function percentile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
}

class Client {
  constructor(port, index, rtt) {
    this.index = index;
    this.world = 'PERF_LOCAL' + (Math.floor(index / Number(process.env.PERF_WORLD_SIZE || 50)) || '');
    this.rtt = rtt;
    this.messages = [];
    this.cells = new Map();
    this.drops = new Map();
    this.seeds = new Map();
    this.waiters = new Set();
    this.nextSend = 0;
    this.nextReceive = 0;
    this.sequence = 0;
    this.movementBytes = 0;
    this.movementItems = 0;
    this.wireByType = {};
    this.legacyEquivalentBytes = 0;
    this.receivedPackets = 0;
    this.orderedStalls = 0;
    this.remoteGaps = {};
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on("error", error => { this.error = error; });
    this.ws.on("message", raw => {
      const data = JSON.parse(raw.toString());
      if (Array.isArray(data.player_rows)) {
        data.players = data.player_rows.map(row => Object.fromEntries(data.player_fields.map((key, index) => [key, row[index]])));
        delete data.player_rows;
        delete data.player_fields;
      }
      const bucket = this.wireByType[data.type] || { count: 0, bytes: 0, max_bytes: 0 };
      bucket.count++; bucket.bytes += raw.length; bucket.max_bytes = Math.max(bucket.max_bytes, raw.length);
      this.wireByType[data.type] = bucket;
      if (this.index === 0 && data.type === 'player_position_batch' && (data.players || []).length >= 10 && !this.savedMovementSample) {
        this.savedMovementSample = true;
        fs.writeFileSync(path.join(output, 'movement-sample.json'), raw);
      }
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
      this.receivedPackets++;
      const stallEvery = Number(process.env.PERF_ORDERED_STALL_EVERY || 0);
      if (trafficPhase && stallEvery > 0 && this.receivedPackets % stallEvery === 0) {
        // Model TCP recovery: retain every message and hold all later ones in order.
        // This is an application fault model, not a claim of kernel packet-loss testing.
        this.nextReceive = Math.max(this.nextReceive, performance.now()) + Number(process.env.PERF_ORDERED_STALL_MS || 250);
        this.orderedStalls++;
      }
      const due = Math.max(this.nextReceive, performance.now() + this.delay());
      this.nextReceive = due;
      setTimeout(() => this.receive(data), Math.max(0, due - performance.now()));
    });
  }
  delay() { return this.rtt / 2 + Math.sin(++requestSequence * 1.7) * this.rtt * 0.15; }
  receive(data) {
    if (trafficPhase && data.type === 'player_position_batch') {
      const now = performance.now();
      for (const player of data.players || []) {
        const previous = this.remoteGaps[player.player_id];
        if (!previous) this.remoteGaps[player.player_id] = { last: now, count: 0, max_ms: 0 };
        else { previous.max_ms = Math.max(previous.max_ms, now - previous.last); previous.last = now; previous.count++; }
      }
    }
    if (data.type === "world_update_batch") {
      for (const item of data.updates || []) this.receive({ world: data.world, ...item });
      return;
    }
    if (data.type === "world_block_update" && ["break", "place"].includes(data.action)) {
      this.cells.set(`${data.layer}:${data.x}:${data.y}`, data.action === "break" ? "" : data.block_type);
    }
    if (data.type === "world_seed_update") {
      const key = `${data.x}:${data.y}`;
      if (data.action === "remove") this.seeds.delete(key);
      else if (data.action === "place" || data.action === "splice") this.seeds.set(key, data);
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
    if (data.type === 'dev_backend_login' && process.env.PERF_COLUMNS === '1') data = { ...data, movement_batch_format: 'columns_v1' };
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
    this.send({ world: this.world, ...data, request_id });
    const expectedTypes = data.type === 'inventory_transaction_request'
      ? ['inventory_transaction_result', 'action_rejected', 'rate_limited']
      : ['world_block_update', 'world_block_reconcile', 'action_rejected', 'rate_limited', 'client_pong'];
    const response = await this.until(m => (m.request_id === request_id || m.action_id === request_id) &&
      expectedTypes.includes(m.type), request_id);
    return { response, ms: performance.now() - started, request_id };
  }
  async inventory() {
    const request_id = req("inventory");
    this.send({ type: "player_state_request", request_id });
    const state = await this.until(m => m.type === "player_state" && m.request_id === request_id, request_id);
    const inventory = Object.fromEntries(Object.entries(state.player_data || {}).filter(([key]) => key.startsWith("inventory") || key.endsWith("_inventory")));
    assert(Object.keys(inventory).length > 0, "Inventory assertion must inspect real authoritative fields");
    return inventory;
  }
  move(elapsed) {
    this.send({ type: "player_position", world: this.world, x: this.spawn.spawn_x + Math.sin(elapsed / 300) * 4,
      y: this.spawn.spawn_y, velocity_x: Math.cos(elapsed / 300) * 13.33, velocity_y: 0,
      on_floor: true, facing: 1, allow_join: false, movement_sequence: ++this.sequence,
      client_time_msec: Math.round(performance.now()), animation_state: "idle" });
  }
}

async function main() {
  if (process.env.PERF_SEEDS === "1") {
    const playersDir = path.join(output, 'data', 'players');
    fs.mkdirSync(playersDir, { recursive: true });
    // Provision only the isolated development server's disposable identity,
    // before it starts. Never use a client inventory edit/grant packet.
    const file = path.join(playersDir, 'runtimeperf0.json');
    assert.ok(!fs.existsSync(file), 'Use a fresh PERF_OUTPUT_DIR for the seed fixture');
    fs.writeFileSync(file, JSON.stringify({ player_state_version: 1, username: 'RuntimePerf0',
      player_data: { account_username: 'RuntimePerf0', inventory: { dirt: 200 }, seed_inventory: { dirt_seed: 10 } } }));
  }
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
  const serverArgs = Number(process.env.PERF_TEST_COMMIT_DELAY_MS || 0) > 0 || process.env.PERF_DETERMINISTIC_DROPS === '1'
    ? ['--require', path.join(__dirname, 'runtime_fault_preload.js'), path.join(root, 'server.js')]
    : [path.join(root, 'server.js')];
  server = spawn(process.execPath, serverArgs, { cwd: output, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
    const rtts = String(process.env.PERF_RTTS || '30,75,150').split(',').map(Number);
    const client = new Client(port, i, rtts[i % rtts.length]); clients.push(client);
    await new Promise((resolve, reject) => { client.ws.once("open", resolve); client.ws.once("error", reject); });
    client.send({ type: "dev_backend_login", username: `RuntimePerf${i}`, world: "LOBBY", request_id: req("login") });
    await client.until(m => m.type === "account_auth_ok", "login");
    const joinId = req("join");
    client.send({ type: "join_world", world: client.world, request_id: joinId });
    client.spawn = await client.until(m => m.type === "join_world_ok", "join");
    await client.until(m => m.type === "world_state" || m.type === "world_state_stream_end", "snapshot");
  }
  const started = performance.now();
  moving = setInterval(() => { for (const client of clients) client.move(performance.now() - started); }, 50);
  await wait(1000);
  const trafficStart = clients.map(c => ({ bytes: c.movementBytes, items: c.movementItems }));
  const measuredStarted = performance.now();
  trafficPhase = true;
  const measurements = [];
  const seedMeasurements = [];
  if (process.env.PERF_SEEDS === "1") {
    const actor = clients[0];
    const observers = clients.filter(c => c.world === actor.world);
    const inventoryBefore = await actor.inventory();
    const seedCount = inv => Number(inv.seed_inventory?.dirt_seed || 0);
    assert.ok(seedCount(inventoryBefore) >= 3, 'Disposable test identity needs starter dirt seeds');
    const dropCounts = clients.map(c => c.drops.size);
    for (let offset = 0; offset < 3; offset++) {
      const target = { type: 'inventory_transaction_request', x: actor.spawn.spawn_grid_x + offset - 1,
        y: actor.spawn.spawn_grid_y - 1, seed_type: 'dirt_seed', grow_time: 0, mature: true };
      const planted = await actor.operation({ ...target, action: 'seed_place' });
      assert.equal(planted.response.ok, true, JSON.stringify(planted.response));
      const key = `${target.x}:${target.y}`;
      for (const peer of observers) await peer.until(m => m.type === 'world_seed_update' && m.action === 'place' && m.x === target.x && m.y === target.y, 'seed fanout');
      assert.ok(actor.seeds.get(key).grow_time > 0, 'Client growth spoof must not create mature tree');
      for (let i = 0; i < 3; i++) {
        await wait(310);
        const peer = observers[i % observers.length];
        const punched = await peer.operation({ ...target, action: 'seed_harvest' });
        assert.equal(punched.response.ok, true, JSON.stringify(punched.response));
        assert.equal(punched.response.seed_removed, i === 2);
        if (i < 2) for (const observer of observers) await observer.until(m => m.type === 'world_seed_update' && m.action === 'hit' && m.x === target.x && m.y === target.y && m.hit_count === i + 1, 'tree hit fanout');
      }
      for (const peer of observers) {
        await peer.until(m => m.type === 'world_seed_update' && m.action === 'remove' && m.x === target.x && m.y === target.y, 'tree removal fanout');
        assert.equal(peer.seeds.has(key), false);
      }
      seedMeasurements.push({ plant_ms: planted.ms, peers_synchronized: observers.length });
    }
    assert.equal(seedCount(await actor.inventory()), seedCount(inventoryBefore) - 3, 'Plant/break must permanently consume all three seeds');
    assert.deepEqual(clients.map(c => c.drops.size), dropCounts, 'Growing trees produced drops');
  }
  for (let i = 0; i < Math.min(5, count); i++) {
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
    // Ordered round-trip barrier: delayed observers must receive the original
    // drop before taking the duplicate-check baseline, even with a 300ms stall.
    await Promise.all(clients.map(peer => peer.operation({ type: 'client_ping' })));
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
      if (peer.world === client.world) assert.equal(peer.cells.get(key), "", "Ghost block / missing authoritative broadcast");
      else assert.equal(peer.cells.has(key), false, 'World edits leaked to an unrelated world');
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
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  const result = { at: new Date().toISOString(), scope:"local development storage, ordered application RTT with deterministic jitter; no GPU or production database",
    movement_format: process.env.PERF_COLUMNS === '1' ? 'columns_v1' : 'legacy',
    worlds: Object.fromEntries([...new Set(clients.map(c => c.world))].map(world => [world, clients.filter(c => c.world === world).length])),
    fault_model: { commit_wait_ms: Number(process.env.PERF_TEST_COMMIT_DELAY_MS || 0),
      ordered_stalls: clients.map(c => c.orderedStalls), ordered_stall_ms: Number(process.env.PERF_ORDERED_STALL_MS || 0) },
    remote_movement_gaps: clients.map(c => ({ observer: c.index, players: c.remoteGaps })),
    measured_duration_ms: performance.now() - measuredStarted,
    measured_movement_bytes: clients.reduce((n,c,i) => n + c.movementBytes - trafficStart[i].bytes, 0),
    measured_movement_items: clients.reduce((n,c,i) => n + c.movementItems - trafficStart[i].items, 0),
    network_by_client: clients.map(c => c.wireByType), health,
    players:count, duration_ms:performance.now()-started, movement_corrections:corrections.length,drops_observed:clients.map(c=>c.drops.size),measurements, seedMeasurements,
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
