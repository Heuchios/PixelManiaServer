"use strict";
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), client = path.resolve(root, "../pixel-mania");
const output = path.resolve(process.env.AUDIT_OUTPUT_DIR || path.join(root, "test-output", `network-checks-${Date.now()}`));
fs.mkdirSync(output, { recursive: true });
const appdata = path.join(output, "appdata"); fs.mkdirSync(appdata, { recursive: true });
const engine = process.env.GODOT_BIN || path.resolve(root, "../Godot/Godot_v4.7.1-stable_win64_console.exe");
const result = [];
function run(name, executable, args, cwd, env) {
  const started = Date.now();
  const execution = spawnSync(executable, args, { cwd, env, windowsHide: true, encoding: "utf8", timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
  const log = (execution.stdout || "") + (execution.stderr || "");
  fs.writeFileSync(path.join(output, name + ".log"), log);
  const ok = execution.status === 0 && !/SCRIPT ERROR|Assertion failed|Parse Error|failed assertions: [1-9]/.test(log);
  result.push({name,ok,exit:execution.status,duration_ms:Date.now()-started,error:execution.error?.message});
  console.log(`${name}: ${ok ? "PASS" : "FAIL"}`);
}
for (const name of ["network_reliability_test", "connection_health_test", "network_conditions_matrix_test", "websocket_snapshot_buffer_test",
  "network_batch_protocol_test", "multiplayer_interaction_regression_test", "corner_contact_test", "block_placement_reconciliation_test",
  "break_sync_test", "block_break_renderer_test", "display_direct_interaction_test", "seed_prediction_test", "runtime_performance_probe",
  "world_loading_operation_id_test", "world_join_spawn_safety_test", "world_rejoin_visual_reconciliation_test", "remembered_login_test"]) {
  const entry = fs.existsSync(path.join(client, "tests", name + ".tscn")) ? [`res://tests/${name}.tscn`] : ["--script", `tests/${name}.gd`];
  run(name, engine, ["--headless", "--path", client, "--quit-after", "2500", ...entry, "--",
    "--pixelmania-ws-url", "ws://127.0.0.1:1", "--pixelmania-api-base", "http://127.0.0.1:1"], client, {...process.env,APPDATA:appdata});
}
for (const name of ["check_movement_rollback_regression", "check_server_socket_delivery_helpers_build", "check_server_phase11d_standard_movement_build",
  "check_movement_columns", "check_server_message_router_helpers_build", "check_server_validation_wiring", "check_anti_dupe_locking_wiring",
  "check_account_session_security_wiring", "check_bot_rate_limit_wiring", "check_scale_readiness_wiring", "check_join_spawn_safety",
  "check_block_placement_consistency", "check_runtime_spike_profile"]) {
  run(name, process.execPath, [path.join(__dirname, name + ".js")], root, process.env);
}
fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(result,null,2));
process.exitCode = result.every(row=>row.ok) ? 0 : 1;
