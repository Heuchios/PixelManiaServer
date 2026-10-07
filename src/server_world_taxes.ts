// Durable account bills. Ownership changes settle the old count before recording
// the new count. Weekly high-water billing prevents transfer/lock-reset avoidance.
export const enabled = /^(1|true)$/i.test(process.env.WORLD_TAX_ENABLED || "false");
export const WEEK_MS = 7 * 86400000;
export const FREE_WORLDS = 3;
export const RATE = 500;
type Row = Record<string, any>;
async function lock(store: any, client: any): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${store.schema}:world-tax-v1`]);
}
export async function ensureSchema(store: any): Promise<void> {
  if (!enabled) {
    const existing = await store.db.query("SELECT to_regclass($1) AS present", [`${store.schema}.world_tax_activation`]);
    if (existing.rows[0]?.present) {
      const active = await store.db.query(`SELECT 1 FROM ${store.table("world_tax_activation")} LIMIT 1`);
      if (active.rows.length) throw new Error("World tax was activated. WORLD_TAX_ENABLED must remain true on every shard.");
    }
    return;
  }
  if (!/^(1|true)$/i.test(process.env.WORLD_NAME_CLAIMS_ENABLED || "false")) throw new Error("World tax requires world name ownership.");
  const client = await store.db.connect();
  try {
    await client.query("BEGIN");
    await lock(store, client);
    await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("world_tax_activation")} (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), activated_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("world_tax_accounts")} (
      account_id uuid PRIMARY KEY REFERENCES ${store.table("accounts")}(account_id),
      period_start timestamptz NOT NULL DEFAULT now(), owned_count integer NOT NULL CHECK(owned_count>=0),
      peak_extra integer NOT NULL CHECK(peak_extra>=0))`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("world_tax_bills")} (
      account_id uuid NOT NULL REFERENCES ${store.table("accounts")}(account_id),
      period_start timestamptz NOT NULL, due_at timestamptz NOT NULL, grace_until timestamptz NOT NULL,
      amount_gems bigint NOT NULL CHECK(amount_gems>0), paid_at timestamptz, request_id text,
      PRIMARY KEY(account_id,period_start))`);
    await client.query(`CREATE INDEX IF NOT EXISTS world_tax_unpaid_idx ON ${store.table("world_tax_bills")}(account_id,grace_until) WHERE paid_at IS NULL`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("world_tax_payments")} (
      account_id uuid NOT NULL REFERENCES ${store.table("accounts")}(account_id),request_id text NOT NULL,
      amount_gems bigint NOT NULL CHECK(amount_gems>0),paid_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(account_id,request_id))`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("world_tax_transfer_permits")} (
      world_id uuid PRIMARY KEY REFERENCES ${store.table("worlds")}(world_id),
      from_account_id uuid NOT NULL REFERENCES ${store.table("accounts")}(account_id),
      to_account_id uuid NOT NULL REFERENCES ${store.table("accounts")}(account_id),
      request_id text NOT NULL,authorized_at timestamptz NOT NULL DEFAULT now())`);
    const activation = await client.query(`INSERT INTO ${store.table("world_tax_activation")}(singleton) VALUES(true)
      ON CONFLICT DO NOTHING RETURNING activated_at`);
    if (activation.rows.length) await client.query(`INSERT INTO ${store.table("world_tax_accounts")}(account_id,period_start,owned_count,peak_extra)
      SELECT owner_account_id,$1,count(*)::integer,GREATEST(count(*)::integer-3,0)
      FROM ${store.table("world_name_registry")} WHERE owner_account_id IS NOT NULL GROUP BY owner_account_id`, [activation.rows[0].activated_at]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
// Must run under the tax advisory lock; PostgreSQL time is authoritative.
async function settle(store: any, client: any, account: string): Promise<Row> {
  await client.query(`INSERT INTO ${store.table("world_tax_accounts")}(account_id,owned_count,peak_extra)
    SELECT $1,count(*)::integer,GREATEST(count(*)::integer-3,0) FROM ${store.table("world_name_registry")} WHERE owner_account_id=$1
    ON CONFLICT DO NOTHING`, [account]);
  const row = (await client.query(`SELECT *,now() AS server_now,
    GREATEST(0,floor(extract(epoch FROM (now()-period_start))/604800))::integer AS weeks
    FROM ${store.table("world_tax_accounts")} WHERE account_id=$1 FOR UPDATE`, [account])).rows[0];
  const weeks = Number(row.weeks);
  if (weeks > 0) {
    const assessed = await client.query(`INSERT INTO ${store.table("world_tax_bills")}(account_id,period_start,due_at,grace_until,amount_gems)
      SELECT $1,$2::timestamptz+i*interval '7 days',$2::timestamptz+(i+1)*interval '7 days',
      $2::timestamptz+(i+2)*interval '7 days',CASE WHEN i=0 THEN $4::bigint ELSE $5::bigint END
      FROM generate_series(0,$3::integer-1) AS i WHERE (CASE WHEN i=0 THEN $4::bigint ELSE $5::bigint END)>0
      ON CONFLICT DO NOTHING RETURNING period_start,due_at,grace_until,amount_gems`, [account,row.period_start,weeks,Number(row.peak_extra)*RATE,Math.max(0,Number(row.owned_count)-FREE_WORLDS)*RATE]);
    for (const bill of assessed.rows) await store.recordTransactionLedger(client, {
      transaction_type:"WORLD_TAX_ASSESSED",source:"world_tax",action:"world_tax_assess",status:"success",
      metadata:{account_id:account,...bill},
    });
    await client.query(`UPDATE ${store.table("world_tax_accounts")} SET period_start=period_start+$2::integer*interval '7 days',
      peak_extra=GREATEST(owned_count-3,0) WHERE account_id=$1`, [account,weeks]);
  }
  return (await client.query(`SELECT *,now() AS server_now FROM ${store.table("world_tax_accounts")} WHERE account_id=$1`,[account])).rows[0];
}
export async function assertCanAcquire(store: any, client: any, account: string): Promise<void> {
  if (!enabled) return;
  await lock(store,client); await settle(store,client,account);
  const overdue = await client.query(`SELECT 1 FROM ${store.table("world_tax_bills")}
    WHERE account_id=$1 AND paid_at IS NULL AND grace_until<=now() LIMIT 1`,[account]);
  if (overdue.rows.length) throw new Error("Pay overdue world tax in Profile > Taxes before acquiring worlds or reserving/claiming names.");
}
export async function beforeOwnerChange(store: any, client: any, oldOwner: string | null, newOwner: string, worldId: string): Promise<void> {
  if (!enabled || oldOwner === newOwner) return;
  await lock(store,client);
  if (oldOwner) await settle(store,client,oldOwner);
  const permit = (await client.query(`SELECT * FROM ${store.table("world_tax_transfer_permits")} WHERE world_id=$1`,[worldId])).rows[0];
  if (permit) {
    if (permit.from_account_id !== oldOwner || permit.to_account_id !== newOwner) throw new Error("A committed world key trade is awaiting its ownership transfer.");
    // The buyer already passed the check inside the committed trade. Honor that
    // purchase even if a grace deadline passes before the world save completes.
    await settle(store,client,newOwner);
    await client.query(`DELETE FROM ${store.table("world_tax_transfer_permits")} WHERE world_id=$1`,[worldId]);
    return;
  }
  await assertCanAcquire(store,client,newOwner);
}
export async function authorizeTrade(store:any,client:any,worldId:string,fromPlayer:string,toPlayer:string,requestId:string):Promise<void> {
  if (!enabled) return;
  await lock(store,client);
  const owners = (await client.query(`SELECT a.account_id AS from_account,b.account_id AS to_account,n.owner_account_id
    FROM ${store.table("players")} a CROSS JOIN ${store.table("players")} b
    JOIN ${store.table("world_name_registry")} n ON n.world_id=$3
    WHERE a.player_id=$1 AND b.player_id=$2`,[fromPlayer,toPlayer,worldId])).rows[0];
  if (!owners || owners.from_account!==owners.owner_account_id) throw new Error("World ownership changed before the key trade.");
  await assertCanAcquire(store,client,owners.to_account);
  await client.query(`INSERT INTO ${store.table("world_tax_transfer_permits")}(world_id,from_account_id,to_account_id,request_id)
    VALUES($1,$2,$3,$4)`,[worldId,owners.from_account,owners.to_account,requestId]);
}
export async function afterOwnerChange(store: any, client: any, oldOwner: string | null, newOwner: string): Promise<void> {
  if (!enabled || oldOwner === newOwner) return;
  for (const account of [...new Set([oldOwner,newOwner].filter(Boolean))]) {
    await client.query(`UPDATE ${store.table("world_tax_accounts")} SET owned_count=q.n,
      peak_extra=GREATEST(peak_extra,q.n-3) FROM
      (SELECT count(*)::integer AS n FROM ${store.table("world_name_registry")} WHERE owner_account_id=$1) q WHERE account_id=$1`,[account]);
  }
}
async function summary(store: any, client: any, account: string): Promise<Row> {
  const row = await settle(store,client,account);
  const bills = (await client.query(`SELECT period_start,due_at,grace_until,amount_gems,paid_at FROM ${store.table("world_tax_bills")}
    WHERE account_id=$1 AND paid_at IS NULL ORDER BY due_at`,[account])).rows;
  const history = (await client.query(`SELECT due_at,amount_gems,paid_at FROM ${store.table("world_tax_bills")}
    WHERE account_id=$1 AND paid_at IS NOT NULL ORDER BY paid_at DESC LIMIT 10`,[account])).rows;
  const worlds = (await client.query(`SELECT public_name FROM ${store.table("world_name_registry")} WHERE owner_account_id=$1 ORDER BY public_name`,[account])).rows;
  const amount = bills.reduce((total:number,bill:Row)=>total+Number(bill.amount_gems),0);
  if (!Number.isSafeInteger(amount)) throw new Error("World tax total exceeds the supported payment range.");
  return {enabled:true,owned_count:Number(row.owned_count),free_worlds:FREE_WORLDS,rate_gems:RATE,
    weekly_gems:Math.max(0,Number(row.owned_count)-FREE_WORLDS)*RATE,current_bill_gems:Number(row.peak_extra)*RATE,
    next_due_at:new Date(new Date(row.period_start).getTime()+WEEK_MS).toISOString(),
    amount_due:amount,blocked:bills.some((bill:Row)=>new Date(bill.grace_until).getTime()<=new Date(row.server_now).getTime()),
    bills,history,worlds:worlds.map((world:Row)=>world.public_name),server_now:row.server_now};
}
export async function status(store: any, account: string): Promise<Row> {
  if (!enabled) return {enabled:false};
  return await store.withTransaction(async(client:any)=>{await lock(store,client);return await summary(store,client,account);},"world_tax_status");
}
export async function preparePayment(store: any, client: any, playerId: string, deltas: Row[], metadata: Row, requestId: string): Promise<string> {
  if (!enabled) throw new Error("World tax is not active.");
  await lock(store,client);
  const account = (await client.query(`SELECT account_id FROM ${store.table("players")} WHERE player_id=$1`,[playerId])).rows[0]?.account_id;
  if (!account) throw new Error("Account not found.");
  const prior = await client.query(`SELECT 1 FROM ${store.table("world_tax_payments")} WHERE account_id=$1 AND request_id=$2`,[account,requestId]);
  if (prior.rows.length) throw new Error("This tax payment was already processed. Refresh Taxes.");
  const info = await summary(store,client,account);
  if (info.amount_due<=0 || info.amount_due!==metadata.tax_amount) throw new Error("The tax bill changed. Refresh Taxes before paying.");
  if (deltas.length!==1 || deltas[0].item_type!=="gem" || deltas[0].item_category!=="currency" || deltas[0].delta!==-info.amount_due) throw new Error("Invalid tax payment.");
  return account;
}
export async function finishPayment(store:any,client:any,account:string,requestId:string):Promise<void> {
  await client.query(`INSERT INTO ${store.table("world_tax_payments")}(account_id,request_id,amount_gems)
    SELECT $1,$2,sum(amount_gems) FROM ${store.table("world_tax_bills")} WHERE account_id=$1 AND paid_at IS NULL`,[account,requestId]);
  await client.query(`UPDATE ${store.table("world_tax_bills")} SET paid_at=now(),request_id=$2 WHERE account_id=$1 AND paid_at IS NULL`,[account,requestId]);
}
