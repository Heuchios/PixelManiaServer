"use strict";

const fs = require("fs");
const path = require("path");

const backendRootCandidates = [
  process.cwd(),
  path.resolve(__dirname, ".."),
  path.resolve(process.cwd(), "backend"),
];

function readFirst(candidates, required = true) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  if (!required) return "";
  throw new Error(`Could not find required file. Checked: ${candidates.join(", ")}`);
}

function fromBackend(filename) {
  return backendRootCandidates.map((root) => path.join(root, filename));
}

function fromRepoRoot(filename) {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(__dirname, "..", ".."),
  ];
  const expandedRoots = [];
  for (const root of roots) {
    expandedRoots.push(root);
    expandedRoots.push(path.join(root, "pixel-mania"));
  }
  return [...new Set(expandedRoots)].map((root) => path.join(root, filename));
}

const files = {
  server: readFirst(fromBackend("server.js")),
  phase8PlayerSessionRoutes: readFirst(fromBackend("server_phase8_player_session_routes.js")),
  phase8WorldActionRoutes: readFirst(fromBackend("server_phase8_world_action_routes.js"), false),
  phase8FinalRoutes: readFirst(fromBackend("server_phase8_final_routes.js"), false),
  phase11aRuntime: readFirst(fromBackend("server_phase11a_runtime.js"), false),
  socketDeliveryHelpers: readFirst(fromBackend("server_socket_delivery_helpers.js")),
  inventoryTransactionHelpers: readFirst(fromBackend("server_inventory_transaction_helpers.js")),
  redisStore: readFirst(fromBackend("redis_store.js")),
  ecosystem: readFirst(fromBackend("ecosystem.config.js")),
  envExample: readFirst(fromBackend(".env.example"), false),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  loadTest: readFirst(fromBackend("scripts/staged_ws_load_test.js"), false),
  loadTokenProvisioner: readFirst(fromBackend("scripts/provision_load_tokens.js"), false),
  multiInstanceWorldCapSmoke: readFirst(fromBackend("scripts/multi_instance_world_cap_smoke.js"), false),
  multiplayerScalingSmoke: readFirst(fromBackend("scripts/multiplayer_scaling_smoke.js"), false),
  world: readFirst(fromRepoRoot("Scripts/world.gd"), false),
  networkManager: readFirst(fromRepoRoot("Scripts/network_manager.gd"), false),
  blockManager: readFirst(fromRepoRoot("Scripts/block_manager.gd"), false),
  tilemapRenderer: readFirst(fromRepoRoot("Scripts/world_tilemap_renderer.gd"), false),
  developerPanel: readFirst(fromRepoRoot("Scripts/developer_panel_ui.gd"), false),
  projectGodot: readFirst(fromRepoRoot("project.godot"), false),
  scaleReadinessDoc: readFirst(fromRepoRoot("docs/scale_readiness_10k.md"), false),
};

const serverAndSessionRouteSources = [
  files.server,
  files.phase8PlayerSessionRoutes,
  files.phase8WorldActionRoutes,
  files.phase8FinalRoutes,
].filter(Boolean).join("\n");
const runtimeHealthSources = [files.server, files.phase11aRuntime].filter(Boolean).join("\n");

