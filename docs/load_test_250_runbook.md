# Instrumented 250-player load test — runbook

Step 1 of the 500-player plan: decide whether the pong-age decay seen at 250 players is a
**server code defect** or **capacity**. Everything here exists to produce one artifact —
`tmp_load250_metrics.jsonl` — with server event-loop lag and client liveness on the same
timeline.

Target for this run: **route staging on the production droplet**, ports 18081/18082.

---

## Read this before anything else

**The July 2026 run was almost certainly against production.** It used
`--token-file load_tokens.250.*.json` against `wss://api.pixelmaniagame.com/ws-a|/ws-b`, and
those are production account tokens on production route paths. Route staging has
`POSTGRES_ENABLED=false` and its own data directory, so production tokens cannot authenticate
there. This run uses staging paths and `--dev-login` instead.

**Route staging shares the production droplet.** `pixelmania-route-a/b` run on ports
18081/18082 on the same 4 vCPUs as `pixelmania` (8080), `pixelmania-a` (18091),
`pixelmania-b` (18092), Postgres and Redis. A 250-player run competes with live players.
**Run this in your lowest-traffic window.** Expect the absolute numbers to be pessimistic
versus a dedicated box; the *trend* is what the test is for, and the trend survives.

**`/health` is at the host root, and Caddy preserves paths.** `/staging-ws-a/health` reaches
the backend as `/staging-ws-a/health` and never matches `/health`. Per-instance health is
only reachable at `http://127.0.0.1:<port>/health` from the droplet — hence the SSH tunnel in
step 4. This is not optional.

**Do not run the 250 clients on the droplet.** They would consume the CPU you are measuring.
Clients run from your PC over the public WSS path; only the tiny health polling goes through
the tunnel.

---

## Step 1 — Build and verify locally

From `PixelManiaServer` on your PC:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_and_verify_phase11a_health_memory.ps1
```

This runs the real `npm run build:server-phase11a-runtime` plus `check:server-phase11a-runtime`,
`check:load-staged-safety`, `check:scale-readiness` and `check:typescript`.

**Nothing is verified until this is green.** If it fails, stop and send me the output.

Then commit source and generated output together — `deploy_to_droplet.ps1` refuses a dirty
tree and re-runs the builds, failing on any diff:

```powershell
git add src/server_phase11a_runtime.ts server_phase11a_runtime.js `
        scripts/check_server_phase11a_runtime_build.js `
        scripts/staged_ws_load_test.js `
        scripts/check_staged_ws_load_test_safety.js `
        scripts/check_scale_readiness_wiring.js `
        .gitignore build_and_verify_phase11a_health_memory.ps1 docs/load_test_250_runbook.md
git commit -m "Report process memory on /health and capture server metrics in the staged load test"
```

---

## Step 2 — Deploy to the droplet

```powershell
.\deploy_to_droplet.ps1
```

This restarts the live game processes, so do it inside the same low-traffic window.

Confirm the new build is actually serving — the `process_runtime` block is the tell:

```bash
ssh root@68.183.141.114 'curl -s http://127.0.0.1:18091/health | head -c 400; echo'
ssh root@68.183.141.114 'curl -s http://127.0.0.1:18091/health | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const h=JSON.parse(s);console.log(h.release_id, JSON.stringify(h.persistence.process_runtime));})"'
```

You must see a non-empty `release_id` and a `process_runtime` object with `rss_mb`.
If `process_runtime` is missing, the old build is still running — do not proceed, the memory
question would stay unanswered.

---

## Step 3 — Start route staging and prove where it points

On the droplet, as the `pixelmania` user, from the active release directory:

```bash
sudo -u pixelmania bash -lc 'cd /home/pixelmania/PixelManiaServer/current && ./scripts/start_route_staging_instances.sh'
```

(Substitute the real active release path if `current` is not a symlink on your box.)

Then add the Caddy routes the script prints, **before** the default `reverse_proxy` in the
`api.pixelmaniagame.com` site block, and reload Caddy:

```
@pixelmaniaRouteStageA path /staging-ws-a*
reverse_proxy @pixelmaniaRouteStageA 127.0.0.1:18081

@pixelmaniaRouteStageB path /staging-ws-b*
reverse_proxy @pixelmaniaRouteStageB 127.0.0.1:18082
```

