#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PersistenceHelpers = require("../server_persistence_helpers");

const repoRoot = path.join(__dirname, "..");
const postgresSource = fs.readFileSync(path.join(repoRoot, "src", "postgres_store.ts"), "utf8");
const redisSource = fs.readFileSync(path.join(repoRoot, "src", "redis_store.ts"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "src", "server.ts"), "utf8");
const lifecycleSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase11b_lifecycle.ts"), "utf8");
const worldStateSource = fs.readFileSync(path.join(repoRoot, "src", "server_world_state_helpers.ts"), "utf8");

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function createGate() {
  /** @type {() => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

/** @param {unknown} value */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class RevisionStore {
  constructor() {
    /** @type {Map<string, {revision: number, state: Record<string, any>, instance: string, token: string, epoch: number}>} */
    this.rows = new Map();
    this.failNextWrite = false;
  }

  /**
   * @param {string} world
   * @param {string} instance
   * @param {string} token
   * @param {number} epoch
   */
  claim(world, instance, token, epoch) {
    const key = world.toUpperCase();
    const current = this.rows.get(key) || {
      revision: 0,
      state: { world_name: key, world_revision: 0 },
      instance: "",
      token: "",
      epoch: 0,
    };
    const sameOwner = current.instance === instance && current.token === token && current.epoch === epoch;
    if (!sameOwner && current.epoch >= epoch) return false;
    this.rows.set(key, { ...current, instance, token, epoch });
    return true;
  }

  /**
   * @param {{world: string, revision: number, state: Record<string, any>, instance: string, token: string, epoch: number}} request
   */
  async save(request) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated database write failure");
    }
    const key = request.world.toUpperCase();
    const current = this.rows.get(key);
    if (!current) return { ok: false, reason: "world_missing", persisted_revision: 0 };
    if (current.instance !== request.instance || current.token !== request.token || current.epoch !== request.epoch) {
      return { ok: false, reason: "world_ownership_fence_rejected", persisted_revision: current.revision };
    }
    if (request.revision < current.revision) {
      return { ok: false, reason: "stale_world_revision", persisted_revision: current.revision };
    }
    const nextState = clone({ ...request.state, world_name: key, world_revision: request.revision });
    if (request.revision === current.revision) {
      const sameState = JSON.stringify(nextState) === JSON.stringify(current.state);
      return {
        ok: sameState,
        reason: sameState ? "" : "world_revision_content_conflict",
        persisted_revision: current.revision,
      };
    }
    this.rows.set(key, { ...current, revision: request.revision, state: nextState });
    return { ok: true, reason: "", persisted_revision: request.revision };
  }

  /** @param {string} world */
  get(world) {
    return this.rows.get(world.toUpperCase());
  }
}

