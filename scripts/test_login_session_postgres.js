"use strict";

// Real PostgreSQL SQL in isolated WASM. No live accounts, credentials or servers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = process.env.QUEST_TEST_PGLITE_PATH || "@electric-sql/pglite";
const { PGlite } = require(runtime);
const contrib = process.env.QUEST_TEST_PGLITE_PATH ? path.join(runtime, "dist/contrib") : "@electric-sql/pglite/contrib";
const { citext } = require(process.env.QUEST_TEST_PGLITE_PATH ? path.join(contrib, "citext.cjs") : contrib + "/citext");
const { pgcrypto } = require(process.env.QUEST_TEST_PGLITE_PATH ? path.join(contrib, "pgcrypto.cjs") : contrib + "/pgcrypto");
const Store = require("../postgres_store");

async function main() {
  const db = new PGlite({ extensions: { citext, pgcrypto } });
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, "../docs/postgres_security_foundation.sql"), "utf8"));
    const statements = [];
    let abortAfterInsert = false;
    let connected = true;
    const query = async (sql, args) => {
      statements.push(sql);
      const result = args ? await db.query(sql, args) : (await db.exec(sql)).at(-1);
      if (abortAfterInsert && /INSERT INTO .*sessions/.test(sql)) connected = false;
      return result;
    };
    const store = new Store({ enabled: false, schema: "pixelmania", logger() {} });
    store.pool = { query, connect: async () => ({ query, release() {} }) };
    store.enabled = true;
    store.ready = true;
    const account = {
      username: "LoginTest", email: "login@example.invalid", role: "player",
      session_token_hash: "session-1", refresh_token_hash: "refresh-1",
      session_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 7200000).toISOString(),
    };
    const options = { concurrent: true, revokeOtherSessions: true, shouldContinue: () => connected };
    assert.equal((await store.saveSession(account, options)).ok, true, "Missing legacy identity must still be created");
    const identity = (await db.query("SELECT a.account_id, p.player_id FROM pixelmania.accounts a JOIN pixelmania.players p USING(account_id)")).rows[0];
    await db.exec("UPDATE pixelmania.players SET current_world_name='LEGACYWORLD'; UPDATE pixelmania.accounts SET email_verified=true;");
    // An existing identity should be usable even when writes to these rows are
    // unavailable. Gameplay saves lock the player row; login needs only its IDs.
    await db.exec(`CREATE FUNCTION pixelmania.reject_identity_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unnecessary identity write'; END $$;
      CREATE TRIGGER reject_account_write BEFORE INSERT OR UPDATE ON pixelmania.accounts FOR EACH ROW EXECUTE FUNCTION pixelmania.reject_identity_write();
      CREATE TRIGGER reject_player_write BEFORE INSERT OR UPDATE ON pixelmania.players FOR EACH ROW EXECUTE FUNCTION pixelmania.reject_identity_write();`);
    statements.length = 0;
    const rotated = { ...account, session_token_hash: "session-2", refresh_token_hash: "refresh-2" };
    assert.equal((await store.saveSession(rotated, { ...options, rotatedFromTokenHash: "refresh-1", revokeRotatedToken: true })).ok, true);
    const rotationStatements = statements.filter(sql => !["BEGIN", "COMMIT"].includes(sql));
    assert.equal(rotationStatements.length, 5, "Existing identity rotation uses five statements instead of seven");
    assert(!rotationStatements.some(sql => /(?:INSERT INTO|UPDATE) .*\"(?:accounts|players)\"/.test(sql)));
    assert.equal((await store.validateSessionToken("LoginTest", "refresh-1", { concurrent: true })).ok, false);
    assert.equal((await store.validateSessionToken("LoginTest", "refresh-2", { concurrent: true })).ok, true);
    assert.equal((await store.validateSessionToken("DifferentUser", "refresh-2", { concurrent: true })).ok, false);
    const beforeAbort = (await db.query("SELECT count(*) AS n FROM pixelmania.sessions")).rows[0].n;
    abortAfterInsert = true;
    const aborted = await store.saveSession({ ...rotated, session_token_hash: "aborted", refresh_token_hash: "aborted-refresh" }, options);
    assert.equal(aborted.reason, "aborted");
    assert.equal((await db.query("SELECT count(*) AS n FROM pixelmania.sessions")).rows[0].n, beforeAbort);
    assert.equal((await store.validateSessionToken("LoginTest", "refresh-2", { concurrent: true })).ok, true, "Aborted sign-on cannot revoke the saved login");
    connected = true;
    abortAfterInsert = false;
    await db.exec("DROP TRIGGER reject_account_write ON pixelmania.accounts; DROP TRIGGER reject_player_write ON pixelmania.players;");
    // Preserve the previous repair/update semantics for differing legacy data.
    assert.equal((await store.saveSession({ ...account, email: "updated@example.invalid", session_token_hash: "session-3", refresh_token_hash: "refresh-3" }, options)).ok, true);
    const after = (await db.query("SELECT a.account_id, a.email::text AS email, p.player_id, p.current_world_name FROM pixelmania.accounts a JOIN pixelmania.players p USING(account_id)")).rows[0];
    assert.equal(after.account_id, identity.account_id);
    assert.equal(after.player_id, identity.player_id);
    assert.equal(after.email, "updated@example.invalid");
    assert.equal(after.current_world_name, "LEGACYWORLD");
    console.log("LOGIN_SESSION_POSTGRES_OK: existing identities, rotation, revocation, rollback, legacy repair; 7 -> 5 rotation statements");
  } finally {
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