```bash
ssh root@68.183.141.114 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
```

### Preflight assertions — all four must hold

```bash
# 1. Staging processes are up on the expected ports.
ssh root@68.183.141.114 'ss -ltnp | grep -E "18081|18082"'

# 2. Staging fingerprint: instance ids route-stage-a/b AND postgres_ready:false.
#    postgres_ready:false is the unmistakable "this is not production" signal.
ssh root@68.183.141.114 'for p in 18081 18082; do curl -s http://127.0.0.1:$p/health \
  | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const h=JSON.parse(s);console.log(h.persistence.world_route.instance_id, \"postgres_ready=\"+h.persistence.postgres_ready);})"; done'

# 3. Production is distinguishable: postgres_ready:true on 18091/18092.
ssh root@68.183.141.114 'curl -s http://127.0.0.1:18091/health | grep -o "\"postgres_ready\":[a-z]*"'

# 4. Dev backend login is enabled on staging but NOT in the shared .env that the
#    production route instances read.
ssh root@68.183.141.114 'grep -iE "DEV_BACKEND_LOGIN|ALLOW_DEV_TOOLS" /home/pixelmania/PixelManiaServer/current/.env || echo "(not set in .env — good)"'
```

Assertion 4 matters: the load test's `--allow-live-dev-login` override (needed in step 5,
because the staging URL is on the `api.pixelmaniagame.com` host) is only safe if a misrouted
run would be rejected by production rather than load it. If `.env` enables dev backend login
globally, **stop and tell me** — we will use a different approach.

---

## Step 4 — Open the health tunnel

From your PC, in its own terminal, leave running for the whole test:

```powershell
ssh -N -L 18081:127.0.0.1:18081 -L 18082:127.0.0.1:18082 root@68.183.141.114
```

Verify from a second terminal:

```powershell
curl.exe -s http://127.0.0.1:18081/health | Select-Object -First 1
```

---

## Step 5 — Rehearsal at 10 clients

Never go straight to 250. This surfaces auth pacing, world naming and routing problems for
about a minute of runtime.

```powershell
cd <PixelManiaServer>
npm run load:staged -- `
  --urls wss://api.pixelmaniagame.com/staging-ws-a,wss://api.pixelmaniagame.com/staging-ws-b `
  --worlds LOADSTAGE_A1,LOADSTAGE_B1 `
  --dev-login --allow-live-dev-login `
  --clients 10 --step 5 --step-ms 10s --hold-ms 60s --rate 10 `
  --health-urls a=http://127.0.0.1:18081/health,b=http://127.0.0.1:18082/health `
  --metrics-out ./tmp_load_rehearsal.jsonl
```

### Prove the traffic landed on staging, not production

While the hold is running, on the droplet:

```bash
ssh root@68.183.141.114 'for p in 18081 18082 18091 18092; do echo -n "$p "; curl -s http://127.0.0.1:$p/health \
  | grep -o "\"indexed_player_count\":[0-9]*"; done'
```

**18081 + 18082 must sum to 10. 18091 and 18092 must be unchanged from their pre-test values**
(capture those first). If any load clients show up on 18091/18092, abort immediately — the
Caddy routes are wrong and you are load-testing production.

Also confirm in the rehearsal output:

- `server[a]` and `server[b]` lines show **two different** `instance=` values
- neither line says `rss=(unreported)` — if it does, the droplet is on the old build
- no `WARNING: ... collapse to ... derived /health endpoint(s)`
- `redirects=0`

---

## Step 6 — The 250-player run

Thresholds deliberately match the July run so the two are comparable
(`rate=10/s step=25 stepMs=30s holdMs=5m maxTransportSkips=50 maxMovementBuffer=65536
maxPongAgeMs=15s`). Six worlds over two URLs = 42 players per world, under the 50 cap.

```powershell
npm run load:staged -- `
  --urls wss://api.pixelmaniagame.com/staging-ws-a,wss://api.pixelmaniagame.com/staging-ws-b `
  --worlds LOADSTAGE_A1,LOADSTAGE_B1,LOADSTAGE_A2,LOADSTAGE_B2,LOADSTAGE_A3,LOADSTAGE_B3 `
  --dev-login --allow-live-dev-login `
  --clients 250 --step 25 --step-ms 30s --hold-ms 5m --rate 10 `
  --max-clients-per-world 50 `
  --max-transport-skips 50 --max-movement-buffer 65536 --max-pong-age-ms 15s `
  --health-urls a=http://127.0.0.1:18081/health,b=http://127.0.0.1:18082/health `
  --metrics-out ./tmp_load250_metrics.jsonl `
  --stats-ms 5s 2>&1 | Tee-Object -FilePath .\tmp_load250_instrumented.out.log
```