/** @param {string} source @param {string} functionName */
function getMethodSource(source, functionName) {
  const start = source.indexOf(`async ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const next = source.indexOf("\n  async ", start + 8);
  return source.slice(start, next === -1 ? source.length : next);
}

async function main() {
  const ownerA = { instance: "ws-a", token: "process-a:1", epoch: 1 };
  const ownerB = { instance: "ws-b", token: "process-b:2", epoch: 2 };

  // Even without queue ordering, CAS prevents a late revision N from replacing N+1.
  const reverseStore = new RevisionStore();
  assert.equal(reverseStore.claim("REVERSE", ownerA.instance, ownerA.token, ownerA.epoch), true);
  const oldSaveGate = createGate();
  const lateOldSave = (async () => {
    await oldSaveGate.promise;
    return reverseStore.save({
      world: "REVERSE",
      revision: 1,
      state: { foreground: ["old"] },
      ...ownerA,
    });
  })();
  const newSave = await reverseStore.save({
    world: "REVERSE",
    revision: 2,
    state: { foreground: ["new"] },
    ...ownerA,
  });
  oldSaveGate.resolve();
  const oldSave = await lateOldSave;
  assert.equal(newSave.ok, true);
  assert.equal(oldSave.ok, false);
  assert.equal(oldSave.reason, "stale_world_revision");
  assert.equal(reverseStore.get("REVERSE")?.revision, 2);
  assert.deepEqual(reverseStore.get("REVERSE")?.state.foreground, ["new"]);

  // The coordinator additionally prevents same-world save work from overlapping.
  const coordinator = PersistenceHelpers.createWorldPersistenceCoordinator();
  const queueGate = createGate();
  /** @type {string[]} */
  const order = [];
  const queuedOne = coordinator.enqueue("QUEUE", async () => {
    order.push("one:start");
    await queueGate.promise;
    order.push("one:end");
  });
  const queuedTwo = coordinator.enqueue("queue", async () => {
    order.push("two:start");
    order.push("two:end");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["one:start"]);
  queueGate.resolve();
  await Promise.all([queuedOne, queuedTwo]);
  assert.deepEqual(order, ["one:start", "one:end", "two:start", "two:end"]);

  // A second process cannot persist under the first process's fence.
  const processStore = new RevisionStore();
  assert.equal(processStore.claim("DUAL", ownerA.instance, ownerA.token, ownerA.epoch), true);
  assert.equal(processStore.claim("DUAL", "ws-b", "process-b:1", 1), false);
  const foreignSave = await processStore.save({
    world: "DUAL",
    revision: 1,
    state: { marker: "foreign" },
    instance: "ws-b",
    token: "process-b:1",
    epoch: 1,
  });
  assert.equal(foreignSave.reason, "world_ownership_fence_rejected");

  // Ownership transfer fences an old owner's in-flight write.
  const transferStore = new RevisionStore();
  assert.equal(transferStore.claim("TRANSFER", ownerA.instance, ownerA.token, ownerA.epoch), true);
  const transferGate = createGate();
  const staleOwnerWrite = (async () => {
    await transferGate.promise;
    return transferStore.save({
      world: "TRANSFER",
      revision: 1,
      state: { marker: "stale-owner" },
      ...ownerA,
    });
  })();
  assert.equal(transferStore.claim("TRANSFER", ownerB.instance, ownerB.token, ownerB.epoch), true);
  assert.equal((await transferStore.save({
    world: "TRANSFER",
    revision: 2,
    state: { marker: "new-owner" },
    ...ownerB,
  })).ok, true);
  transferGate.resolve();
  assert.equal((await staleOwnerWrite).reason, "world_ownership_fence_rejected");
  assert.equal(transferStore.get("TRANSFER")?.state.marker, "new-owner");

  // Shutdown waits for an accepted mutation's queued save before completing.
  const shutdownStore = new RevisionStore();
  shutdownStore.claim("SHUTDOWN", ownerA.instance, ownerA.token, ownerA.epoch);
  const shutdownCoordinator = PersistenceHelpers.createWorldPersistenceCoordinator();
  const shutdownSave = shutdownCoordinator.enqueue("SHUTDOWN", () => shutdownStore.save({
    world: "SHUTDOWN",
    revision: 1,
    state: { accepted: true },
    ...ownerA,
  }));
  await shutdownCoordinator.waitAll();
  assert.equal((await shutdownSave).ok, true);
  assert.equal(shutdownStore.get("SHUTDOWN")?.revision, 1);

  // Failed durable writes remain visible to shutdown instead of being swallowed.
  const failedWrites = new Set();
  const pendingWrites = new Set();
  PersistenceHelpers.trackPersistenceWrite(
    pendingWrites,
    Promise.resolve(false),
    "world:FAILED:revision:1",
    () => {},
    /** @type {any} */ (failedWrites),
  );
  const failedSummary = await PersistenceHelpers.waitForPersistenceWrites(
    pendingWrites,
    /** @type {any} */ (failedWrites),
  );
  assert.deepEqual(failedSummary, { ok: false, total: 1, failed: 1 });

  // Idle unload/re-entry reads the durable revision, not an empty or stale cache.
  const unloadStore = new RevisionStore();
  unloadStore.claim("IDLE", ownerA.instance, ownerA.token, ownerA.epoch);
  await unloadStore.save({ world: "IDLE", revision: 3, state: { marker: "durable" }, ...ownerA });
  const idleRow = unloadStore.get("IDLE");
  assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
    memory_exists: false,
    memory_revision: 0,
    database_found: true,
    database_revision: idleRow?.revision,
    memory_authoritative: false,
  }), { source: "database", reason: "memory_missing" });

  // Rapid accepted mutations followed by disconnect/reconnect drain in order.
  const rapidStore = new RevisionStore();
  rapidStore.claim("RAPID", ownerA.instance, ownerA.token, ownerA.epoch);
  const rapidCoordinator = PersistenceHelpers.createWorldPersistenceCoordinator();
  /** @type {Promise<any>[]} */
  const rapidSaves = [];
  for (let revision = 1; revision <= 20; revision += 1) {
    rapidSaves.push(rapidCoordinator.enqueue("RAPID", () => rapidStore.save({
      world: "RAPID",
      revision,
      state: { mutation_count: revision },
      ...ownerA,
    })));
  }
  await rapidCoordinator.waitAll();
  assert.equal((await Promise.all(rapidSaves)).every((result) => result.ok), true);
  assert.equal(rapidStore.get("RAPID")?.revision, 20);
  assert.equal(rapidStore.get("RAPID")?.state.mutation_count, 20);

  // Loading reconciles Redis ownership, memory, and PostgreSQL revisions safely.
  assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
    memory_exists: true,
    memory_revision: 12,
    database_found: true,
    database_revision: 10,
    memory_authoritative: true,
  }), { source: "memory", reason: "owned_memory_revision_newer" });
  assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
    memory_exists: true,
    memory_revision: 12,
    database_found: true,
    database_revision: 10,
    memory_authoritative: false,
  }), { source: "database", reason: "uncommitted_memory_rejected" });
  assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
    memory_exists: true,
    memory_revision: 12,
    database_found: true,
    database_revision: 13,
    memory_authoritative: true,
  }), { source: "database", reason: "database_revision_current" });

  // Persistence snapshots are immutable after capture.
  const mutable = { foreground: [{ x: 1, y: 2, block_type: "dirt" }] };
  const captured = PersistenceHelpers.clonePersistenceSnapshot(mutable);
  mutable.foreground[0].block_type = "lava_block";
  assert.equal(captured.foreground[0].block_type, "dirt");

  // Source-level guards ensure the model's invariants are wired into production.
  assert.match(postgresSource, /ADD COLUMN IF NOT EXISTS world_revision bigint NOT NULL DEFAULT 0/);
  assert.match(postgresSource, /SELECT world_id::text AS world_id,[\s\S]*FOR UPDATE/);
  assert.match(postgresSource, /AND world_revision = \$11/);
  assert.match(postgresSource, /AND world_owner_epoch = \$8 AND world_owner_token = \$9 AND world_owner_instance = \$10/);
  assert.match(postgresSource, /world_ownership_required/);
  assert.match(postgresSource, /world_revision_content_conflict/);
  const dropPickupMethod = getMethodSource(postgresSource, "applyDropPickupTransaction");
  assert.match(dropPickupMethod, /expected_drop_before_amount/);
  assert.match(dropPickupMethod, /PIXELMANIA_WORLD_PERSISTENCE_REJECTED/);
  assert.match(dropPickupMethod, /upsertWorldState\(client, worldName, worldState, worldPersistence\)/);
  assert.match(dropPickupMethod, /persisted_revision: normalizeWorldRevision\(persistedWorld\?\.persisted_revision\)/);
  const snapshotMethod = getMethodSource(postgresSource, "saveWorldSnapshot");
  assert.doesNotMatch(snapshotMethod, /upsertWorldState/);
  assert.match(snapshotMethod, /SELECT world_id::text AS world_id,\s*world_state/);

  assert.match(redisSource, /world_route_token/);
  assert.match(redisSource, /world_route_epoch/);
  assert.match(redisSource, /current_token[\s\S]*claimant_id/);
  assert.match(redisSource, /GET', KEYS\[3\]\) == ARGV\[2\]/);

  assert.match(serverSource, /const worldPersistenceCoordinator = PersistenceHelpers\.createWorldPersistenceCoordinator\(\)/);
  assert.match(serverSource, /const worldUnpersistedRevisions = new Map/);
  assert.match(serverSource, /advanceAuthoritativeWorldRevision/);
  assert.match(serverSource, /verifyWorldPersistenceOwnership/);
  assert.match(serverSource, /worldPersistenceCoordinator\.enqueue/);
  assert.match(serverSource, /const memoryAuthoritative = isMemoryWorldRevisionAuthoritative/);
  assert.match(serverSource, /memory_authoritative: memoryAuthoritative/);
  assert.match(serverSource, /expected_drop_before_amount: pickupPlan\.dropAmount/);
  assert.match(serverSource, /world_state: serializedWorld,[\s\S]*world_persistence: ownership/);
  assert.match(serverSource, /restoreWorldMutationRollback\(pickupPlan\.world, worldRollback\)/);
  assert.doesNotMatch(serverSource, /drop_pickup_bulk_world_persist_failed/);
  for (const field of [
    "world_id",
    "server_instance",
    "ownership_token",
    "loaded_revision",
    "mutation_revision",
    "requested_save_revision",
    "persisted_revision",
    "affected_row_count",
    "save_result",
  ]) {
    assert.match(serverSource, new RegExp(`${field}:`), `world persistence logs must include ${field}`);
  }

  assert.match(lifecycleSource, /getOwnedWorldNames/);
  assert.match(lifecycleSource, /refreshOwnedWorldRoutes/);
  assert.match(lifecycleSource, /WORLD_ROUTE_TTL_MS \/ 3/);
  assert.match(lifecycleSource, /await waitForWorldPersistence\(\)/);
  assert.match(lifecycleSource, /PostgreSQL rejected legacy world import/);
  assert.match(worldStateSource, /world_revision:/);

  console.log("[world-revision-persistence] CAS, ownership fencing, load reconciliation, and shutdown durability checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
