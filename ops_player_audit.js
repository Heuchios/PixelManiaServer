"use strict";

// This service never initializes PostgresStore or writes gameplay tables.
const crypto = require("node:crypto");
const { Pool } = require("pg");
const Contracts = require("./postgres_store_contracts");
const ItemDb = require("./server_item_database");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
const sha256 = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const secretKey = /password|salt|token|secret|cookie|authorization|session_id|account_state|email_verification/i;
function redact(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, secretKey.test(k) ? "[redacted]" : redact(v)]));
  return value;
}
function error(status, message) { return Object.assign(new Error(message), {status}); }
function integer(value, fallback, max) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) > max) throw error(400, "Invalid page size or offset.");
  return Number(value);
}
function filters(params) {
  const result = {limit: Math.max(1, integer(params.get("limit"), 50, 100)), offset:integer(params.get("offset"), 0, 1000000000)};
  result.ceiling=String(params.get("ceiling") || "");
  if(result.ceiling && !/^\d{1,19}$/.test(result.ceiling)) throw error(400,"Invalid evidence boundary.");
  for (const k of ["q", "item", "category", "ref"]) {
    result[k] = String(params.get(k) || "").trim();
    if (result[k].length > 160) throw error(400, "Search is too long.");
  }
  for (const k of ["since", "until"]) {
    const v = params.get(k);
    if (v && !Number.isFinite(Date.parse(v))) throw error(400, "Invalid date filter.");
    result[k] = v ? new Date(v).toISOString() : null;
  }
  if (result.since && result.until && result.since > result.until) throw error(400, "The start date must be before the end date.");
  return result;
}
function createPool(env) {
  if (env.POSTGRES_ENABLED !== "true") throw error(503, "Player auditing requires the authoritative PostgreSQL database.");
  return new Pool({connectionString:env.POSTGRES_CONNECTION_STRING || env.DATABASE_URL || undefined,
    host:env.POSTGRES_HOST || undefined, port:Number(env.POSTGRES_PORT || 5432), database:env.POSTGRES_DATABASE || undefined,
    user:env.POSTGRES_USER || undefined,password:env.POSTGRES_PASSWORD || undefined,
    ssl:env.POSTGRES_SSL === "true" ? {rejectUnauthorized:false} : undefined,
    max:2, connectionTimeoutMillis:5000, idleTimeoutMillis:30000, statement_timeout:12000,
    application_name:"pixelmania-ops-player-audit"});
}
class PlayerAudit {
  constructor({pool, env = process.env} = {}) {
    const schema = env.POSTGRES_SCHEMA || "pixelmania";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw error(503, "Invalid audit database schema.");
    this.table = name => `"${schema}"."${name}"`;
    this.pool = pool || createPool(env);
    this.pool.on?.("error", () => {});
    this.schemaPromise = null;
    this.inFlight = 0;
  }
  async ensureSchema() {
    if (!this.schemaPromise) this.schemaPromise = this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table("ops_player_access_audit")} (
      access_id bigserial PRIMARY KEY, request_id uuid NOT NULL, event jsonb NOT NULL,
      previous_hash text NOT NULL, entry_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`).catch(e => { this.schemaPromise = null; throw e; });
    return this.schemaPromise;
  }
  async receipt(event) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '4s'");
      await client.query("SELECT pg_advisory_xact_lock(176943, 8102)");
      const previous = (await client.query(`SELECT entry_hash FROM ${this.table("ops_player_access_audit")} ORDER BY access_id DESC LIMIT 1`)).rows[0]?.entry_hash || "";
      const hash = sha256({previous_hash:previous,event});
      const row = (await client.query(`INSERT INTO ${this.table("ops_player_access_audit")} (request_id,event,previous_hash,entry_hash) VALUES ($1,$2::jsonb,$3,$4) RETURNING access_id,created_at`, [event.request_id,JSON.stringify(event),previous,hash])).rows[0];
      await client.query("COMMIT");
      return {...row,entry_hash:hash,previous_hash:previous};
    } catch(e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
    finally { client.release(); }
  }
  async request(url, actor) {
    if (this.inFlight >= 4) throw error(429, "Player auditing is busy. Try again shortly.");
    this.inFlight++;
    const requestId = crypto.randomUUID();
    let client;
    try {
      const f = filters(url.searchParams);
      const event = {request_id:requestId,at:new Date().toISOString(),actor:actor.email,auth_mode:actor.mode,
        session_fingerprint:actor.session_id_hash || "",remote:actor.remote || "",path:url.pathname,filters:f};
      await this.ensureSchema();
      await this.receipt({...event,outcome:"requested"});
      try {
        client = await this.pool.connect();
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout = '12s'");
        const captured = (await client.query("SELECT transaction_timestamp() AS captured_at")).rows[0].captured_at;
        const result = redact(await this.route(client,url.pathname,f));
        const payload = {ok:true,request_id:requestId,captured_at:captured,source:"PostgreSQL committed state",...result};
        await client.query("COMMIT"); client.release(); client = null;
        const digest = sha256(payload);
        const receipt = await this.receipt({...event,outcome:"succeeded",response_sha256:digest,captured_at:redact(captured)});
        return {...payload,audit:{...receipt,response_sha256:digest}};
      } catch(e) {
        if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); client = null; }
        await this.receipt({...event,outcome:"failed",status:e.status || 503,error_code:e.code || "audit_query_failed"});
        throw e;
      }
    } finally { if(client) client.release(); this.inFlight--; }
  }
  async route(c, pathname, f) {
    const parts = pathname.split("/").filter(Boolean);
    if (pathname === "/api/players") return this.accounts(c,f);
    if (pathname === "/api/players/access-audit") return this.access(c,f);
    if (parts[2] === "instances" && (parts.length === 4 || (parts.length === 5 && parts[4] === "ledger"))) return this.instance(c,parts[3],f,parts[4] === "ledger");
    if (!uuid.test(parts[2] || "") || parts.length > 4) throw error(400,"Invalid account identifier.");
    const profile = (await c.query(`SELECT a.account_id,a.username::text,a.role,a.is_active,a.email_verified,a.created_at,a.last_login_at,
      p.player_id,p.display_name,p.player_level,p.current_world_name,p.updated_at AS saved_at,
      p.player_state->'gems' AS gems,p.inventory_hash,p.inventory_hash_algorithm,p.inventory_hash_updated_at
      FROM ${this.table("accounts")} a LEFT JOIN ${this.table("players")} p USING(account_id) WHERE a.account_id=$1`, [parts[2]])).rows[0];
    if (!profile) throw error(404,"Account not found.");
    if (parts.length === 3) return this.profile(c,profile);
    return this.history(c,profile,parts[3],f);
  }
  async accounts(c,f) {
    const term = `%${f.q.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
    const rows = (await c.query(`SELECT a.account_id,a.username::text,a.role,a.is_active,a.email_verified,a.created_at,a.last_login_at,
      p.player_id,p.display_name,p.player_level,p.current_world_name,
      (SELECT count(*)::text FROM ${this.table("punishments")} pu WHERE pu.player_id=p.player_id AND pu.is_active AND pu.starts_at<=now() AND (pu.ends_at IS NULL OR pu.ends_at>now())) AS active_punishments,
      (SELECT count(*)::text FROM ${this.table("security_events")} se WHERE (se.account_id=a.account_id OR se.player_id=p.player_id) AND se.severity IN ('high','critical')) AS recorded_security_flags
      FROM ${this.table("accounts")} a LEFT JOIN ${this.table("players")} p USING(account_id)
      WHERE ($1='' OR a.username::text ILIKE $2 OR p.display_name ILIKE $2 OR a.account_id::text=$1 OR p.player_id::text=$1)
      ORDER BY lower(a.username::text),a.account_id LIMIT $3 OFFSET $4`,[f.q,term,f.limit+1,f.offset])).rows;
    const total=(await c.query(`SELECT count(*)::text AS count FROM ${this.table("accounts")} a LEFT JOIN ${this.table("players")} p USING(account_id) WHERE ($1='' OR a.username::text ILIKE $2 OR p.display_name ILIKE $2 OR a.account_id::text=$1 OR p.player_id::text=$1)`,[f.q,term])).rows[0].count;
    return this.page(rows,f,{total,coverage:"All registered accounts, including offline and disabled accounts. Security counts are recorded signals, not verdicts."});
  }
  page(rows,f,extra={}) { return {rows:rows.slice(0,f.limit),has_more:rows.length>f.limit,offset:f.offset,limit:f.limit,...extra}; }
  async profile(c,p) {
    if (!p.player_id) return {profile:p,inventory:[],flags:[],coverage:{note:"Account has no persisted player yet."}};
    const inv = (await c.query(`WITH counts AS (
      SELECT item_type,item_category,count(*)::text AS instances FROM ${this.table("item_instances")} WHERE owner_player_id=$1 AND state='active' AND current_location='inventory' GROUP BY item_type,item_category)
      SELECT COALESCE(i.item_type,n.item_type) AS item_type,COALESCE(i.item_category,n.item_category) AS item_category,
      COALESCE(i.amount,0)::text AS amount,i.stack_limit::text,i.updated_at,COALESCE(n.instances,'0') AS instances
      FROM (SELECT * FROM ${this.table("inventory")} WHERE player_id=$1 AND amount<>0) i FULL JOIN counts n USING(item_type,item_category)
      ORDER BY item_category,item_type`,[p.player_id])).rows;
    const flags=[];
    for (const row of inv) {
      row.name=ItemDb.getItemDefinition(row.item_type)?.display_name || row.item_type;
      row.tracked=Contracts.shouldTrackItemInstance(row.item_type,row.item_category);
      row.unit=row.item_category === "fish" ? "tenths of kg" : "items";
      if (row.tracked && row.amount !== row.instances) flags.push({type:"instance_count_mismatch",severity:"high",classification:"needs_review",item_type:row.item_type,item_category:row.item_category,inventory_amount:row.amount,active_instances:row.instances,source:"inventory + item_instances",explanation:"Tracked quantity differs from active inventory instances. This proves an inconsistency, not who caused it."});
    }
    const latest=(await c.query(`SELECT DISTINCT ON (item_category,item_type) item_category,item_type,after_amount::text,item_transaction_id,created_at FROM ${this.table("item_transactions")} WHERE player_id=$1 ORDER BY item_category,item_type,created_at DESC,item_transaction_id DESC`,[p.player_id])).rows;
    const quantities=new Map(inv.map(r=>[`${r.item_category}:${r.item_type}`,r.amount]));
    for(const row of latest) if(row.after_amount!==null && (quantities.get(`${row.item_category}:${row.item_type}`) || "0")!==row.after_amount) {
      flags.push({type:"latest_item_balance_mismatch",severity:"high",classification:"needs_review",item_type:row.item_type,item_category:row.item_category,inventory_amount:quantities.get(`${row.item_category}:${row.item_type}`) || "0",ledger_after:row.after_amount,evidence_id:row.item_transaction_id,source:"item_transactions",explanation:"Committed inventory differs from the most recent recorded after-balance. Investigate missing, delayed or altered ledger evidence."});
    }
    const impossible=(await c.query(`SELECT item_instance_id,public_item_instance_id,item_type,state,current_location FROM ${this.table("item_instances")} WHERE owner_player_id=$1 AND (
      (state='active' AND current_location<>'inventory') OR (state='locked' AND current_location NOT IN ('vending','safe','display')) OR
      (state='dropped' AND current_location<>'world_drop') OR (state IN ('consumed','destroyed','traded') AND current_location='inventory')) ORDER BY item_instance_id`,[p.player_id])).rows;
    for(const row of impossible) flags.push({...row,type:"impossible_instance_state",severity:"high",classification:"needs_review",source:"item_instances",explanation:"Instance state and location disagree with the server's item-instance rules."});
    const lastGem=(await c.query(`SELECT gem_ledger_id,after_balance::text FROM ${this.table("gem_ledger")} WHERE player_id=$1 ORDER BY created_at DESC,gem_ledger_id DESC LIMIT 1`,[p.player_id])).rows[0];
    if(lastGem?.after_balance!==null && lastGem && p.gems!==null && String(p.gems)!==lastGem.after_balance) flags.push({type:"gem_balance_mismatch",severity:"high",classification:"needs_review",source:"gem_ledger",evidence_id:lastGem.gem_ledger_id,current_gems:p.gems,ledger_after:lastGem.after_balance,explanation:"Saved gems differ from the most recent gem ledger after-balance."});
    const hashRows=(await c.query(`SELECT item_type,item_category,amount::text,stack_limit::text FROM ${this.table("inventory")} WHERE player_id=$1 AND amount<>0 ORDER BY item_category,item_type`,[p.player_id])).rows;
    const computed=crypto.createHash("sha256").update(JSON.stringify(hashRows)).digest("hex");
    const hashState=!p.inventory_hash ? "missing" : p.inventory_hash===computed ? "verified" : "mismatch";
    if(hashState!=="verified") flags.push({type:`inventory_hash_${hashState}`,severity:hashState==="missing"?"notice":"high",classification:"needs_review",stored_hash:p.inventory_hash,computed_hash:computed,source:"players.inventory_hash + inventory",explanation:hashState==="missing"?"No saved hash exists for this inventory.":"Saved hash does not match the current inventory snapshot."});
    const coverage=(await c.query(`SELECT
      (SELECT min(created_at) FROM ${this.table("item_transactions")} WHERE player_id=$1) AS first_item_transaction,
      (SELECT count(*)::text FROM ${this.table("transaction_ledger")} WHERE player_id=$1 OR other_player_id=$1) AS ledger_rows,
      (SELECT count(*)::text FROM ${this.table("punishments")} WHERE player_id=$1) AS punishment_rows,
      (SELECT count(*)::text FROM ${this.table("security_events")} WHERE player_id=$1 OR account_id=$2) AS security_rows`,[p.player_id,p.account_id])).rows[0];
    return {profile:p,inventory:inv,flags,coverage:{...coverage,inventory_hash:hashState,computed_inventory_hash:computed,
      note:"Committed database state at the capture time; unsaved live changes may lag. Flags indicate evidence requiring review, not proof of player intent. Historical actions before logging began cannot be reconstructed. Histories are paginated; no date limit is applied unless selected."}};
  }
  async history(c,p,section,f) {
    const t=this.table;
    const pid=p.player_id;
    // Only allowlisted table/column names reach SQL; all filters are bound values.
    const specs={
      ledger:{table:"transaction_ledger",id:"transaction_ledger_id",where:"(r.player_id=$1 OR r.other_player_id=$1)",time:"server_time",item:true,ref:"r.request_id=$7 OR r.correlation_id::text=$7 OR r.transaction_id::text=$7 OR r.public_item_instance_id=$7 OR r.transaction_ledger_id::text=$7"},
      items:{table:"item_transactions",id:"item_transaction_id",where:"r.player_id=$1",item:true,ref:"r.request_id=$7 OR r.correlation_id::text=$7 OR r.tx_uuid::text=$7 OR r.item_transaction_id::text=$7"},
      gems:{table:"gem_ledger",id:"gem_ledger_id",where:"r.player_id=$1"},
      instances:{table:"item_instances",id:"item_instance_id",where:"r.owner_player_id=$1",item:true,ref:"r.public_item_instance_id=$7 OR r.item_instance_id::text=$7"},
      security:{table:"security_events",id:"security_event_id",where:"(r.player_id=$1 OR r.account_id=$2)",ref:"r.request_id=$7 OR r.security_event_id::text=$7"},
      punishments:{table:"punishments",id:"punishment_id",where:"r.player_id=$1"},
      moderation:{table:"admin_actions",id:"admin_action_id",where:"(r.admin_player_id=$1 OR r.target_id=$1::text OR lower(r.target_id)=lower($2) OR lower(r.metadata->>'target_username')=lower($2) OR lower(r.metadata->>'account_username')=lower($2))"},
      blocks:{table:"world_block_changes",id:"world_block_change_id",where:"r.player_id=$1",item:false},
      objects:{table:"world_object_changes",id:"world_object_change_id",where:"r.player_id=$1",item:false},
      rollbacks:{table:"rollback_jobs",id:"rollback_job_id",where:"lower(r.target_username)=lower($2)"}
    };
    if(section==="worlds") {
      const areaSchema=(await c.query("SELECT to_regclass($1)::text AS locks,to_regclass($2)::text AS access",[t("world_area_locks"),t("world_area_lock_access")])).rows[0];
      const area=Boolean(areaSchema.locks && areaSchema.access);
      const rows=(await c.query(`SELECT w.world_id,w.world_name::text,w.owner_player_id,w.last_saved_at,w.world_revision,w.is_active,
        CASE WHEN w.owner_player_id=$1 OR wl.owner_player_id=$1 THEN 'owner' WHEN wm.role IS NOT NULL THEN wm.role WHEN la.player_id IS NOT NULL THEN 'world lock access' ELSE 'area lock owner/access' END AS relationship,
        la.can_build,la.can_break,la.can_manage_lock,wl.lock_type${area?",aa.locks AS area_locks":""}
        FROM ${t("worlds")} w LEFT JOIN ${t("world_members")} wm ON wm.world_id=w.world_id AND wm.player_id=$1
        LEFT JOIN ${t("world_lock_access")} la ON la.world_id=w.world_id AND la.player_id=$1
        LEFT JOIN ${t("world_locks")} wl ON wl.world_id=w.world_id
        ${area?`LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('lock_key',al.lock_key,'lock_type',al.lock_type,'owner_player_id',al.owner_player_id,'role',CASE WHEN al.owner_player_id=$1 THEN 'owner' ELSE ala.role END,'x',al.lock_x,'y',al.lock_y)) AS locks FROM ${t("world_area_locks")} al LEFT JOIN ${t("world_area_lock_access")} ala ON ala.world_area_lock_id=al.world_area_lock_id AND ala.player_id=$1 WHERE al.world_id=w.world_id AND (al.owner_player_id=$1 OR ala.player_id=$1)) aa ON true`:""}
        WHERE w.owner_player_id=$1 OR wl.owner_player_id=$1 OR wm.player_id=$1 OR la.player_id=$1 ${area?"OR aa.locks IS NOT NULL":""} ORDER BY w.world_name,w.world_id LIMIT $2 OFFSET $3`,[pid,f.limit+1,f.offset])).rows;
      return this.page(rows,f,{section,coverage:`Owned worlds, world memberships and world-lock access. ${area?"Area-lock ownership and access are included.":"Area-lock tables are unavailable in this database version."} World visit history is not ownership.`});
    }
    if(section==="flags") return this.flagHistory(c,p,f);
    const spec=specs[section];
    if(!spec) throw error(404,"Unknown player audit section.");
    const time=spec.time || "created_at";
    const values=[pid, section==="security" ? p.account_id : p.username,f.since,f.until,f.item,f.category,f.ref,f.limit+1,f.offset];
    const conditions=[spec.where,"($2::text IS NULL OR $2::text IS NOT NULL)",`($3::timestamptz IS NULL OR r.${time}>=$3)`,`($4::timestamptz IS NULL OR r.${time}<=$4)`,spec.item?"($5='' OR r.item_type=$5)":"$5=''",spec.item?"($6='' OR r.item_category=$6)":"$6=''",spec.ref?`($7='' OR ${spec.ref})`:"$7=''"];
    // security account UUID needs an explicit cast because other sections use a username.
    if(section==="security") conditions[0]="(r.player_id=$1 OR r.account_id=$2::uuid)";
    if(section==="rollbacks") conditions.push("($1::uuid IS NULL OR $1::uuid IS NOT NULL)");
    const hasWorld=!["gems","rollbacks"].includes(section);
    const ceiling=["instances","rollbacks"].includes(section)?null:f.ceiling || (await c.query(`SELECT COALESCE(max(${spec.id}),0)::text AS ceiling FROM ${t(spec.table)}`)).rows[0].ceiling;
    if(ceiling!==null) {values.push(ceiling);conditions.push(`r.${spec.id}<=$10::bigint`);}
    const rows=(await c.query(`SELECT r.*${hasWorld?",w.world_name::text":""} FROM ${t(spec.table)} r ${hasWorld?`LEFT JOIN ${t("worlds")} w ON w.world_id=r.world_id`:""} WHERE ${conditions.join(" AND ")} ORDER BY r.${time} DESC,r.${spec.id} DESC LIMIT $8 OFFSET $9`,values)).rows;
    for(const row of rows) {
      if(section==="ledger") row.hash_verification=!row.transaction_hash?"missing":Contracts.buildTransactionLedgerHash(row)===row.transaction_hash?"verified":"mismatch";
      if(section==="punishments") row.effective_status=!row.is_active?"revoked":Date.parse(row.starts_at)>Date.now()?"scheduled":row.ends_at && Date.parse(row.ends_at)<=Date.now()?"expired":"active";
    }
    return this.page(rows,f,{section,ceiling,source_table:spec.table,coverage:"Retained database records matching these filters. Open evidence for IDs, amounts, before/after values, reasons and correlation links. Numbered history pages retain their initial record boundary."});
  }
  async flagHistory(c,p,f) {
    const rows=(await c.query(`SELECT security_event_id AS evidence_id,'security_events' AS source,severity,event_type AS type,created_at,details AS evidence,
      CASE WHEN event_type ~* '(dupe|duplicat|instance|integrity)' THEN 'duplication_or_integrity_signal' ELSE 'security_signal' END AS classification
      FROM ${this.table("security_events")} WHERE (player_id=$1 OR account_id=$2) AND (severity IN ('high','critical') OR event_type ~* '(dupe|duplicat|instance|integrity)')
      AND ($3::timestamptz IS NULL OR created_at>=$3) AND ($4::timestamptz IS NULL OR created_at<=$4)
      UNION ALL SELECT transaction_ledger_id,'transaction_ledger','high',transaction_type,server_time,metadata,'blocked_or_failed_transaction'
      FROM ${this.table("transaction_ledger")} WHERE (player_id=$1 OR other_player_id=$1) AND status='failed'
      AND (COALESCE(action,'') || ' ' || COALESCE(metadata->>'reason','') || ' ' || COALESCE(metadata->>'failure_reason','')) ~* '(dupe|duplicat|instance|integrity|mismatch)'
      AND ($3::timestamptz IS NULL OR server_time>=$3) AND ($4::timestamptz IS NULL OR server_time<=$4)
      ORDER BY created_at DESC,source,evidence_id DESC LIMIT $5 OFFSET $6`,[p.player_id,p.account_id,f.since,f.until,f.limit+1,f.offset])).rows;
    return this.page(rows,f,{section:"flags",coverage:"All retained high/critical security events, duplication/integrity signals and failed item-integrity transactions. A blocked attempt does not mean items were duplicated. Current inventory inconsistencies appear in the profile."});
  }
  async instance(c,id,f,ledger=false) {
    if(!/^PM-ITEM-[A-Z0-9-]{1,80}$/.test(id)) throw error(400,"Invalid public item instance ID.");
    const instance=(await c.query(`SELECT i.*,a.username::text AS owner_username,w.world_name::text FROM ${this.table("item_instances")} i LEFT JOIN ${this.table("players")} p ON p.player_id=i.owner_player_id LEFT JOIN ${this.table("accounts")} a USING(account_id) LEFT JOIN ${this.table("worlds")} w USING(world_id) WHERE i.public_item_instance_id=$1`,[id])).rows[0];
    if(!instance) throw error(404,"Item instance not found.");
    if(ledger) {
      const rows=(await c.query(`SELECT l.*,a.username::text AS player_username,b.username::text AS other_username,w.world_name::text
        FROM ${this.table("transaction_ledger")} l LEFT JOIN ${this.table("players")} p ON p.player_id=l.player_id LEFT JOIN ${this.table("accounts")} a ON a.account_id=p.account_id
        LEFT JOIN ${this.table("players")} op ON op.player_id=l.other_player_id LEFT JOIN ${this.table("accounts")} b ON b.account_id=op.account_id LEFT JOIN ${this.table("worlds")} w ON w.world_id=l.world_id
        WHERE l.item_instance_id=$1 OR l.public_item_instance_id=$2 OR l.item_transaction_id IN (SELECT item_transaction_id FROM ${this.table("item_instance_events")} WHERE item_instance_id=$1 AND item_transaction_id IS NOT NULL)
          OR l.metadata @> jsonb_build_object('item_instances',jsonb_build_array(jsonb_build_object('public_item_instance_id',$2::text)))
        ORDER BY l.server_time DESC,l.transaction_ledger_id DESC LIMIT $3 OFFSET $4`,[instance.item_instance_id,id,f.limit+1,f.offset])).rows;
      for(const row of rows) row.hash_verification=!row.transaction_hash?"missing":Contracts.buildTransactionLedgerHash(row)===row.transaction_hash?"verified":"mismatch";
      return this.page(rows,f,{instance,coverage:"Ledger entries linked by instance ID, instance event transaction IDs or recorded item-instance metadata, across all owners. Batch transactions may cover additional items."});
    }
    const rows=(await c.query(`SELECT e.*,fa.username::text AS from_username,ta.username::text AS to_username,w.world_name::text
      FROM ${this.table("item_instance_events")} e LEFT JOIN ${this.table("players")} fp ON fp.player_id=e.from_player_id LEFT JOIN ${this.table("accounts")} fa ON fa.account_id=fp.account_id
      LEFT JOIN ${this.table("players")} tp ON tp.player_id=e.to_player_id LEFT JOIN ${this.table("accounts")} ta ON ta.account_id=tp.account_id
      LEFT JOIN ${this.table("worlds")} w USING(world_id) WHERE e.item_instance_id=$1
      ORDER BY e.created_at DESC,e.item_instance_event_id DESC LIMIT $2 OFFSET $3`,[instance.item_instance_id,f.limit+1,f.offset])).rows;
    return this.page(rows,f,{instance,coverage:"Complete retained lifecycle, paginated, including previous owners and locations. Correlation and item transaction IDs link to ledger evidence."});
  }
  async access(c,f) {
    const rows=(await c.query(`SELECT * FROM ${this.table("ops_player_access_audit")} ORDER BY access_id DESC LIMIT $1 OFFSET $2`,[f.limit+1,f.offset])).rows;
    return this.page(rows,f,{section:"access-audit",coverage:"Every player audit request and result is recorded. Hashes link entries and bind each exported response. Database administrators can alter the database; this is tamper-evident evidence, not external notarization."});
  }
}
module.exports={PlayerAudit,filters,redact,sha256};