**Expect it to abort during the hold, exactly like July.** That is fine and is the point —
the abort path now captures a final `phase: "abort"` server sample before teardown, and the
metrics file is always finalized.

Keep both artifacts: `tmp_load250_metrics.jsonl` and `tmp_load250_instrumented.out.log`.

---

## Step 7 — Read the verdict

The end-of-run summary prints, per endpoint, `min / avg / max / firstQuarterAvg /
lastQuarterAvg / growth` for each metric. **Read `growth`, not `max`** — `max_event_loop_lag_ms`
is monotonic by construction and always looks alarming.

| what you see | what it means |
|---|---|
| `event_loop_lag_ms` growth large and positive, at flat player count | the process is progressively falling behind — **code defect**, keep digging |
| `active_interest_links` or `pending_position_updates` growing while `indexed_player_count` is flat | a leak or O(n²) fan-out — **code defect**, and this is the strongest single signal |
| `rss_mb` climbing toward 256 (staging cap) | memory growth; a PM2 restart would drop every player on that instance |
| lag high but **flat**, queue waits flat, memory flat | the box is simply saturated — **capacity**, and the fix is hardware/process layout |
| everything flat on the server while client `maxPongAge` still decays | the decay is **not** server-side — look at the load generator or the network path |

Because staging runs with `POSTGRES_ENABLED=false`, a defect that still reproduces here is
definitively in the game loop and **not** the write path. That is a clean, valuable result.

Useful one-liners over the artifact:

```powershell
# Lag and pong-age on one timeline, per sample.
node -e "require('fs').readFileSync('tmp_load250_metrics.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(r=>r.phase!=='summary').forEach(r=>console.log(r.t_ms, r.endpoint, r.phase, 'lag='+r.server.event_loop_lag_ms, 'rss='+r.server.rss_mb, 'players='+r.server.indexed_player_count, 'pongAge='+r.client.max_pong_age_ms))"

# Just the summary rows.
node -e "require('fs').readFileSync('tmp_load250_metrics.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(r=>r.phase==='summary').forEach(r=>console.log(JSON.stringify(r.summary.series,null,2)))"
```

Send me both files and I will work the verdict into the next step.

---

## Step 8 — Tear down

Route staging holds ~100–130 MB per process serving nothing once the test is done.

```bash
sudo -u pixelmania bash -lc 'pm2 delete pixelmania-route-a pixelmania-route-b; pm2 save --force'
```

`pm2 save` **without** `--force` skips an empty list, and a reboot would resurrect the staging
apps. Use `--force`.

Also remove the two Caddy `@pixelmaniaRouteStage*` blocks and reload, and clear the staging
data directory:

```bash
ssh root@68.183.141.114 'rm -rf /tmp/pixelmania-route-staging'
```

---

## If it goes wrong

| symptom | cause | action |
|---|---|---|
| `Refusing --dev-login against api.pixelmaniagame.com` | `--allow-live-dev-login` missing | add it, **after** re-checking the step 3 preflight |
| aborts during ramp with `rateLimited` > 0 | 250 dev logins from one IP hit a pre-auth bucket | add `--auth-spacing-ms 250`; if it persists, send me the `rateBucket=` value |
| `redirects` > 0 | two URLs competing for one world | check `--worlds` has a distinct name per route and none collide with live worlds |
| `server[x] unreachable` | tunnel dropped | restart the step 4 SSH session; gaps in the series are unmeasured, not healthy |
| `rss=(unreported)` | droplet on the pre-`process_runtime` build | redo step 2 |
| `world_full` rejections | more than 50 per world | keep `clients / worlds` under 50 |
