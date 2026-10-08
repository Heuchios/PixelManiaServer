"use strict";

// Read-only audit using the same tracking policy as authoritative pickup.
// Ordinary count-only materials are intentionally excluded from mismatches.
const Contracts = require("../postgres_store_contracts");

async function auditWorldDropIdentities(client, store) {
  const result = await client.query(`SELECT w.world_name, d.drop_id, d.item_type,
      d.item_category, d.amount, d.created_at, d.metadata,
      (SELECT count(*)::integer FROM ${store.table("item_instances")} i
        WHERE i.world_id=d.world_id AND i.item_type=d.item_type
          AND i.item_category=d.item_category AND i.state='dropped'
          AND i.current_location='world_drop'
          AND (i.metadata->>'drop_id'=d.drop_id
            OR i.metadata #>> '{details,drop_id}'=d.drop_id
            OR i.metadata #>> '{details,details,drop_id}'=d.drop_id)) AS claimable
    FROM ${store.table("world_drops")} d
    JOIN ${store.table("worlds")} w USING(world_id)
    WHERE d.status='active' AND d.amount>0`);
  const tracked = result.rows.filter(row => Contracts.shouldTrackItemInstance(row.item_type, row.item_category));
  const mismatches = tracked.filter(row => Number(row.amount) !== Number(row.claimable));
  const groups = {};
  for (const row of mismatches) {
    const key = `${row.world_name}|${row.item_type}|${row.metadata?.origin_source || "unknown"}`;
    const group = groups[key] ||= { drops: 0, units: 0, identities: 0 };
    group.drops++;
    group.units += Number(row.amount);
    group.identities += Number(row.claimable);
  }
  return {
    active_drops: result.rows.length,
    worlds_with_drops: new Set(result.rows.map(row => row.world_name)).size,
    tracked_drops: tracked.length,
    mismatched_drops: mismatches.length,
    affected_worlds: new Set(mismatches.map(row => row.world_name)).size,
    groups,
  };
}

async function main() {
  require("dotenv").config({ quiet: true });
  const { Pool } = require("pg");
  const PostgresStore = require("../postgres_store");
  const e = process.env;
  const store = new PostgresStore({ enabled: false, schema: e.POSTGRES_SCHEMA || "pixelmania" });
  const pool = new Pool({ connectionString: e.POSTGRES_CONNECTION_STRING || e.DATABASE_URL,
    host: e.POSTGRES_HOST, port: Number(e.POSTGRES_PORT || 5432), database: e.POSTGRES_DATABASE,
    user: e.POSTGRES_USER, password: e.POSTGRES_PASSWORD,
    ssl: e.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='60s'");
    const report = await auditWorldDropIdentities(client, store);
    await client.query("ROLLBACK");
    console.log(JSON.stringify(report, null, 2));
    if (report.mismatched_drops) process.exitCode = 2;
  } finally { client.release(); await pool.end(); }
}

module.exports = { auditWorldDropIdentities };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