const checks = [
  {
    name: "WebSocket payload and send backpressure limits are enforced",
    ok: files.server.includes("const MAX_PACKET_BYTES = 64 * 1024")
      && files.server.includes("maxPayload: MAX_PACKET_BYTES")
      && files.server.includes("SERVER_WEBSOCKET_MAX_BUFFERED_AMOUNT")
      && (files.server.includes("[socket_backpressure_skip]")
        || files.socketDeliveryHelpers.includes("[socket_backpressure_skip]")),
  },
  {
    name: "player movement uses interest management and batched delivery",
    ok: files.server.includes("PLAYER_INTEREST_MANAGEMENT_ENABLED")
      && files.server.includes("PLAYER_POSITION_BATCHING_ENABLED")
      && files.server.includes("queuePlayerPositionBroadcast")
      && files.server.includes("flushQueuedPlayerPositionBroadcasts")
      && files.server.includes("syncPlayerInterestForReceiver")
      && (serverAndSessionRouteSources.includes("getPlayersInWorld(player.world, playerId, player)")
        || serverAndSessionRouteSources.includes("getPlayersInWorld(player.world, context.playerId, player)"))
      && serverAndSessionRouteSources.includes("getPlayersInWorld(targetWorld, player.id, player)"),
  },
  {
    name: "world/drop updates use batching and drop interest filtering",
    ok: files.server.includes("WORLD_UPDATE_BATCHING_ENABLED")
      && files.server.includes("DROP_INTEREST_MANAGEMENT_ENABLED")
      && files.server.includes("queueWorldUpdateBroadcast")
      && files.server.includes("deliverDropWorldUpdateToInterestedPlayers")
      && files.server.includes("syncDropInterestForReceiver")
      && files.server.includes("getDropsForWorldStateMessage")
      && files.server.includes("receiver_player: player")
      && files.server.includes("clearDropInterestStateForReceiver(receiver.id)")
      && files.server.includes("shouldReceiverSeeDrop(receiver, drop, clean)"),
  },
  {
    name: "high-frequency pickup response uses inventory deltas instead of full player state",
    ok: (serverAndSessionRouteSources.includes("inventory_delta: pickupInventoryDelta")
      || serverAndSessionRouteSources.includes("inventory_deltas: pickupInventoryDelta"))
      && (serverAndSessionRouteSources.includes("delete response.player_data")
      || files.inventoryTransactionHelpers.includes("delete response.player_data"))
      && files.world.includes("func apply_network_inventory_delta")
      && files.networkManager.includes("apply_inventory_delta_payload_if_present"),
  },
  {
    name: "client world rendering defaults to TileMapLayer runtime for massive grids",
    ok: files.blockManager.includes("DEFAULT_FOREGROUND_TILEMAP_ONLY_ENABLED := true")
      && files.blockManager.includes("DEFAULT_BACKGROUND_TILEMAP_ONLY_ENABLED := true")
      && files.blockManager.includes("DEFAULT_FOREGROUND_TILEMAP_COLLISION_ENABLED := true")
      && files.blockManager.includes("DEFAULT_FOREGROUND_TILEMAP_COLLISION_REPLACES_NODES_ENABLED := true")
      && files.tilemapRenderer.includes("ForegroundTileMapLayer")
      && files.tilemapRenderer.includes("BackgroundTileMapLayer")
      && files.developerPanel.includes("TileMap runtime:"),
  },
  {
    name: "production config keeps scale-critical network features enabled by default",
    ok: files.ecosystem.includes('PLAYER_POSITION_BATCHING_ENABLED: env("PLAYER_POSITION_BATCHING_ENABLED", "true")')
      && files.ecosystem.includes('PLAYER_INTEREST_MANAGEMENT_ENABLED: env("PLAYER_INTEREST_MANAGEMENT_ENABLED", "true")')
      && files.ecosystem.includes('PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED: env("PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED", "true")')
      && files.ecosystem.includes('WORLD_UPDATE_BATCHING_ENABLED: env("WORLD_UPDATE_BATCHING_ENABLED", "true")')
      && files.ecosystem.includes('DROP_INTEREST_MANAGEMENT_ENABLED: env("DROP_INTEREST_MANAGEMENT_ENABLED", "true")'),
  },
  {
    name: "world admission enforces configurable 50-player capacity",
    ok: files.server.includes("const MAX_PLAYERS_PER_WORLD")
      && files.server.includes("const pendingWorldAdmissions = new Map()")
      && /reserveWorldAdmission\(player,\s*newWorld(?:,\s*"join_world")?\)/.test(serverAndSessionRouteSources)
      && /rejectWorldCapacity\(socket,\s*"join_world",\s*newWorld,\s*(?:playerId|context\.playerId)/.test(serverAndSessionRouteSources)
      && serverAndSessionRouteSources.includes("current_players")
      && /reserveWorldAdmission\(player,\s*targetWorld(?:,\s*"door_enter")?\)/.test(serverAndSessionRouteSources)
      && serverAndSessionRouteSources.includes('rejectWorldCapacity(socket, "door_enter", targetWorld, player.id, { current_players: admission.current_players })')
      && serverAndSessionRouteSources.includes("releaseWorldAdmissionReservation(admission)")
      && serverAndSessionRouteSources.includes('reason: "world_full"')
      && files.ecosystem.includes('MAX_PLAYERS_PER_WORLD: env("MAX_PLAYERS_PER_WORLD", "50")')
      && files.envExample.includes("MAX_PLAYERS_PER_WORLD=50"),
  },
  {
    name: "multi-node world admission uses Redis occupancy reservations",
    ok: files.server.includes("const WORLD_ADMISSION_TTL_MS")
      && files.server.includes("redisStore.reserveWorldAdmission(clean, playerId, MAX_PLAYERS_PER_WORLD, WORLD_ADMISSION_TTL_MS)")
      && serverAndSessionRouteSources.includes("commitWorldAdmissionReservation(admission, player, oldWorld)")
      && files.server.includes("refreshPlayerWorldAdmission(player)")
      && serverAndSessionRouteSources.includes("releasePlayerWorldAdmission(player, currentWorld)")
      && runtimeHealthSources.includes("redis_world_admission: true")
      && files.redisStore.includes("async reserveWorldAdmission(worldName, playerId, maxPlayers, ttlMs)")
      && files.redisStore.includes("redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms)")
      && files.redisStore.includes("async releaseWorldAdmission(worldName, playerId)")
      && files.ecosystem.includes('WORLD_ADMISSION_TTL_MS: env("WORLD_ADMISSION_TTL_MS", "45000")')
      && files.envExample.includes("WORLD_ADMISSION_TTL_MS=45000"),
  },
  {
    name: "multi-node world routing has Redis-backed instance ownership",
    ok: files.server.includes("const SERVER_INSTANCE_ID")
      && files.server.includes("const SERVER_INSTANCE_WS_URL")
      && files.server.includes("const WORLD_ROUTE_TTL_MS")
      && files.server.includes("const WORLD_ROUTE_ENFORCEMENT_ENABLED")
      && files.server.includes("const ownedWorldRoutes = new Set()")
      && files.server.includes("async function ensureWorldRouteForAction")
      && serverAndSessionRouteSources.includes("ensureWorldRouteForAction(socket, player, newWorld, \"join_world\")")
      && serverAndSessionRouteSources.includes("ensureWorldRouteForAction(socket, player, targetWorld, \"door_enter\")")
      && files.server.includes("redisStore.claimWorldRoute(clean, SERVER_INSTANCE_ID, SERVER_INSTANCE_WS_URL, WORLD_ROUTE_TTL_MS)")
      && files.server.includes("releaseOwnedWorldRouteIfEmpty")
      && runtimeHealthSources.includes("world_route_ownership: true")
      && runtimeHealthSources.includes("world_route: getWorldRouteStatsSnapshot()")
      && files.networkManager.includes("NETWORK_WORLD_ROUTE_WS_URLS_SETTING")
      && files.networkManager.includes("func handle_world_route_redirect")
      && files.networkManager.includes('"world_route_redirect"')
      && files.networkManager.includes("connect_to_server(true)")
      && files.networkManager.includes("MAX_WORLD_ROUTE_REDIRECT_ATTEMPTS")
      && files.projectGodot.includes("network/world_route_ws_urls=PackedStringArray")
      && files.projectGodot.includes("wss://api.pixelmaniagame.com/ws-a")
      && files.projectGodot.includes("wss://api.pixelmaniagame.com/ws-b")
      && files.redisStore.includes("async claimWorldRoute(worldName, instanceId, wsUrl, ttlMs)")
      && files.redisStore.includes("world_route_owner")
      && files.redisStore.includes("world_route_target")
      && files.redisStore.includes("async releaseWorldRoute(worldName, instanceId)")
      && files.ecosystem.includes('SERVER_INSTANCE_ID: env("SERVER_INSTANCE_ID")')
      && files.ecosystem.includes('SERVER_INSTANCE_WS_URL: env("SERVER_INSTANCE_WS_URL"')
      && files.ecosystem.includes('WORLD_ROUTE_TTL_MS: env("WORLD_ROUTE_TTL_MS", "45000")')
      && files.ecosystem.includes('WORLD_ROUTE_ENFORCEMENT_ENABLED: env("WORLD_ROUTE_ENFORCEMENT_ENABLED", "false")')
      && files.envExample.includes("SERVER_INSTANCE_ID=")
      && files.envExample.includes("SERVER_INSTANCE_WS_URL=")
      && files.envExample.includes("WORLD_ROUTE_TTL_MS=45000")
      && files.envExample.includes("WORLD_ROUTE_ENFORCEMENT_ENABLED=false"),
  },
  {
    name: "world broadcasts use per-world player indexes",
    ok: files.server.includes("const socketByPlayerId = new Map()")
      && files.server.includes("const worldPlayers = new Map()")
      && files.server.includes("function updatePlayerWorldIndex(player)")
      && files.server.includes("function getWorldPlayerRecords(worldName, options = {})")
      && files.server.includes("socketByPlayerId.set(playerId, socket)")
      && files.server.includes("clearPlayerWorldIndex(player)")
      && files.server.includes("getWorldPlayerRecords(clean, { includeSocket: true")
      && runtimeHealthSources.includes("world_player_index: true")
      && runtimeHealthSources.includes("world_index: getWorldIndexStatsSnapshot()"),
  },
  {
    name: "env example exposes scale and packet-protection knobs",
    ok: files.envExample.includes("PLAYER_POSITION_BATCHING_ENABLED=true")
      && files.envExample.includes("PLAYER_INTEREST_MANAGEMENT_ENABLED=true")
      && files.envExample.includes("WORLD_UPDATE_BATCHING_ENABLED=true")
      && files.envExample.includes("DROP_INTEREST_MANAGEMENT_ENABLED=true")
      && files.envExample.includes("SERVER_WEBSOCKET_MAX_BUFFERED_AMOUNT"),
  },
  {
    name: "health endpoint reports player/world network stats for live monitoring",
    ok: runtimeHealthSources.includes("getPlayerNetworkStatsSnapshot")
      && runtimeHealthSources.includes("getWorldNetworkStatsSnapshot")
      && runtimeHealthSources.includes("player_network: getPlayerNetworkStatsSnapshot()")
      && runtimeHealthSources.includes("world_network: getWorldNetworkStatsSnapshot()"),
  },
  {
    name: "rate limits and server-side validation remain in the deployment gate",
    ok: files.packageJson.includes("check:server-validation")
      && files.packageJson.includes("check:anti-dupe")
      && files.packageJson.includes("check:bot-rate-limits")
      && files.deploy.includes("npm run check:server-validation")
      && files.deploy.includes("npm run check:anti-dupe")
      && files.deploy.includes("npm run check:bot-rate-limits"),
  },
  {
    name: "scale readiness check is wired into package and deploy helper",
    ok: files.packageJson.includes('"check:scale-readiness": "node scripts/check_scale_readiness_wiring.js"')
      && files.deploy.includes("$localScaleReadinessWiringCheck")
      && files.deploy.includes("node --check scripts/check_scale_readiness_wiring.js")
      && files.deploy.includes("npm run check:scale-readiness"),
  },
  {
    name: "10k scale runbook documents infrastructure limits and rollout gates",
    ok: files.scaleReadinessDoc.includes("not a claim that the current single droplet can hold")
      && files.scaleReadinessDoc.includes("world sharding or multiple app instances")
      && files.scaleReadinessDoc.includes("npm run check:scale-readiness")
      && files.scaleReadinessDoc.includes("Scale one step at a time"),
  },
  {
    name: "staged websocket load-test helper exists and is documented",
    ok: files.packageJson.includes('"load:staged": "node scripts/staged_ws_load_test.js"')
      && files.deploy.includes("$localStagedLoadTest")
      && files.deploy.includes("node --check scripts/staged_ws_load_test.js")
      && files.loadTest.includes("staged PixelMania WebSocket load test")
      && files.loadTest.includes("Refusing --dev-login against api.pixelmaniagame.com")
      && files.loadTest.includes("account_token_login")
      && files.loadTest.includes("player_position")
      && files.scaleReadinessDoc.includes("npm run load:staged"),
  },
  {
    name: "multi-instance Redis world-cap smoke test exists and is documented",
    ok: files.packageJson.includes('"smoke:world-cap:multi": "node scripts/multi_instance_world_cap_smoke.js"')
      && files.packageJson.includes('"smoke:world-cap:multi:optional": "node scripts/multi_instance_world_cap_smoke.js --allow-skip"')
      && files.deploy.includes("$localMultiInstanceWorldCapSmoke")
      && files.deploy.includes("node --check scripts/multi_instance_world_cap_smoke.js")
      && files.multiInstanceWorldCapSmoke.includes("Starts two local PixelMania backend processes")
      && files.multiInstanceWorldCapSmoke.includes("redisStore.getWorldAdmissionCount(options.world)")
      && files.multiInstanceWorldCapSmoke.includes("expected cap joined clients and one world_full rejection")
      && files.scaleReadinessDoc.includes("npm run smoke:world-cap:multi")
      && files.scaleReadinessDoc.includes("npm run smoke:world-cap:multi:optional"),
  },
  {
    name: "aggregate multiplayer scaling smoke test covers completed phases",
    ok: files.packageJson.includes('"test:multiplayer-scaling": "node scripts/multiplayer_scaling_smoke.js"')
      && files.packageJson.includes('"test:multiplayer-scaling:fast": "node scripts/multiplayer_scaling_smoke.js --skip-security"')
      && files.packageJson.includes('"test:multiplayer-scaling:redis": "node scripts/multiplayer_scaling_smoke.js --require-redis"')
      && files.deploy.includes("$localMultiplayerScalingSmoke")
      && files.deploy.includes("node --check scripts/multiplayer_scaling_smoke.js")
      && files.multiplayerScalingSmoke.includes("local single-instance cap/index/route/chat smoke")
      && files.multiplayerScalingSmoke.includes("Redis multi-instance world-cap smoke")
      && files.multiplayerScalingSmoke.includes("Redis world-route conflict/redirect smoke")
      && files.multiplayerScalingSmoke.includes("world_route_redirect")
      && files.scaleReadinessDoc.includes("npm run test:multiplayer-scaling")
      && files.scaleReadinessDoc.includes("npm run test:multiplayer-scaling:redis"),
  },
  {
    name: "production load-test token provisioning is explicit and guarded",
    ok: files.packageJson.includes('"load:tokens": "node scripts/provision_load_tokens.js"')
      && files.deploy.includes("$localLoadTokenProvisioner")
      && files.deploy.includes("node --check scripts/provision_load_tokens.js")
      && files.loadTokenProvisioner.includes("confirm-production-load-accounts")
      && files.loadTokenProvisioner.includes("email_verified")
      && files.loadTokenProvisioner.includes("saveSession(account")
      && files.loadTokenProvisioner.includes("LoadTest_")
      && files.scaleReadinessDoc.includes("npm run load:tokens"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[scale-readiness-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[scale-readiness-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[scale-readiness-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[scale-readiness-wiring] success");
