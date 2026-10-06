import { randomInt, randomUUID } from "node:crypto";
import { quoteWorldName, RESERVATION_DURATION_MS } from "./world_name_pricing";

// Roll out with the matching client. Persisted activation time never moves on restart.
export const enabled = /^(1|true)$/i.test(process.env.WORLD_NAME_CLAIMS_ENABLED || "false");
type RecordData = Record<string, any>;
export function systemName(name: string): boolean {
  return name === "START" || name === "LANDFILL" || /^LANDFILL[_0-9]/.test(name);
}
function generatedName(): string { return `W${randomUUID().replace(/-/g, "").slice(0, 30).toUpperCase()}`; }
async function mutex(store: any, client: any): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${store.schema}:world-name-directory-v1`]);
}
export async function ensureSchema(store: any): Promise<void> {
  if (!enabled) {
    const existing = await store.db.query("SELECT to_regclass($1) AS present", [`${store.schema}.world_name_activation`]);
    if (existing.rows[0]?.present) {
      const active = await store.db.query(`SELECT 1 FROM ${store.table("world_name_activation")} LIMIT 1`);
      if (active.rows.length) throw new Error("World name claims were activated. WORLD_NAME_CLAIMS_ENABLED must remain true on every shard.");
    }
    return;
  }
  const client = await store.db.connect();
  try {
    await client.query("BEGIN");
    await mutex(store, client);
    await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("world_name_activation")} (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), activated_at timestamptz NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE IF NOT EXISTS ${store.table("world_name_registry")} (
      world_id uuid PRIMARY KEY REFERENCES ${store.table("worlds")}(world_id),
      public_name text NOT NULL UNIQUE CHECK(public_name ~ '^[A-Z0-9]{1,32}$'),
      status text NOT NULL CHECK(status IN ('unowned','reserved','claimed','generated')),
      owner_account_id uuid REFERENCES ${store.table("accounts")}(account_id),
      owner_lock jsonb NOT NULL DEFAULT '{}'::jsonb,
      quoted_gems bigint NOT NULL DEFAULT 0 CHECK(quoted_gems >= 0), pricing_version integer NOT NULL DEFAULT 0,
      reserved_at timestamptz, expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS ${store.table("world_name_claim_receipts")} (
      world_id uuid PRIMARY KEY REFERENCES ${store.table("worlds")}(world_id),
      claimed_name text NOT NULL, payer_account_id uuid NOT NULL REFERENCES ${store.table("accounts")}(account_id),
      paid_gems bigint NOT NULL CHECK(paid_gems > 0), pricing_version integer NOT NULL,
      request_id text NOT NULL, claimed_at timestamptz NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE IF NOT EXISTS ${store.table("world_name_cooldowns")} (
      account_id uuid NOT NULL REFERENCES ${store.table("accounts")}(account_id),
      name text NOT NULL, until_at timestamptz NOT NULL, PRIMARY KEY(account_id,name));
      CREATE INDEX IF NOT EXISTS world_name_expiry_idx ON ${store.table("world_name_registry")}(expires_at) WHERE status='reserved';
      CREATE INDEX IF NOT EXISTS world_name_owner_idx ON ${store.table("world_name_registry")}(owner_account_id);`);
    const activation = await client.query(`INSERT INTO ${store.table("world_name_activation")} (singleton) VALUES(true)
      ON CONFLICT DO NOTHING RETURNING activated_at`);
    // Migrate exactly once: existing owners all get the same seven-day window.
    if (activation.rows.length) {
      const existing = await client.query(`SELECT w.world_id, w.world_name::text AS name,
        COALESCE(wl.metadata, w.world_state->'world_lock', '{}'::jsonb) AS lock,
        p.account_id FROM ${store.table("worlds")} w
        LEFT JOIN ${store.table("world_locks")} wl ON wl.world_id=w.world_id AND wl.is_locked=true
        LEFT JOIN ${store.table("players")} p ON p.player_id=wl.owner_player_id`);
      for (const row of existing.rows) {
        const name = String(row.name).toUpperCase();
        if (systemName(name) || !/^[A-Z0-9]{1,32}$/.test(name)) continue;
        const lock = row.lock || {};
        const owner = lock.is_locked ? (row.account_id || lock.owner_account_id || null) : null;
        if (lock.is_locked && !owner) throw new Error(`Resolve the owner of ${name} before activating name claims.`);
        const quote = quoteWorldName(name);
        await client.query(`INSERT INTO ${store.table("world_name_registry")}
          (world_id,public_name,status,owner_account_id,owner_lock,quoted_gems,pricing_version,reserved_at,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $4::uuid IS NULL THEN NULL ELSE $8::timestamptz + interval '7 days' END)`,
        [row.world_id,name,owner ? "reserved" : "unowned",owner,JSON.stringify(lock),quote.price_gems,quote.pricing_version,activation.rows[0].activated_at]);
      }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function freshName(store: any, client: any): Promise<string> {
  for (;;) {
    const name = generatedName();
    const found = await client.query(`SELECT 1 FROM ${store.table("world_name_registry")} WHERE public_name=$1
      UNION ALL SELECT 1 FROM ${store.table("worlds")} WHERE world_name=$1`, [name]);
    if (!found.rows.length) return name;
  }
}
// Public fallback names retain the original name; UUIDs are storage identities only.
export async function availableFallbackName(store: any, client: any, original: string): Promise<string | null> {
  const candidates: string[] = [];
  for (const [start, end] of [[0, 9], [10, 99], [100, 999]]) {
    const suffixes = Array.from({length:end-start+1}, (_, index) => String(start+index));
    for (let index = suffixes.length-1; index > 0; index--) {
      const other = randomInt(index+1);
      [suffixes[index], suffixes[other]] = [suffixes[other], suffixes[index]];
    }
    candidates.push(...suffixes.map(suffix => original.slice(0,32-suffix.length)+suffix));
  }
  const found = await client.query(`SELECT public_name AS name FROM ${store.table("world_name_registry")} WHERE public_name=ANY($1::text[])
    UNION SELECT world_name::text AS name FROM ${store.table("worlds")} WHERE world_name::text=ANY($1::text[])`, [candidates]);
  const occupied = new Set(found.rows.map((row: RecordData) => row.name));
  return candidates.find(name => name !== original && !systemName(name) && !occupied.has(name)) || null;
}
async function expire(store: any, client: any): Promise<void> {
  const due = await client.query(`SELECT * FROM ${store.table("world_name_registry")}
    WHERE status='reserved' AND expires_at <= clock_timestamp() FOR UPDATE`);
  for (const row of due.rows) {
    const replacement = await availableFallbackName(store, client, row.public_name);
    // Exhausted suffixes must never overwrite another world or block all name operations.
    // The expired reservation remains unclaimable and the next sweep retries it.
    if (!replacement) continue;
    await client.query(`INSERT INTO ${store.table("world_name_cooldowns")}(account_id,name,until_at)
      VALUES($1,$2,clock_timestamp()+interval '7 days') ON CONFLICT(account_id,name)
      DO UPDATE SET until_at=EXCLUDED.until_at`, [row.owner_account_id,row.public_name]);
    await client.query(`UPDATE ${store.table("world_name_registry")} SET public_name=$2,status='generated',
      expires_at=NULL,updated_at=clock_timestamp() WHERE world_id=$1`, [row.world_id,replacement]);
    await store.recordTransactionLedger(client, { transaction_type: "WORLD_NAME_EXPIRED", source: "world_name",
      action: "world_name_expired", world_id: row.world_id, status: "success",
      metadata: { old_name: row.public_name, new_name: replacement, owner_account_id: row.owner_account_id } });
  }
}
export async function sweep(store: any): Promise<void> {
  if (!enabled || !store.isReady()) return;
  await store.withTransaction(async (client: any) => { await mutex(store, client); await expire(store, client); }, "world_name_expiry");
}

// Public aliases resolve to immutable storage/routing identities. Expiry never
// renames a world row, touches terrain, or redirects an in-flight world write.
export async function resolve(store: any, rawName: string): Promise<string> {
  const name = quoteWorldName(rawName).name;
  if (!enabled || systemName(name)) return name;
  if (!store.isReady()) throw new Error("Name service unavailable.");
  return await store.withTransaction(async (client: any) => {
    await mutex(store, client);
    await expire(store, client);
    const found = await client.query(`SELECT w.world_name::text AS internal_name FROM ${store.table("world_name_registry")} n
      JOIN ${store.table("worlds")} w USING(world_id) WHERE n.public_name=$1`, [name]);
    if (found.rows.length) return found.rows[0].internal_name;
    // Always use a fresh identity for a new public name, so an old SHOP snapshot
    // can never become the newly released SHOP's terrain or ownership.
    const internal = await freshName(store, client);
    const id = await store.ensureWorldIdentity(client, internal);
    await client.query(`INSERT INTO ${store.table("world_name_registry")}(world_id,public_name,status) VALUES($1,$2,'unowned')`, [id,name]);
    return internal;
  }, "world_name_resolve");
}

export async function resolveEntry(store: any, publicName: string, identity = ""): Promise<{internal:string;name:string}> {
  if (!enabled || systemName(publicName)) return {internal:publicName,name:publicName};
  if (identity) {
    quoteWorldName(identity); // Retry identities are exact, not sanitized guesses.
    const row = await status(store,identity);
    if (!row) throw new Error("This world no longer exists.");
    return {internal:identity,name:row.public_name};
  }
  return {internal:await resolve(store,publicName),name:publicName};
}

export async function status(store: any, internal: string, expireDue = true): Promise<RecordData | null> {
  if (!enabled || systemName(internal)) return null;
  if (!store.isReady()) throw new Error("Name service unavailable.");
  if (expireDue) await sweep(store);
  const result = await store.db.query(`SELECT n.*, w.world_name::text AS internal_name,
    r.paid_gems,r.claimed_at,r.claimed_name FROM ${store.table("world_name_registry")} n
    JOIN ${store.table("worlds")} w USING(world_id)
    LEFT JOIN ${store.table("world_name_claim_receipts")} r USING(world_id) WHERE w.world_name=$1`, [internal]);
  return result.rows[0] || null;
}
export function publicStatus(row: RecordData | null): RecordData | null {
  if (!row) return null;
  return { name: row.public_name, status: row.status, quoted_gems: Number(row.quoted_gems),
    original_paid_gems: row.paid_gems == null ? null : Number(row.paid_gems),
    claimed_at: row.claimed_at || null, expires_at: row.expires_at || null,
    pricing_version: Number(row.pricing_version), server_time: new Date().toISOString() };
}

// Called only from the authoritative world-lock mirror, in its world transaction.
// Removing a block doesn't erase ownership, and changing owners doesn't reset time.
export async function mirrorOwner(store: any, client: any, worldId: string, lock: RecordData, ownerId: string | null): Promise<void> {
  if (!enabled || !lock.is_locked || !ownerId) return;
  await mutex(store, client);
  const world = await client.query(`SELECT world_name::text AS name FROM ${store.table("worlds")} WHERE world_id=$1`, [worldId]);
  const internal = world.rows[0]?.name;
  if (!internal || systemName(internal)) return;
  let row = (await client.query(`SELECT * FROM ${store.table("world_name_registry")} WHERE world_id=$1 FOR UPDATE`, [worldId])).rows[0];
  if (!row) {
    // Covers worlds first created by legacy/admin paths after activation.
    const occupied = await client.query(`SELECT 1 FROM ${store.table("world_name_registry")} WHERE public_name=$1`, [internal]);
    if (occupied.rows.length) throw new Error("This name is already in use. Enter the world by its public name before locking it.");
    row = (await client.query(`INSERT INTO ${store.table("world_name_registry")}(world_id,public_name,status)
      VALUES($1,$2,'unowned') RETURNING *`, [worldId,internal])).rows[0];
  }
  if (row.status === "unowned") {
    await expire(store, client);
    const cooldown = await client.query(`SELECT 1 FROM ${store.table("world_name_cooldowns")}
      WHERE account_id=$1 AND name=$2 AND until_at>clock_timestamp()`, [ownerId,row.public_name]);
    if (cooldown.rows.length) throw new Error("You must wait seven days before reserving this expired name again.");
    const quote = quoteWorldName(row.public_name);
    await client.query(`UPDATE ${store.table("world_name_registry")} SET status='reserved',
      quoted_gems=$2,pricing_version=$3,reserved_at=now(),expires_at=now()+interval '7 days' WHERE world_id=$1`,
    [worldId,quote.price_gems,quote.pricing_version]);
    await store.recordTransactionLedger(client, {transaction_type:"WORLD_NAME_RESERVED",
      source:"world_name",action:"world_lock_name_assignment",world_id:worldId,status:"success",
      metadata:{requested_name:row.public_name,quoted_gems:quote.price_gems,owner_account_id:ownerId,
        reservation_created:true,duration_ms:RESERVATION_DURATION_MS}});
  }
  await client.query(`UPDATE ${store.table("world_name_registry")} SET owner_account_id=$2,owner_lock=$3::jsonb,
    updated_at=clock_timestamp() WHERE world_id=$1`, [worldId,ownerId,JSON.stringify(lock)]);
}

export async function reserve(store: any, internal: string, account: string, rawName: string): Promise<void> {
  const quote = quoteWorldName(rawName);
  if (!enabled || systemName(quote.name)) throw new Error("This name cannot be reserved.");
  const result = await store.withTransaction(async (client: any) => {
    await mutex(store, client); await expire(store, client);
    const row = (await client.query(`SELECT n.* FROM ${store.table("world_name_registry")} n
      JOIN ${store.table("worlds")} w USING(world_id) WHERE w.world_name=$1 FOR UPDATE OF n`, [internal])).rows[0];
    if (!row || row.owner_account_id !== account) throw new Error("Only the world owner can reserve its name.");
    if (row.status === "reserved" && row.public_name === quote.name) return true; // No timer reset.
    if (row.status !== "generated") throw new Error("This world already has a reserved or claimed name.");
    if ((await client.query(`SELECT 1 FROM ${store.table("world_name_registry")} WHERE public_name=$1`, [quote.name])).rows.length) throw new Error("That name is in use.");
    if ((await client.query(`SELECT 1 FROM ${store.table("world_name_cooldowns")} WHERE account_id=$1 AND name=$2 AND until_at>clock_timestamp()`, [account,quote.name])).rows.length) throw new Error("You must wait seven days before reserving this expired name again.");
    await client.query(`UPDATE ${store.table("world_name_registry")} SET public_name=$2,status='reserved',quoted_gems=$3,
      pricing_version=$4,reserved_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days',updated_at=clock_timestamp()
      WHERE world_id=$1`, [row.world_id,quote.name,quote.price_gems,quote.pricing_version]);
    await store.recordTransactionLedger(client, { transaction_type: "WORLD_NAME_RESERVED", source: "world_name", action: "world_name_reserve",
      world_id: row.world_id, status: "success", metadata: { name:quote.name, quoted_gems:quote.price_gems,owner_account_id:account,duration_ms:RESERVATION_DURATION_MS } });
    return true;
  }, "world_name_reserve");
  if (!result) throw new Error("Name service unavailable.");
}

// Invoked inside the existing inventory transaction. Lock/validate BEFORE gems
// change; the receipt, gem ledger, transaction ledger and debit commit together.
export async function prepareClaim(store: any, client: any, worldId: string, playerId: string, deltas: RecordData[], metadata: RecordData): Promise<RecordData> {
  if (!enabled) throw new Error("Name claims are not active.");
  const row = (await client.query(`SELECT n.*,p.account_id FROM ${store.table("world_name_registry")} n
    JOIN ${store.table("players")} p ON p.player_id=$2 WHERE n.world_id=$1 FOR UPDATE OF n`, [worldId,playerId])).rows[0];
  if (!row || row.owner_account_id !== row.account_id) throw new Error("Only the owner can claim this name.");
  if (row.status !== "reserved") throw new Error("This name is not pending payment.");
  const live = await client.query(`SELECT expires_at>clock_timestamp() AS live FROM ${store.table("world_name_registry")} WHERE world_id=$1`, [worldId]);
  if (!live.rows[0]?.live) throw new Error("The name reservation expired.");
  if (row.public_name !== metadata.claim_name || Number(row.quoted_gems) !== Number(metadata.claim_price)) throw new Error("The name or price changed. Open the lock again.");
  if (deltas.length !== 1 || deltas[0].item_type !== "gem" || deltas[0].item_category !== "currency" || deltas[0].delta !== -Number(row.quoted_gems)) throw new Error("Invalid name payment.");
  return row;
}
export async function finishClaim(store: any, client: any, row: RecordData, requestId: string): Promise<void> {
  await client.query(`INSERT INTO ${store.table("world_name_claim_receipts")}
    (world_id,claimed_name,payer_account_id,paid_gems,pricing_version,request_id) VALUES($1,$2,$3,$4,$5,$6)`,
  [row.world_id,row.public_name,row.account_id,row.quoted_gems,row.pricing_version,requestId]);
  await client.query(`UPDATE ${store.table("world_name_registry")} SET status='claimed',expires_at=NULL,updated_at=clock_timestamp() WHERE world_id=$1`, [row.world_id]);
}

export async function owned(store: any, account: string): Promise<RecordData[]> {
  if (!enabled || !store.isReady()) return [];
  await sweep(store);
  const rows = await store.db.query(`SELECT public_name,owner_lock FROM ${store.table("world_name_registry")}
    WHERE owner_account_id=$1 ORDER BY public_name LIMIT 250`, [account]);
  return rows.rows.map((row: RecordData) => ({...row.owner_lock,world_name:row.public_name,is_locked:true,source_label:"SERVER"}));
}

export async function aliases(store: any, identities: string[]): Promise<Record<string,string>> {
  if (!enabled || !store.isReady() || !identities.length) return {};
  const result = await store.db.query(`SELECT w.world_name::text AS identity,n.public_name
    FROM ${store.table("world_name_registry")} n JOIN ${store.table("worlds")} w USING(world_id)
    WHERE w.world_name::text=ANY($1::text[])`, [identities]);
  return Object.fromEntries(result.rows.map((row: RecordData) => [row.identity,row.public_name]));
}
