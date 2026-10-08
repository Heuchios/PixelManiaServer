"use strict";

// Operator recovery only. Unknown provenance must never enable automatic minting
// in the pickup handler. This reviews exact existing rows before any correction.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function snapshot(row) {
  return {
    world_id: row.world_id, drop_id: row.drop_id, item_type: row.item_type,
    item_category: row.item_category, amount: Number(row.amount), status: row.status,
    created_at: new Date(row.created_at).toISOString(), metadata: row.metadata || {},
  };
}

async function inspectReferences(client, store, ids) {
  const evidence = {};
  for (const table of ["item_instances", "item_instance_events", "item_transactions", "transaction_ledger"]) {
    // Search every world and owner, including retired/consumed identities. A
    // moved item must not become invisible to recovery merely by changing world.
    const result = await client.query(`SELECT metadata FROM ${store.table(table)}
      WHERE metadata->>'drop_id' = ANY($1::text[])
         OR metadata #>> '{details,drop_id}' = ANY($1::text[])
         OR metadata #>> '{details,details,drop_id}' = ANY($1::text[])`, [ids]);
    for (const row of result.rows) {
      const m = row.metadata || {};
      for (const id of [m.drop_id, m.details?.drop_id, m.details?.details?.drop_id]) {
        if (!ids.includes(id)) continue;
        (evidence[id] ||= []).push(table);
      }
    }
  }
  return evidence;
}

function validatePlan(plan, expectedHash) {
  if (plan.version !== 1 || !Array.isArray(plan.drops) || !plan.drops.length || plan.drops.length > 500) {
    throw new Error("Expected a nonempty reviewed plan (maximum 500 drops).");
  }
  const actual = digest({ world: plan.world, drops: plan.drops });
  if (!expectedHash || plan.sha256 !== actual || expectedHash !== actual) throw new Error("Repair plan hash mismatch.");
  const ids = new Set();
  for (const drop of plan.drops) {
    if (ids.has(drop.drop_id)) throw new Error("Duplicate drop in repair plan.");
    ids.add(drop.drop_id);
    if (drop.status !== "active" || !Number.isSafeInteger(drop.amount) || drop.amount <= 0 || drop.amount > 400) {
      throw new Error("Invalid active drop quantity.");
    }
    if (drop.metadata.origin_source || drop.metadata.source !== "world_state_mirror") {
      throw new Error("Only legacy rows with missing provenance can use this recovery.");
    }
  }
}

async function repairPlan(client, store, plan, expectedHash, reason) {
  validatePlan(plan, expectedHash);
  if (!String(reason || "").trim()) throw new Error("An operator reason is required.");
  // Same lock order as gameplay pickup: world, then drop. No live quantities or
  // world snapshot are edited, so connected clients need no state replacement.
  const worlds = await client.query(`SELECT world_id FROM ${store.table("worlds")} WHERE world_name = $1 FOR UPDATE`, [plan.world]);
  const worldId = worlds.rows[0]?.world_id;
  if (!worldId || plan.drops.some(drop => drop.world_id !== worldId)) throw new Error("World identity changed.");
  const ids = plan.drops.map(drop => drop.drop_id);
  const current = await client.query(`SELECT * FROM ${store.table("world_drops")}
    WHERE world_id = $1 AND drop_id = ANY($2::text[]) ORDER BY drop_id FOR UPDATE`, [worldId, ids]);
  const rows = current.rows.map(snapshot);
  if (digest(rows) !== digest(plan.drops)) throw new Error("Drop state changed since review; regenerate the plan.");
  const evidence = await inspectReferences(client, store, ids);
  if (Object.keys(evidence).length) throw new Error("Existing item identity or ledger evidence; manual investigation required.");
  const requestId = `legacy-drop-repair-${crypto.randomUUID()}`;
  const audit = await client.query(`INSERT INTO ${store.table("admin_actions")}
    (action_type,target_type,target_id,world_id,request_id,metadata)
    VALUES ('legacy_drop_identity_repair','world',$1,$2,$3,$4::jsonb) RETURNING admin_action_id`,
  [plan.world, worldId, requestId, JSON.stringify({ reason, operator: "authenticated_ssh_operator", plan_sha256: expectedHash, before: plan.drops })]);
  const repaired = [];
  for (const drop of rows) {
    const result = await store.createTrackedWorldDropItemInstances(client, {
      world_id: worldId, source: "admin", action: "legacy_drop_identity_repair",
      item_type: drop.item_type, item_category: drop.item_category, amount: drop.amount,
      drop_id: drop.drop_id, details: { request_id: requestId, reason, plan_sha256: expectedHash, provenance_unknown: true },
    });
    if (!result.ok || !result.tracked || result.created !== drop.amount) throw new Error(`Identity repair incomplete: ${drop.drop_id}`);
    await store.recordTransactionLedger(client, {
      world_id: worldId, source: "admin", action: "legacy_drop_identity_repair",
      transaction_type: "ADMIN_WORLD_DROP_IDENTITY_REPAIR", status: "success",
      admin_action_id: audit.rows[0].admin_action_id, request_id: requestId,
      item_type: drop.item_type, item_category: drop.item_category, item_instances: result.item_instances,
      metadata: { drop_id: drop.drop_id, reason, plan_sha256: expectedHash, quantity_before: drop.amount, quantity_after: drop.amount, provenance_unknown: true },
    });
    repaired.push({ drop_id: drop.drop_id, created: result.created });
  }
  return { request_id: requestId, repaired, instance_count: repaired.reduce((sum, drop) => sum + drop.created, 0) };
}

