#!/usr/bin/env node
// @ts-check
"use strict";

/**
 * Failed-transaction-ledger audit coverage.
 *
 * A rejected action only reaches the transaction ledger through one path:
 *
 *   sendActionRejected(socket, action, ...)   <- 278 literal call sites in server.js
 *     -> queueFailedTransactionLedger(socket, action, ...)   <- its only caller
 *          -> returns early unless shouldRecordFailedTransactionLedgerAction(action)
 *          -> otherwise recordTransactionLedgerEvent({ status: "failed", ... })
 *
 * So the set of action strings that filter accepts IS the set of rejections that get
 * audited. check_transaction_ledger_wiring.js asserts "failed/rejected valuable actions
 * write failed ledger rows" by grepping server.js for the words queueFailedTransactionLedger
 * and 'status: "failed"'. Both are present, so it passes -- while telling you nothing about
 * WHICH actions actually make it through the filter.
 *
 * This check answers that instead of assuming it: it extracts every action string from the
 * real call sites, runs the REAL filter (the actual module, with the actual cleanAccountName
 * and the actual packet contracts), and pins the verdict for each one. The filter consults
 * exactly two things from its config -- cleanAccountName and packetContracts -- and both are
 * the real modules here, so the verdicts are the ones production gets.
 *
 * WHAT IT FOUND, AND WHY THIS IS A LEDGER RATHER THAN A FIX
 * Eight of the thirteen action strings are silently dropped. Two of them are handlers that
 * move inventory, which is the filter's own criterion for mattering:
 *
 *   oil_refinery_request      22 rejection sites  handleOilRefineryRequest
 *   battery_charger_request   16 rejection sites  handleBatteryChargerRequest
 *
 * Both handlers call commitPlayerInventoryState, the path that writes
 * applyInventoryDeltaTransaction. So on those two paths the ledger records the successful
 * item moves and none of the rejected attempts -- and an attempt pattern is usually the part
 * that tells you someone was probing for a duplication bug.
 *
 * This file does NOT change that. Auditing them adds ledger writes on a hot rejection path,
 * which is a production write-volume decision, and the exclusion may well be deliberate for
 * exactly that reason. What this file does is make the gap impossible to hold accidentally:
 * the sets are pinned exactly, in both directions, so neither a new unaudited valuable action
 * nor a silent change to the filter can pass unnoticed.
 *
 * The six other dropped actions are recorded as movesInventory: "unverified" -- I traced the
 * two above and did not trace those, and saying so is more useful than guessing.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PacketContracts = require("../server_packet_contracts.js");
const IdentityHelpers = require("../server_identity_helpers.js");
const ServerMessageRouterHelpersModule = require("../server_message_router_helpers.js");

/**
 * Rejection actions that DO write a failed ledger row today.
 *
 * @type {string[]}
 */
const AUDITED = [
  "inventory_transaction_request",
  "world_block_update",
  "world_interaction_update",
  "world_item_drop_pickup",
  "world_seed_update",
];

/**
 * The filter's allowlist names this action, but no sendActionRejected call site passes it as
 * a literal -- so the allowlist entry is either reached only through one of the dynamic
 * sites, or it is dead. Recorded rather than removed: deleting an allowlist entry that turns
 * out to be reachable would silently stop auditing a valuable action.
 *
 * @type {string[]}
 */
const AUDITED_WITHOUT_LITERAL_CALL_SITE = ["world_item_drop_update"];

/**
 * Rejection actions that write NOTHING today. `movesInventory` is what I actually traced,
 * not what I assume: "yes" means the handler was read and calls commitPlayerInventoryState.
 *
 * @type {Array<{ action: string, handler: string, movesInventory: "yes" | "no" | "unverified" }>}
 */
const KNOWN_UNAUDITED = [
  { action: "oil_refinery_request", handler: "handleOilRefineryRequest", movesInventory: "yes" },
  { action: "battery_charger_request", handler: "handleBatteryChargerRequest", movesInventory: "yes" },
  { action: "electrical_layer_update", handler: "(not traced)", movesInventory: "unverified" },
  { action: "world_lock_state", handler: "(not traced)", movesInventory: "unverified" },
  { action: "area_lock_state", handler: "(not traced)", movesInventory: "unverified" },
  { action: "door_enter", handler: "(not traced)", movesInventory: "unverified" },
  { action: "player_punch", handler: "(not traced)", movesInventory: "unverified" },
  { action: "pull_player_request", handler: "(not traced)", movesInventory: "unverified" },
];

