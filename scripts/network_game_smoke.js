"use strict";
// Actual Godot game scenes against an isolated loopback backend. The proxy
// models ordered RTT/jitter/recovery; it does not pretend to drop TCP segments.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process");
const { WebSocket, WebSocketServer } = require("ws");
const root = path.resolve(__dirname, ".."), client = path.resolve(root, "../pixel-mania");
const output = path.resolve(process.env.AUDIT_OUTPUT_DIR || path.join(root, "test-output", `network-game-${Date.now()}`));
const engine = process.env.GODOT_BIN || path.resolve(root, "../Godot/Godot_v4.7.1-stable_win64_console.exe");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = [], proxies = [], links = [];
let monitor;
async function freePort() {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
function launch(binary, args, env, label) {
  const log = fs.createWriteStream(path.join(output, label + ".log"));
  const child = spawn(binary, args, { cwd: output, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log); child.stderr.pipe(log); children.push(child);
  child.completion = new Promise((resolve, reject) => { child.once("exit", code => resolve(code)); child.once("error", reject); });
  return child;
}
async function proxy(port, role) {
  const wsServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise(resolve => wsServer.once("listening", resolve)); proxies.push(wsServer);
  const stats = { messages: 0, bytes: 0, recovery_stalls: 0, join_interruptions: 0, connections: 0, by_type: {} };
  wsServer.on("connection", front => {
    stats.connections++;
    const back = new WebSocket(`ws://127.0.0.1:${port}`);
    const pair = { role, front, back, timers: new Set(), queues: { in: [], out: [] }, active: { in: false, out: false } }; links.push(pair);
    const awaiting = [];
    let nextIn = 0, nextOut = 0, sequence = 0;
    function forward(raw, direction) {
      const message = JSON.parse(raw.toString());
      const key = direction + ":" + message.type;
      const metric = stats.by_type[key] || (stats.by_type[key] = { count: 0, bytes: 0, max_bytes: 0 });
      metric.count++; metric.bytes += raw.length; metric.max_bytes = Math.max(metric.max_bytes, raw.length);
      const now = performance.now();
      let due = Math.max(direction === "in" ? nextIn : nextOut,
        now + Number(process.env.AUDIT_RTT_MS || 250) / 2 + Math.sin(++sequence * 1.7) * 15);
      const percent = Number(process.env.AUDIT_RECOVERY_PERCENT || 0);
      if (percent > 0 && (stats.messages + 1) % Math.round(100 / percent) === 0) { due += 100; stats.recovery_stalls++; }
      if (direction === "in") nextIn = due; else nextOut = due;
      pair.queues[direction].push({ raw, due, type: message.type });
      drain(direction);
      stats.messages++; stats.bytes += raw.length;
    }
    function drain(direction) {
      if (pair.active[direction] || !pair.queues[direction].length) return;
      pair.active[direction] = true;
      const first = pair.queues[direction][0];
      const timer = setTimeout(() => {
        pair.timers.delete(timer);
        const destination = direction === "in" ? back : front;
        while (pair.queues[direction].length && pair.queues[direction][0].due <= performance.now() + 1) {
          const packet = pair.queues[direction].shift();
          if (destination.readyState === WebSocket.OPEN) destination.send(packet.raw.toString());
          if (role === "actor" && direction === "out" && packet.type === "world_state_stream_begin"
              && process.env.AUDIT_INTERRUPT_JOIN === "1" && stats.join_interruptions === 0) {
            stats.join_interruptions++;
            // Deliver the join ACK/begin, withhold all chunks, then replace the
            // socket. This exercises recovery before world_entry_ready.
            const cut = setTimeout(() => { pair.timers.delete(cut); front.terminate(); back.terminate(); }, 50);
            pair.timers.add(cut);
            return;
          }
        }
        pair.active[direction] = false;
        drain(direction);
      }, Math.max(1, first.due - performance.now()));
      pair.timers.add(timer);
    }
    front.on("message", raw => { if (back.readyState === WebSocket.CONNECTING) awaiting.push(raw); else forward(raw, "in"); });
    back.on("open", () => awaiting.splice(0).forEach(raw => forward(raw, "in")));
    back.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (["account_auth_error", "action_rejected"].includes(message.type))
        fs.appendFileSync(path.join(output, role + "-rejections.jsonl"), JSON.stringify({type:message.type,action:message.action,reason:message.reason,message:message.message}) + "\n");
      forward(raw, "out");
    });
    for (const ws of [front, back]) {
      ws.on("error", () => {});
      ws.on("close", () => { for (const timer of pair.timers) clearTimeout(timer); front.terminate(); back.terminate(); });
    }
  });
  return { port: wsServer.address().port, stats };
}
async function main() {
  fs.mkdirSync(path.join(output, "data", "players"), { recursive: true });
  for (const name of ["NetAuditActor", "NetAuditObserver"]) {
    const file = path.join(output, "data", "players", name.toLowerCase() + ".json");
    if (fs.existsSync(file)) throw Error("Use a fresh output directory");
    fs.writeFileSync(file, JSON.stringify({ player_state_version: 1, username: name,
      player_data: { account_username: name, inventory: { dirt: 30, display_case: 1, world_lock: 1 } } }));
  }
  const port = await freePort();
  const env = { ...process.env, HOST: "127.0.0.1", PORT: String(port), ENVIRONMENT: "development", NODE_ENV: "development",
    PIXELMANIA_ENABLE_DEV_BACKEND_LOGIN: "true", PIXELMANIA_ALLOW_DEV_TOOLS: "true", POSTGRES_ENABLED: "false", POSTGRES_AUTHORITATIVE: "false",
    DATABASE_URL: "", POSTGRES_URL: "", REDIS_ENABLED: "false", REDIS_URL: "", SMTP_HOST: "", WORLD_ROUTE_ENFORCEMENT_ENABLED: "false",
    MIN_CLIENT_VERSION: "0.0.0", PIXELMANIA_DATA_DIR: path.join(output, "data"), PIXELMANIA_RUNTIME_PROFILE: "1", BLOCK_ACTION_PROFILE_LOGS: "1" };
  launch(process.execPath, [path.join(root, "server.js")], env, "server");
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try { healthy = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).ok; } catch {}
    if (healthy) break;
    await wait(250);
  }
  if (!healthy) throw Error("Local server failed to start");
  const runs = [];
  const proxyStats = {};
  for (const role of ["observer", "actor"]) {
    const relay = await proxy(port, role); proxyStats[role] = relay.stats;
    const render = process.env.AUDIT_RENDER === "1" && role === "actor";
    const appdata = path.join(output, role + "-appdata"); fs.mkdirSync(appdata, { recursive: true });
    const args = [...(render ? ["--rendering-method", "gl_compatibility", "--resolution", "960x540", "--windowed"] : ["--headless"]),
      "--max-fps", role === "observer" ? String(process.env.AUDIT_OBSERVER_FPS || 30) : "60",
      "--path", client, "--script", "tests/network_game_smoke.gd", "--", "--pixelmania-ws-url", `ws://127.0.0.1:${relay.port}`,
      "--pixelmania-api-base", `http://127.0.0.1:${port}`, "--audit-output", output, "--audit-role", role, ...(render ? ["--audit-render"] : [])];
    runs.push(launch(engine, args, { ...process.env, APPDATA: appdata, PIXELMANIA_RUNTIME_PROFILE: "1" }, role));
  }
  let interrupted = false;
  monitor = setInterval(() => {
    const file = path.join(output, "actor.phase");
    if (!interrupted && fs.existsSync(file) && fs.readFileSync(file, "utf8") === "interrupt") {
      interrupted = true;
      for (const pair of links.filter(link => link.role === "actor")) { pair.front.terminate(); pair.back.terminate(); }
    }
  }, 30);
  const codes = await Promise.race([Promise.all(runs.map(child => child.completion)), wait(150000).then(() => { throw Error("Game smoke timeout"); })]);
  const result = { codes, interrupted, proxy: proxyStats, model: "ordered application RTT/jitter/recovery; not kernel packet loss", output };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (codes.some(code => code !== 0) || !interrupted) throw Error("Game assertions failed; inspect actor/observer results");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  clearInterval(monitor);
  for (const pair of links) { for (const timer of pair.timers) clearTimeout(timer); pair.front.terminate(); pair.back.terminate(); }
  for (const proxy of proxies) proxy.close();
  for (const child of children) if (child.exitCode === null) child.kill();
  // All owned handles have been closed; no unrelated game/editor processes are touched.
  setTimeout(() => process.exit(process.exitCode || 0), 500);
});
