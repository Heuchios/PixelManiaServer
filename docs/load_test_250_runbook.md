# Instrumented 250-player load test — runbook

Step 1 of the 500-player plan: decide whether the pong-age decay seen at 250 players is a
**server code defect** or **capacity**. Everything here exists to produce one artifact —
`tmp_load250_metrics.jsonl` — with server event-loop lag and client liveness on the same
timeline.

Target for this run: **route staging on the production droplet**, ports 18081/18082.

## Where to run each command

| prefix | run it from |
|---|---|
| `powershell` / `npm run load:staged` / `git` | **your PC**, in `PixelManiaServer` |
| `ssh root@68.183.141.114 '<cmd>'` | **your PC** — or, if you are already in the DigitalOcean web console, drop the wrapper and run just `<cmd>` |
| bare `curl` / `pm2` / `ss` | **the droplet** (web console or an SSH session) |

**The DigitalOcean web console collapses newlines inside quoted strings.** A pasted
`bash -lc '` block spanning several lines arrives as one run-together line, and
`set -e` + `RELEASE=…` becomes `set -eRELEASE=…` → `set: -R: invalid option`. Every droplet
command below is therefore a single line with `;` separators. Keep it that way, or paste into
a real SSH session instead.

Only the load runs (steps 4–5) genuinely have to originate from your PC — they must not burn
droplet CPU. Everything else can be done from the web console. The droplet has no key to SSH
to *itself*, so an `ssh root@68.183.141.114 …` pasted into the web console fails with
`Permission denied (publickey)` — that is the wrapper, not a broken key.

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

**`/health` is at the host root, and a path-preserving proxy hides it.** Behind Caddy,
`/staging-ws-a/health` reaches the backend as `/staging-ws-a/health` and never matches
`/health`. This run avoids the problem by connecting **directly to ports 18081/18082**, where
`/health` is reachable normally.

**Do not run the 250 clients on the droplet.** They would consume the CPU you are measuring.
Clients run from your PC.

**Why direct rather than through the edge.** `ufw status` shows 80/443 open **only to
Cloudflare IP ranges**, so the real client path is `client → Cloudflare → Caddy → Node` —
**two** proxy hops. The July abort was `stale_peer_activity` with `buffered=0` and
`pendingWriteAgeMs=0`: clients seeing nothing from the peer for 20+ s with nothing queued
locally. That fits a server falling behind, but it fits **either edge hop stalling the
WebSocket** just as well, and 250 WebSocket connections from one source IP is exactly the
traffic shape a CDN may shape or throttle. Nothing in the July telemetry could tell them
apart.

Going direct removes both hops as confounds, avoids editing the live ingress, and avoids the
`--allow-live-dev-login` override (the host is no longer `api.pixelmaniagame.com`). The cost
is that it opens two ports on the production droplet, so the firewall rule in step 3d is
mandatory — staging runs with dev backend login enabled.

If the decay does **not** reproduce here, the game loop is exonerated and the edge becomes the
prime suspect; the follow-up experiment is the same run through `/staging-ws-a|b`.

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

Confirm the new build is actually serving — the `process_runtime` block is the tell. **On the
droplet:**

```bash
for p in 18091 18092; do echo "== $p"; curl -s http://127.0.0.1:$p/health | grep -o '"release_id":"[^"]*"'; curl -s http://127.0.0.1:$p/health | grep -o '"process_runtime":{[^}]*}'; done
```

You must see a non-empty `release_id` and a `process_runtime` object with `rss_mb`.
If `process_runtime` is missing, the old build is still running — do not proceed, the memory
question would stay unanswered. Diagnose which release each process is actually running from:

```bash
for p in $(pgrep -f server.js); do echo "pid $p cwd $(readlink /proc/$p/cwd)"; done
```