/**
 * Literal fallbacks that appear inside a dynamic action expression, e.g. `type || "request"`.
 * They are reachable action strings even though the call site is not a plain literal.
 *
 * @type {string[]}
 */
const DYNAMIC_FALLBACKS = ["request"];

/**
 * A dynamic action string cannot be resolved by reading the source, so those sites are
 * counted rather than evaluated. Pinning the count means a NEW dynamic site has to be
 * looked at by a human instead of quietly widening the blind spot.
 */
const EXPECTED_LITERAL_SITES = 278;
// Re-pinned from 10 -> 9 after tracing every current dynamic call site (2026-08-09): all
// nine pass an `action`-shaped variable through unchanged --
// `cleanRouteType || "request"` / `type || "request"` (both already covered by
// DYNAMIC_FALLBACKS) and seven generic `sendActionRejected(socket, action, ...)`
// re-dispatch sites. None is a new unaudited literal action string; the count only
// changed because there is genuinely one fewer dynamic site in server.js than there
// used to be, not because a blind spot was introduced.
const EXPECTED_DYNAMIC_SITES = 9;

let failures = 0;
let checks = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 * @returns {void}
 */
function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAIL ${name}`);
    console.error(`       ${message}`);
  }
}

/**
 * @returns {string}
 */
function readServerSource() {
  const candidates = [
    path.resolve(__dirname, "..", "server.js"),
    path.resolve(process.cwd(), "server.js"),
    path.resolve(process.cwd(), "backend", "server.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
  }
  throw new Error(`Could not find server.js. Checked: ${candidates.join(", ")}`);
}

/**
 * Every action argument at a sendActionRejected call site, split into the literals (whose
 * audit verdict can be decided here) and the dynamic ones (which can only be counted).
 *
 * @param {string} source
 * @returns {{ literals: Map<string, number>, dynamicSites: number }}
 */
function collectRejectionActions(source) {
  /** @type {Map<string, number>} */
  const literals = new Map();
  let dynamicSites = 0;
  const sourceLines = source.split("\n");

  const pattern = /sendActionRejected\(\s*([^,]+),\s*(?:"([^"]*)"|([^,)]+))/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const lineIndex = source.slice(0, match.index).split("\n").length - 1;
    // The declaration itself is not a call site.
    if (sourceLines[lineIndex].trimStart().startsWith("function sendActionRejected")) continue;

    if (typeof match[2] === "string") {
      literals.set(match[2], (literals.get(match[2]) || 0) + 1);
    } else {
      dynamicSites += 1;
    }
  }
  return { literals, dynamicSites };
}

/**
 * The real filter, wired to the real dependencies it consults.
 *
 * @returns {(action: string) => boolean}
 */
function buildRealFilter() {
  const helpers = ServerMessageRouterHelpersModule.createServerMessageRouterHelpers({
    packetContracts: PacketContracts,
    cleanAccountName: IdentityHelpers.cleanAccountName,
    // Not consulted by shouldRecordFailedTransactionLedgerAction; present because the
    // factory builds its other helpers eagerly.
    normalizePacketTypeName: (/** @type {unknown} */ value) => String(value || ""),
    defaultMessageRateLimit: { limit: 60, windowMs: 1000 },
  });
  assert.equal(
    typeof helpers.shouldRecordFailedTransactionLedgerAction,
    "function",
    "the real helpers module no longer exposes shouldRecordFailedTransactionLedgerAction",
  );
  return helpers.shouldRecordFailedTransactionLedgerAction;
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function sorted(values) {
  return [...values].sort();
}

function run() {
  console.log("failed transaction-ledger audit coverage");

  const source = readServerSource();
  const { literals, dynamicSites } = collectRejectionActions(source);
  const shouldAudit = buildRealFilter();

  const actions = sorted([...literals.keys()]);
  const audited = actions.filter((action) => shouldAudit(action));
  const dropped = actions.filter((action) => !shouldAudit(action));

  check("every rejection action in the ledger is still a real call site", () => {
    const known = sorted([...AUDITED, ...KNOWN_UNAUDITED.map((entry) => entry.action)]);
    assert.deepEqual(
      actions,
      known,
      `server.js rejection actions changed.\n       call sites: ${actions.join(", ")}\n       ledger:     ${known.join(", ")}\n       Add or remove the entry, and decide whether the new one needs auditing.`,
    );
  });

  check("the audited set is exactly what the ledger claims", () => {
    assert.deepEqual(
      audited,
      sorted(AUDITED),
      `the filter's verdicts moved.\n       audited now: ${audited.join(", ")}\n       ledger says: ${sorted(AUDITED).join(", ")}`,
    );
  });

  check("the unaudited set is exactly what the ledger claims", () => {
    assert.deepEqual(
      dropped,
      sorted(KNOWN_UNAUDITED.map((entry) => entry.action)),
      `the set of silently unaudited rejections moved.\n       dropped now: ${dropped.join(", ")}\n       ledger says: ${sorted(KNOWN_UNAUDITED.map((e) => e.action)).join(", ")}`,
    );
  });

  check("no NEW inventory-moving rejection path is unaudited", () => {
    // The two traced ones are the known debt. A third would be a new gap, and the ledger
    // entry has to be filled in deliberately rather than defaulted.
    const moving = KNOWN_UNAUDITED.filter((entry) => entry.movesInventory === "yes").map((entry) => entry.action);
    assert.deepEqual(
      sorted(moving),
      sorted(["battery_charger_request", "oil_refinery_request"]),
      `the set of unaudited inventory-moving rejections changed: ${sorted(moving).join(", ")}`,
    );
  });

  check("allowlist entries with no literal call site still behave as recorded", () => {
    for (const action of AUDITED_WITHOUT_LITERAL_CALL_SITE) {
      assert.equal(shouldAudit(action), true, `"${action}" is no longer audited by the filter`);
      assert.equal(
        literals.has(action),
        false,
        `"${action}" now HAS a literal rejection call site -- move it into AUDITED, which is where actions with call sites belong`,
      );
    }
  });

  check("dynamic-fallback action strings are evaluated too", () => {
    // `type || "request"` is reachable, so its verdict matters even though the call site
    // is not a plain literal.
    for (const fallback of DYNAMIC_FALLBACKS) {
      assert.equal(
        shouldAudit(fallback),
        false,
        `the fallback action "${fallback}" is now audited; that is a behaviour change worth confirming was intended`,
      );
    }
  });

  check("call-site counts are unchanged", () => {
    const literalSites = [...literals.values()].reduce((total, count) => total + count, 0);
    assert.equal(literalSites, EXPECTED_LITERAL_SITES, `literal sendActionRejected sites: ${literalSites}`);
    assert.equal(
      dynamicSites,
      EXPECTED_DYNAMIC_SITES,
      `dynamic sendActionRejected sites: ${dynamicSites}. A new one is a new blind spot -- resolve what action string it can carry, then update the count.`,
    );
  });

  check("the filter is still the thing that decides", () => {
    // Structural, and labelled as such: this guards THIS FILE'S premise rather than
    // asserting behaviour. If rejections stop flowing through the filter, every assertion
    // above becomes true and meaningless at the same time.
    assert.match(
      source,
      /function queueFailedTransactionLedger\([^)]*\)\s*\{[\s\S]{0,400}?shouldRecordFailedTransactionLedgerAction\(action\)/,
      "queueFailedTransactionLedger no longer consults shouldRecordFailedTransactionLedgerAction early -- the coverage sets above no longer describe what gets audited",
    );
    const queueCallSites = [...source.matchAll(/queueFailedTransactionLedger\(/g)].length;
    assert.equal(
      queueCallSites,
      2,
      `expected queueFailedTransactionLedger to have exactly one caller plus its declaration, found ${queueCallSites} occurrences. A second caller may bypass sendActionRejected.`,
    );
  });

  console.log("");
  console.log(`  audited:   ${audited.join(", ")}`);
  console.log(`  unaudited: ${dropped.join(", ")}`);
  const debt = KNOWN_UNAUDITED.filter((entry) => entry.movesInventory === "yes");
  for (const entry of debt) {
    console.log(`  KNOWN GAP: ${entry.action} (${entry.handler}) moves inventory and is not audited`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} of ${checks} failed-ledger audit coverage checks FAILED.`);
    process.exit(1);
  }
  console.log(`All ${checks} failed-ledger audit coverage checks passed.`);
}

run();
