#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const clientRoot = path.resolve(repoRoot, "..", "pixel-mania");
const serverSource = fs.readFileSync(path.join(repoRoot, "src", "server.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase8_world_action_routes.ts"), "utf8");
const worldHelperSource = fs.readFileSync(path.join(repoRoot, "src", "server_world_state_helpers.ts"), "utf8");
const dispatcherSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase7_dispatcher.ts"), "utf8");
const blockManagerSource = fs.readFileSync(path.join(clientRoot, "Scripts", "block_manager.gd"), "utf8");
const syncManagerSource = fs.readFileSync(path.join(clientRoot, "Scripts", "world_state_sync_manager.gd"), "utf8");
const networkManagerSource = fs.readFileSync(path.join(clientRoot, "Scripts", "network_manager.gd"), "utf8");

/**
 * @typedef {{
 *   blockType: string,
 *   revision: number,
 *   placementRequestId: string,
 * }} PlacementCell
 */

/**
 * @param {string} source
 * @param {string} name
 * @param {string} [nextName]
 * @returns {string}
 */
function functionBody(source, name, nextName = "") {
  const start = source.indexOf(name);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName === "" ? source.length : source.indexOf(nextName, start + name.length);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

const duplicateBody = functionBody(serverSource, "function sendDuplicateRequestNotice", "async function enforceMessageIdempotency");
assert.match(duplicateBody, /type === "world_block_update"[\s\S]*sendWorldBlockReconciliation/);
assert.doesNotMatch(duplicateBody.match(/if \(type === "world_block_update"\) \{[\s\S]*?\n  \}/)?.[0] || "", /sendActionRejected/);
assert.match(serverSource, /activeWorldBlockIdempotencyKeys/);
assert.match(serverSource, /authoritative_pending: activeWorldBlockIdempotencyKeys\.has/);
assert.match(dispatcherSource, /"world_block_reconcile_request"/);

const reconcileBody = functionBody(serverSource, "function buildWorldBlockReconciliationPayload", "function sendWorldBlockReconciliation");
assert.match(reconcileBody, /buildServerGeneratedWorldMaps/);
assert.match(reconcileBody, /buildEffectiveForegroundMap/);
assert.match(reconcileBody, /buildEffectiveBackgroundMap/);
assert.match(reconcileBody, /authoritative_placement_request_id/);
assert.match(reconcileBody, /cell_revision/);

const applyMutationBody = functionBody(serverSource, "function applyBlockUpdateToWorldState", "function applyElectricalLayerUpdateToWorldState");
assert.match(applyMutationBody, /nextWorldBlockRevision/);
assert.match(applyMutationBody, /placement_request_id/);
assert.match(applyMutationBody, /mutation_request_id/);
assert.match(worldHelperSource, /world_state_version: 2/);
assert.match(worldHelperSource, /block_revision/);
assert.match(worldHelperSource, /placement_request_id/);

const previousStateIndex = routeSource.indexOf("const previousWorldState = validation.rollbackWorldState || serializeWorldState(worldName)");
const applyIndex = routeSource.indexOf("applyBlockUpdateToWorldState(worldName, update)", previousStateIndex);
const serializeIndex = routeSource.indexOf("const serializedWorld = serializeWorldState(worldName)", applyIndex);
const inventoryCommitIndex = routeSource.indexOf("const inventoryCommit = await commitPlayerInventoryState", serializeIndex);
const rollbackIndex = routeSource.indexOf("worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState))", inventoryCommitIndex);
const successSendIndex = routeSource.indexOf("sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update)", inventoryCommitIndex);
assert.ok(previousStateIndex >= 0 && previousStateIndex < applyIndex, "World rollback state must be captured before mutation.");
assert.ok(applyIndex < serializeIndex && serializeIndex < inventoryCommitIndex, "Tile and inventory must be staged into one authoritative commit.");
assert.ok(inventoryCommitIndex < rollbackIndex && rollbackIndex < successSendIndex, "Commit failure must restore world state before any success broadcast.");
assert.match(routeSource.slice(inventoryCommitIndex, successSendIndex), /world_state: serializedWorld/);

const timeoutBody = functionBody(blockManagerSource, "func cleanup_expired_authoritative_place_predictions", "func handle_authoritative_place_reconcile");
assert.match(timeoutBody, /request_authoritative_place_reconciliation/);
assert.doesNotMatch(timeoutBody, /rollback_predicted_authoritative_place/);
const rejectionBody = functionBody(blockManagerSource, "func handle_rejected_block_update", "func clear_background_blocks");
assert.match(rejectionBody, /get_predicted_authoritative_place_request_key\(data, false\)/);
assert.match(rejectionBody, /rollback_predicted_authoritative_place\(data, false\)/);
assert.doesNotMatch(rejectionBody, /rollback_predicted_authoritative_place\(data, true\)/);
const clearBackgroundBody = functionBody(blockManagerSource, "func clear_background_blocks", "func clear_background_crack_visual_for_data");
assert.doesNotMatch(clearBackgroundBody, /predicted_authoritative_place_requests\.clear/);

for (const layer of ["background", "foreground"]) {
  const requestMarker = `var ${layer}_request_id := make_authoritative_place_request_id`;
  const predictionMarker = `${layer}_prediction_applied = apply_predicted_authoritative_place`;
  const sendMarker = `send_network_block_update("place", "${layer}"`;
  const requestIndex = blockManagerSource.indexOf(requestMarker);
  const predictionIndex = blockManagerSource.indexOf(predictionMarker, requestIndex);
  const sendIndex = blockManagerSource.indexOf(sendMarker, predictionIndex);
  assert.ok(requestIndex >= 0 && requestIndex < predictionIndex && predictionIndex < sendIndex, `${layer} prediction must be registered before send.`);
}

assert.match(syncManagerSource, /func _should_ignore_stale_block_update/);
assert.match(syncManagerSource, /incoming_block_revision < latest_block_revision/);
assert.match(syncManagerSource, /func apply_network_block_reconcile/);
assert.match(syncManagerSource, /reconcile_authoritative_place_predictions_after_snapshot/);
assert.equal((networkManagerSource.match(/"world_block_reconcile":/g) || []).length, 2, "Direct and batched packets must both route reconciliation.");

class PlacementAuthorityModel {
  constructor() {
    this.revision = 0;
    this.inventory = 3;
    /** @type {Map<string, PlacementCell>} */
    this.cells = new Map();
    /** @type {Set<string>} */
    this.processed = new Set();
  }

  /**
   * @param {string} requestId
   * @param {string} key
   * @param {boolean} [commit]
   * @returns {Record<string, unknown>}
   */
  place(requestId, key, commit = true) {
    if (this.processed.has(requestId)) return this.reconcile(requestId, key);
    this.processed.add(requestId);
    const before = { revision: this.revision, inventory: this.inventory, cells: new Map(this.cells) };
    if (this.inventory <= 0 || this.cells.has(key)) return { ok: false, requestId };
    this.revision += 1;
    this.inventory -= 1;
    this.cells.set(key, { blockType: "dirt", revision: this.revision, placementRequestId: requestId });
    if (!commit) {
      this.revision = before.revision;
      this.inventory = before.inventory;
      this.cells = before.cells;
      return { ok: false, requestId };
    }
    return { ok: true, requestId, revision: this.revision };
  }

  /**
   * @param {string} requestId
   * @param {string} key
   * @returns {Record<string, unknown>}
   */
  reconcile(requestId, key) {
    const block = this.cells.get(key) || null;
    return {
      duplicate: true,
      authoritativePresent: Boolean(block),
      authoritativeMatchesRequest: block?.placementRequestId === requestId,
      revision: block?.revision || this.revision,
    };
  }
}

const model = new PlacementAuthorityModel();
assert.equal(model.place("place-a", "1,1").ok, true);
assert.equal(model.inventory, 2, "A successful placement spends exactly one item.");
assert.equal(model.place("place-a", "1,1").authoritativeMatchesRequest, true);
assert.equal(model.inventory, 2, "A duplicate request must not spend inventory twice.");
assert.equal(model.place("place-b", "2,1").ok, true);
assert.equal(model.place("place-c", "3,1").ok, true);
assert.deepEqual(Array.from(model.cells.values()).map((entry) => entry.placementRequestId), ["place-a", "place-b", "place-c"]);

const rollbackModel = new PlacementAuthorityModel();
assert.equal(rollbackModel.place("place-failed", "4,1", false).ok, false);
assert.equal(rollbackModel.inventory, 3);
assert.equal(rollbackModel.cells.has("4,1"), false);
assert.equal(rollbackModel.reconcile("place-failed", "4,1").authoritativePresent, false);

const saved = JSON.parse(JSON.stringify({ revision: model.revision, cells: Array.from(model.cells.entries()) }));
assert.equal(saved.revision, 3);
assert.equal(saved.cells[0][1].placementRequestId, "place-a", "Reconnect state must preserve placement identity.");

console.log("[block-placement-consistency] success");