Two PIDs on the same port with different `cwd` is the port-8080 orphan signature (root's legacy
PM2 daemon versus the `pixelmania` user's). A bare `pm2 restart` re-runs whatever is in the
app's existing `cwd`, so if the deploy created a *new* release directory without repointing
the apps, the restart picks up nothing.

---

## Step 3 — Start route staging, bound publicly and firewalled

### 3a — your PC's public IP (on your PC)

```powershell
curl.exe -s https://api.ipify.org
```

Call the result `YOURIP`.

### 3b — confirm the release path (on the droplet)

```bash
for p in $(pgrep -f server.js); do echo "pid $p $(readlink /proc/$p/cwd)"; done
```

All processes should point at the release whose `release_id` step 2 reported. Staging must be
started from that same directory so it runs the new build.

### 3c — start staging (on the droplet)

Substitute `<RELEASE_ID>` with the release step 2 reported.

```bash
ls -l /home/pixelmania/PixelManiaServer/releases/<RELEASE_ID>/scripts/*.sh
```

**Every shipped `.sh` has no executable bit** (`-rw-r-----`; confirmed across all 13 scripts in
the release on 2026-08-06). `deploy_to_droplet.ps1` packages with `git archive`, which
preserves the mode git recorded, and on Windows the exec bit generally never gets committed.
So invoke through `bash <script>`, never `./<script>` — that also works on a read-only release
directory and needs no `chmod`. Permanent fix, when convenient:
`git update-index --chmod=+x scripts/*.sh`.

```bash
sudo -iu pixelmania bash -lc 'set -e; export ROUTE_STAGING_PM2_CONFIG=/home/pixelmania/ecosystem.route-staging.config.js; export ROUTE_A_WS_URL=ws://68.183.141.114:18081; export ROUTE_B_WS_URL=ws://68.183.141.114:18082; cd /home/pixelmania/PixelManiaServer/releases/<RELEASE_ID>; bash ./scripts/start_route_staging_instances.sh'
```

`ROUTE_A_WS_URL` / `ROUTE_B_WS_URL` set `SERVER_INSTANCE_WS_URL`, which is what a
`world_route_redirect` would send clients to. Left at their default they would point at
`wss://api.pixelmaniagame.com/staging-ws-*`, which is unreachable on this path.

The script hardcodes a loopback bind, so flip it. Run the `sed` **as root** — nesting single
quotes inside `bash -lc '…'` is what makes the escaped-quote form fail:

```bash
sed -i '/HOST:/s/127\.0\.0\.1/0.0.0.0/' /home/pixelmania/ecosystem.route-staging.config.js
```

```bash
grep -n 'HOST:\|REDIS_URL' /home/pixelmania/ecosystem.route-staging.config.js
```

The address range is scoped to the `HOST:` line on purpose: the generated config also contains
`REDIS_URL: "redis://127.0.0.1:6379"`, and an unscoped substitution would silently break Redis,
which route enforcement requires. Confirm `HOST` is `0.0.0.0` and `REDIS_URL` is untouched
before reloading.

```bash
sudo -iu pixelmania bash -lc 'pm2 startOrReload /home/pixelmania/ecosystem.route-staging.config.js --update-env && pm2 save && pm2 list'
```

```bash
ss -ltnp | grep -E "18081|18082"     # must show 0.0.0.0, not 127.0.0.1
```

### 3d — firewall to your IP only (on the droplet, as root)

Do this **after** 3c, not before — with nothing listening, 3e cannot tell "firewalled" from
"not started".

```bash
ufw status
iptables -I INPUT 1 -p tcp -m multiport --dports 18081,18082 -s YOURIP -j ACCEPT
iptables -I INPUT 2 -p tcp -m multiport --dports 18081,18082 -j DROP
iptables -L INPUT -n --line-numbers | head -5
```

Expected shape (INPUT policy is already `DROP`, so rule 2 is belt-and-braces):

```
Chain INPUT (policy DROP)
num  target    prot source            destination  multiport dports
1    ACCEPT    6    <YOURIP>          0.0.0.0/0    18081,18082
2    DROP      6    0.0.0.0/0         0.0.0.0/0    18081,18082
3    ts-input  0    0.0.0.0/0         0.0.0.0/0
```

Rule 1 allows you; rule 2 drops everyone else. Inserting both at the top makes the order
independent of whatever ufw or Docker already put in the chain. The rules are **not**
persisted, so a reboot clears them — teardown removes them explicitly anyway.

**Staging runs with dev backend login enabled. Do not start the load run until 3e passes.**

### 3e — verify from your PC

**PowerShell, in the VS Code `pwsh` terminal — not the droplet console.** `curl.exe` and
`$LASTEXITCODE` do not exist on Linux; pasted there they fail with `curl.exe: command not
found` and then a misleading `ENOENT: h.json`.

```powershell
curl.exe -sS http://68.183.141.114:18081/health -o h.json; echo "exit=$LASTEXITCODE"
```
```powershell
node -e "const fs=require('fs');const h=JSON.parse(fs.readFileSync('h.json','utf8'));console.log(h.persistence.world_route.instance_id,'postgres_ready='+h.persistence.postgres_ready,JSON.stringify(h.persistence.process_runtime))"
```

Use `-sS`, not `-s`: on failure `-s` writes nothing and stays silent, and the next command
fails with a misleading `Cannot find module './h.json'` instead of the real connection error.
Read the JSON with `fs.readFileSync`, not `require('./h.json')`, so a stale file from an
earlier attempt cannot be served from the module cache.

Expect `route-stage-a postgres_ready=false {"pid":…,"rss_mb":…}`. Repeat for 18082, expecting
`route-stage-b`.

That single line proves three things at once:

- **reachable** from your IP
- **staging, not production** — `postgres_ready=false`; the production route instances report `true`
- **new build** — `process_runtime` is present

A timeout here with correct iptables means a **DigitalOcean Cloud Firewall** is blocking:
Networking → Firewalls, add inbound TCP 18081-18082 from your IP.

---

## Step 4 — Rehearsal at 10 clients

Never go straight to 250. This surfaces auth pacing, world naming and routing problems for
about a minute of runtime. No `--allow-live-dev-login` is needed on this path.

```powershell
cd <PixelManiaServer>
npm run load:staged -- `
  --urls ws://68.183.141.114:18081,ws://68.183.141.114:18082 `
  --worlds LOADSTAGE_A1,LOADSTAGE_B1 `
  --dev-login `
  --clients 10 --step 5 --step-ms 10s --hold-ms 60s --rate 10 `
  --health-urls a=http://68.183.141.114:18081/health,b=http://68.183.141.114:18082/health `
  --metrics-out ./tmp_load_rehearsal.jsonl
```

### Prove the traffic landed on staging, not production

Capture production's `indexed_player_count` **before** starting, then re-check during the
hold. On the droplet:

```bash
for p in 18081 18082 18091 18092; do echo -n "$p "; curl -s http://127.0.0.1:$p/health | grep -o '"indexed_player_count":[0-9]*'; done
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

## Step 5 — The 250-player run

Thresholds deliberately match the July run so the two are comparable
(`rate=10/s step=25 stepMs=30s holdMs=5m maxTransportSkips=50 maxMovementBuffer=65536
maxPongAgeMs=15s`). Six worlds over two URLs = 42 players per world, under the 50 cap.

```powershell
npm run load:staged -- `
  --urls ws://68.183.141.114:18081,ws://68.183.141.114:18082 `
  --worlds LOADSTAGE_A1,LOADSTAGE_B1,LOADSTAGE_A2,LOADSTAGE_B2,LOADSTAGE_A3,LOADSTAGE_B3 `
  --dev-login `
  --clients 250 --step 25 --step-ms 30s --hold-ms 5m --rate 10 `
  --max-clients-per-world 50 `
  --max-transport-skips 50 --max-movement-buffer 65536 --max-pong-age-ms 15s `
  --health-urls a=http://68.183.141.114:18081/health,b=http://68.183.141.114:18082/health `
  --metrics-out ./tmp_load250_metrics.jsonl `
  --stats-ms 5s 2>&1 | Tee-Object -FilePath .\tmp_load250_instrumented.out.log
```

One deviation from July worth remembering when comparing: this path has **no TLS and no
proxy**. If the decay does not reproduce, that difference is a prime suspect, not a nuisance.

**Expect it to abort during the hold, exactly like July.** That is fine and is the point —
the abort path now captures a final `phase: "abort"` server sample before teardown, and the
metrics file is always finalized.

Keep both artifacts: `tmp_load250_metrics.jsonl` and `tmp_load250_instrumented.out.log`.

---

## Step 6 — Read the verdict

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

## Step 7 — Tear down

Route staging holds ~100–130 MB per process serving nothing once the test is done.

```bash
sudo -iu pixelmania bash -lc 'pm2 delete pixelmania-route-a pixelmania-route-b; pm2 save --force; pm2 list'
```

`pm2 save` **without** `--force` skips an empty list, and a reboot would resurrect the staging
apps. Use `--force`.

Then drop the firewall rules and clear the staging data, as root:

```bash
iptables -D INPUT -p tcp -m multiport --dports 18081,18082 -s YOURIP -j ACCEPT
iptables -D INPUT -p tcp -m multiport --dports 18081,18082 -j DROP
iptables -L INPUT -n --line-numbers | head -5
ss -ltnp | grep -E "18081|18082" || echo "(staging ports closed)"
rm -rf /tmp/pixelmania-route-staging /home/pixelmania/ecosystem.route-staging.config.js
```

If you added a DigitalOcean Cloud Firewall rule in step 3e, remove that too.

---

## If it goes wrong

| symptom | cause | action |
|---|---|---|
| `Refusing --dev-login against api.pixelmaniagame.com` | you are on the proxied URL, not the direct one | use `ws://68.183.141.114:18081`, not the `api.pixelmaniagame.com` host |
| connection refused / timeout from your PC | bind still loopback, or firewall | re-check `ss -ltnp` shows `0.0.0.0` and re-run step 3d/3e |
| `bash: line 1: set: -R: invalid option` | web console collapsed a multi-line paste | re-paste as a single line with `;` separators |
| `./scripts/…: Permission denied` | shipped `.sh` has no exec bit | invoke as `bash ./scripts/…` |
| `curl.exe: command not found` | PowerShell command pasted into the droplet console | run it in the VS Code `pwsh` terminal instead |
| `sed: can't read …ecosystem.route-staging.config.js` | 3c did not actually run | the config is generated by the start script; fix 3c first |
| staging can't claim world routes | the `sed` rewrote `REDIS_URL` too | re-check `grep REDIS_URL` on the generated config; it must stay `127.0.0.1:6379` |
| aborts during ramp with `rateLimited` > 0 | 250 dev logins from one IP hit a pre-auth bucket | add `--auth-spacing-ms 250`; if it persists, send me the `rateBucket=` value |
| `redirects` > 0 | two URLs competing for one world | check `--worlds` has a distinct name per route and none collide with live worlds |
| `server[x] unreachable` | firewall rule dropped, or your public IP changed | re-run `curl.exe -s https://api.ipify.org` and redo step 3d; gaps in the series are unmeasured, not healthy |
| `rss=(unreported)` | staging started from an old release directory | redo step 3c from the release step 2 reported |
| `world_full` rejections | more than 50 per world | keep `clients / worlds` under 50 |
