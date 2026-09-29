"use strict";
// Static protocol index + measured JSON payload sizes. No live server access.
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, ".."), client = path.resolve(root, "../pixel-mania");
const out = path.resolve(process.env.AUDIT_CATALOG_DIR || path.join(client, "docs"));
const network = fs.readFileSync(path.join(client, "Scripts/network_manager.gd"), "utf8");
const routes = require("../server_phase7_dispatcher").HANDLED_ROUTE_TYPES;
const records = new Map();
function add(name, direction, source) {
  const key = direction + ":" + name;
  if (!records.has(key)) records.set(key, { name, direction, sources: new Set(), count: 0, bytes: 0, max_bytes: 0 });
  records.get(key).sources.add(source);
  return records.get(key);
}
for (const name of routes) add(name, "C→S", "server/src/server_phase7_dispatcher.ts");
for (const name of ["auth_required", "developer_pin_unlock_result"]) add(name, "S→C", "server/src/server.ts; client authentication/developer-pin pre-dispatch");
add("netfox_spawn", "S→Netfox", "server/src/server.ts; inactive alternate movement transport");
const lines = network.split(/\r?\n/);
let receiving = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith("func handle_server_message(")) receiving = true;
  else if (receiving && lines[i].startsWith("func ")) receiving = false;
  if (receiving && /^\t\t"[^\n]+:\s*$/.test(lines[i])) {
    for (const match of lines[i].matchAll(/"([a-z0-9_]+)"/g)) add(match[1], "S→C", `client/Scripts/network_manager.gd:${i + 1}`);
  }
}
// Include all literal client message constructors, even compatibility routes.
for (const match of network.matchAll(/"type"\s*:\s*"([a-z0-9_]+)"/g)) {
  const name = match[1];
  // Locally synthesized incoming repair/rejection events aren't outbound routes.
  if (routes.includes(name)) add(name, "C→S", `client/Scripts/network_manager.gd:${network.slice(0, match.index).split("\n").length}`);
}
// Index every server literal type so unhandled/legacy output cannot silently
// disappear from the audit. Nonprotocol object tags remain separate candidates.
const candidates = new Map();
for (const entry of fs.readdirSync(path.join(root, "src"))) {
  if (!entry.endsWith(".ts")) continue;
  const source = fs.readFileSync(path.join(root, "src", entry), "utf8");
  for (const match of source.matchAll(/\btype\s*:\s*["']([a-z0-9_]+)["']/g)) {
      const name = match[1];
      const ref = `server/src/${entry}:${source.slice(0, match.index).split("\n").length}`;
      if (records.has("S→C:" + name)) add(name, "S→C", ref);
      else { if (!candidates.has(name)) candidates.set(name, []); candidates.get(name).push(ref); }
  }
}
const evidence = [];
for (const input of process.argv.slice(2)) {
  const file = path.resolve(input), data = JSON.parse(fs.readFileSync(file, "utf8"));
  evidence.push(file);
  function metric(name, direction, measurement) {
    const row = add(name, direction, "measured proxy/stress fixture");
    row.count += measurement.count || 0; row.bytes += measurement.bytes || 0;
    row.max_bytes = Math.max(row.max_bytes, measurement.max_bytes || 0);
  }
  for (const peer of Object.values(data.proxy || {})) for (const [key, value] of Object.entries(peer.by_type || {})) {
    const [direction, name] = key.split(":"); metric(name, direction === "in" ? "C→S" : "S→C", value);
  }
  for (const peer of data.network_by_client || []) for (const [name, value] of Object.entries(peer)) metric(name, "S→C", value);
}
function policy(row) {
  const n = row.name;
  if (/^player_position/.test(n)) return ["change driven; client ≤30Hz small world / ≤20Hz crowded; server batches ≥16ms; idle guidance", "sequence/timestamp freshness; correction on rejection, no normal per-input ACK", "coalesce newest unsent movement; unchanged presence suppressed; full appearance on change/resync"];
  if (/^client_(ping|pong)$/.test(n)) return ["one probe per 5s; one outstanding", "matched request_id; 30s deadline", "intentional keepalive; do not batch behind bulk traffic"];
  if (/world_state|world_entry|join_world/.test(n)) return ["entry/recovery; ready/restart retries only", "ordered chunks, request/session IDs and revision-checked ready/active", "bounded stream; full snapshot only for initialization/recovery"];
  if (/inventory|trade|iap_|account_|player_state_save/.test(n)) return ["user/session action; state saves use change detection", "ordered authenticated request/result; transaction identity/locks; never replay blindly", "retain reliable results and atomic deltas; combine only within the existing transaction"];
  if (/world_block|world_update|world_seed|world_interaction|drop_|world_item_drop|electrical|generator|wire_visibility/.test(n)) return ["mutation/interaction; some generators emit timed pulses", "ordered world revisions and action identity; authoritative event/result/repair", "delta events/batches; nearby drops; repeated breaks are intentional hits, not duplicate commits"];
  if (/player_joined|player_left|world_population/.test(n)) return ["presence/interest boundary changes; explicit request", "ordered lifecycle; no separate application ACK", "interest management and population guidance; never periodic full-world state"];
  if (/netfox|custom_trusted/.test(n)) return ["inactive alternate-mode routes", "mode/ticket/server validation; outside active WebSocket movement", "no parallel replication in current default mode"];
  return ["event/request driven; exact frequency depends on gameplay", "reliable ordered event; request results use matching ID where defined (see source)", "no constant whole-world replication; no duplicate loop found in active receive dispatcher; do not coalesce critical events"];
}
const rows = [...records.values()].sort((a,b) => a.direction.localeCompare(b.direction) || a.name.localeCompare(b.name)).map(row => {
  const [frequency, acknowledgement, optimization] = policy(row);
  return {...row, sources:[...row.sources], frequency, reliability:"ordered reliable WebSocket/TCP", acknowledgement, optimization,
    average_payload_bytes:row.count ? Math.round(row.bytes / row.count * 10) / 10 : null};
});
const actions = [...network.match(/const INVENTORY_TRANSACTION_ACTIONS := \[([\s\S]*?)\]/)[1].matchAll(/"([a-z0-9_]+)"/g)].map(m=>m[1]);
const extra = [...candidates].filter(([name])=>!records.has("S→C:"+name)).map(([name,sources])=>({name,sources}));
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"network_message_catalog_20260928.json"),JSON.stringify({scope:"Active dispatcher routes, client receive cases, measured messages, multiplexed inventory actions; remaining literal object tags indexed separately",evidence,rows,inventory_transaction_actions:actions,unclassified_server_type_literals:extra},null,2)+"\n");
let md = "# Network message catalog — 28 September 2026\n\n";
md += `${rows.length} directional route/event entries; ${actions.length} inventory subactions. All active messages use ordered reliable WebSocket/TCP. Source references and every unclassified server literal are in the adjacent JSON. Dynamic event values and action payload schemas still require their referenced handlers; this is a protocol index, not a claim that every gameplay action was exercised.\n\n`;
md += "Sizes are JSON UTF-8 bytes measured at the test proxy or stress client, excluding WebSocket/TLS/TCP overhead. Count includes attempted forwarding before deliberate disconnects. Unexercised entries are marked unmeasured, never zero. Rates below are behavioral policies, not per-message production averages. All authoritative mutations require ordering; movement instead benefits from freshness but TCP still orders it.\n\n";
md += "| Direction | Message | Samples | Mean / max bytes | Frequency | ACK / ordering | Duplication / batching / unchanged state |\n|---|---|---:|---:|---|---|---|\n";
for (const row of rows) md += `| ${row.direction} | \`${row.name}\` | ${row.count || "—"} | ${row.count ? row.average_payload_bytes + " / " + row.max_bytes : "unmeasured"} | ${row.frequency} | ${row.acknowledgement} | ${row.optimization} |\n`;
md += "\n## Multiplexed inventory actions\n\n" + actions.map(n=>"`"+n+"`").join(", ") + ".\n\nAll use `inventory_transaction_request` and a result. Read-state actions do not mutate inventory; deposit, withdrawal, craft, purchase and transfer actions retain server validation and transactions.\n\n## Measurement inputs\n\n" + evidence.map(p=>"- `"+p.replace(/\\/g,"/")+"`").join("\n") + "\n";
fs.writeFileSync(path.join(out,"network_message_catalog_20260928.md"),md);
console.log(JSON.stringify({messages:rows.length,measured:rows.filter(r=>r.count).length,inventory_actions:actions.length,unclassified_literals:extra.length,output:out}));
