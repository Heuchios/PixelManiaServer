"use strict";
// TEST ONLY: invoked explicitly via --require by the disposable loopback harness.
// No production code reads these settings or installs this hook.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
assert.equal(process.env.NODE_ENV, 'development');
assert.equal(process.env.HOST, '127.0.0.1');
assert.equal(process.env.POSTGRES_ENABLED, 'false');
assert.equal(process.env.REDIS_ENABLED, 'false');
assert.equal(path.resolve(process.cwd()), path.resolve(process.env.PERF_OUTPUT_DIR));
const target = fs.realpathSync(path.join(__dirname, '..', 'server.js'));
const delayMs = Math.min(1000, Math.max(0, Number(process.env.PERF_TEST_COMMIT_DELAY_MS) || 0));
const compile = Module.prototype._compile;
Module.prototype._compile = function(source, filename) {
  if (fs.realpathSync(filename) === target) {
    if (process.env.PERF_DETERMINISTIC_DROPS === '1') {
      const dropMarker = 'function getBreakDropsForBlock(blockType, layer) {';
      assert(source.includes(dropMarker), 'Drop fixture must match actual server entry');
      source = source.replace(dropMarker, dropMarker + `
        if (blockType === 'dirt') return [{item_id: 'dirt', item_category: 'block', amount: 1}];
      `);
    }
    if (delayMs > 0) {
    const marker = 'async function commitPlayerInventoryState(socket, player, username, beforeState, afterState, options = {}) {';
    assert(source.includes(marker), 'Commit fixture must match the actual server entry');
    source = source.replace(marker, marker + `
      const faultStarted = performance.now();
      await new Promise(resolve => setTimeout(resolve, ${delayMs}));
      runtimeProfiler.observe('test_commit_wait_ms', performance.now() - faultStarted, {
        player_id: player?.id, world: options.world || player?.world, request_id: options.request_id,
      });
    `);
    }
  }
  return compile.call(this, source, filename);
};