async function main() {
  const args = process.argv.slice(2);
  const option = key => { const i = args.indexOf(key); return i < 0 ? "" : args[i + 1] || ""; };
  const root = process.env.PIXELMANIA_REPAIR_ROOT || path.resolve(__dirname, "..");
  require(path.join(root, "node_modules/dotenv")).config({ path: path.join(root, ".env"), quiet: true });
  const PostgresStore = require(path.join(root, "postgres_store"));
  const { Pool } = require(path.join(root, "node_modules/pg"));
  const e = process.env;
  const store = new PostgresStore({ enabled: false, schema: e.POSTGRES_SCHEMA || "pixelmania" });
  const db = new Pool({ connectionString: e.POSTGRES_CONNECTION_STRING || e.DATABASE_URL,
    host: e.POSTGRES_HOST, port: Number(e.POSTGRES_PORT || 5432), database: e.POSTGRES_DATABASE,
    user: e.POSTGRES_USER, password: e.POSTGRES_PASSWORD,
    ssl: e.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined });
  const client = await db.connect();
  try {
    if (option("--apply")) {
      const plan = JSON.parse(fs.readFileSync(option("--apply"), "utf8"));
      validatePlan(plan, option("--expect-hash"));
      // Preserve the reviewed before image before the database can be changed.
      fs.writeFileSync(`${option("--apply")}.before-${Date.now()}.json`, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      const result = await repairPlan(client, store, plan, option("--expect-hash"), option("--reason"));
      await client.query("COMMIT");
      console.log(JSON.stringify(result, null, 2));
    } else {
      const world = option("--world"), item = option("--item"), before = option("--before"), out = option("--out");
      if (!world || !item || !before || !out || !Number.isFinite(Date.parse(before))) {
        throw new Error("Dry run: --world WORLD --item ITEM --before ISO_DATE --out PLAN.json. Apply: --apply PLAN.json --expect-hash SHA256 --reason TEXT.");
      }
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = '30s'");
      const result = await client.query(`SELECT d.* FROM ${store.table("world_drops")} d JOIN ${store.table("worlds")} w USING(world_id)
        WHERE w.world_name = $1 AND d.item_type = $2 AND d.created_at < $3::timestamptz
          AND d.status = 'active' AND d.amount > 0 AND COALESCE(d.metadata->>'origin_source','') = ''
        ORDER BY d.drop_id LIMIT 501`, [world, item, before]);
      if (result.rows.length > 500) throw new Error("Too many drops; narrow the scope.");
      const evidence = await inspectReferences(client, store, result.rows.map(row => row.drop_id));
      const drops = result.rows.filter(row => !evidence[row.drop_id]).map(snapshot);
      const plan = { version: 1, world, drops, excluded: evidence, sha256: digest({ world, drops }) };
      await client.query("ROLLBACK");
      fs.writeFileSync(out, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ mode: "dry_run", world, drops: drops.length, quantity: drops.reduce((sum, row) => sum + row.amount, 0), excluded: Object.keys(evidence).length, sha256: plan.sha256, out }));
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

module.exports = { digest, snapshot, inspectReferences, validatePlan, repairPlan };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
