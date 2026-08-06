# PixelMania staging on the production droplet

A second, fully isolated PixelMania backend on the same box as production, for solo
feature development: point the Godot editor at it, verify a change, then promote the
exact same build to live.

## Why it is safe to share the droplet

Production measured on 2026-08-06: 7.7% host CPU, 18% of 8 GB RAM, peak 0.64 database
writes/sec against a measured drain of 10-40 tx/sec. One more ~100 MB Node process is
noise. The box is not the constraint; correctness of the isolation is.

The one thing staging on this droplet cannot do honestly is **load testing**. A 250-player
run contends for the same four vCPUs, the same PostgreSQL and the same Redis as live
players, so its numbers are meaningless and its impact is real. Keep using the direct-port
load-test path against production off-peak for that.

## What separates the two environments

| | production | staging |
|---|---|---|
| OS user | `pixelmania` | `pixelmania-stg` |
| PM2 daemon | `sudo -u pixelmania pm2` | `sudo -u pixelmania-stg pm2` |
| Node ports | 8080, 18091, 18092 | 8180 |
| PostgreSQL | database `pixelmania` | database `pixelmania_staging`, role `pixelmania_stg` |
| Redis | DB 0, prefix `pixelmania` | DB 1, prefix `pixelmania_stg` |
| Save data | `/var/lib/pixelmania` | `/var/lib/pixelmania-staging` |
| Public host | `api.pixelmaniagame.com` | `staging-api.pixelmaniagame.com` |
| Release root | `/home/pixelmania/PixelManiaServer` | `/home/pixelmania-stg/PixelManiaServer` |

### The separate OS user is load-bearing

`deploy_to_droplet.ps1` and `scripts/rollback_release.sh` both decide what to restart by
probing `pm2 describe pixelmania-a` and `pm2 describe pixelmania-ops`. Under the
production user those probes **succeed**, so a staging deploy would restart production's
route instances against staging's release directory — a live outage caused by a staging
deploy. Under `pixelmania-stg` they query a different PM2 daemon, fail, and staging only
ever touches its own single app.

This is also why staging's PM2 app keeps the name `pixelmania`: the name is scoped to the
daemon, so `pm2 logs pixelmania` means "this environment's server" whichever user you are.
Do not merge the two daemons.

## One-time setup

On the droplet, as root:

```bash
sudo bash /home/pixelmania-stg/PixelManiaServer/current/staging/provision_staging.sh
```

(For the very first run, copy `staging/provision_staging.sh` and `staging/env.staging.example`
up manually — nothing is deployed yet.)

It creates the user, the release directory layout, the PostgreSQL role and database, the
save-data directory, a generated `.env`, PM2 boot persistence, and the Caddy site. It is
idempotent and will not overwrite an existing `.env`.

Then add a **proxied Cloudflare DNS record** for `staging-api.pixelmaniagame.com` pointing
at the droplet. The existing `ufw` rules already restrict 80/443 to Cloudflare ranges, so
staging inherits the same edge protection production has.

## Daily loop

```powershell
# 1. Commit your work (the deploy refuses a dirty tree by design).
git add -A; git commit -m "..."

# 2. Ship it to staging.
.\deploy_staging.ps1

# 3. Test from the Godot editor (see below).

# 4. Ship the identical build to production.
.\promote_staging_to_production.ps1
```

`-Fast` on `deploy_staging.ps1` skips the local `check:security` preflight for a tight
loop. Run at least once without `-Fast` before promoting.

### Pointing the Godot editor at staging

The client already supports this — no code change was needed. `network_manager.gd`'s
`configure_network_urls()` reads two launch arguments, gated by
`should_allow_network_override()` to editor and debug builds only, and hard-blocked on
Android:

```
--pixelmania-api-base https://staging-api.pixelmaniagame.com
--pixelmania-ws-url wss://staging-api.pixelmaniagame.com/ws
```

Set them in the Godot editor under **Project > Project Settings > Run > Main Run Args**,
or pass them after `--` when launching the exported debug build.

Consequence of that gate: **you cannot point an Android build at staging.** Mobile touch
testing against staging needs a debug desktop build, or a one-off export with the
`API_BASE`/`WORLD_ROUTE_WS_URLS` constants edited — never relax the Android check, which is
what stops a production player from being redirected to an arbitrary server.

### Seeding staging with production data

```bash
sudo bash /home/pixelmania-stg/PixelManiaServer/current/staging/clone_production_to_staging.sh
```

Stops the staging app, `pg_dump`s the production `pixelmania` schema read-only, replaces
the staging schema, recreates any extensions, flushes staging's Redis DB, and restarts.
Run it off-peak — the dump read burst is the only part of this setup live players could
feel.

Re-run it whenever staging has drifted far enough to stop being representative.

**It copies real account rows, including email addresses and password hashes.** Treat the
staging subdomain as production-sensitive.

## Rollback

Staging and production roll back independently:

```powershell
.\rollback_release.ps1 68.183.141.114 -RemoteUser pixelmania-stg   # staging
.\rollback_release.ps1 68.183.141.114                              # production
```

`scripts/rollback_release.sh` now resolves its health endpoint from
`shared/health_url` (written by every deploy) instead of a hardcoded `127.0.0.1:8080`.
Without that, a staging rollback would poll production's port, read production's
`release_id`, and report success while leaving staging broken.

## Things that will bite you

- **A staging deploy needs a clean commit**, same as production. Commit to a working
  branch rather than fighting it; that constraint is what makes promotion honest.
- **No SMTP on staging.** Account verification email never arrives, so log in with an
  account that came over in the clone rather than registering a fresh one.
- **`MIN_CLIENT_VERSION=1.0.0` on staging** so an in-progress editor build is never
  force-updated mid-test. Production keeps its real minimum.
- **Snapshots and the anti-dupe scanner are disabled on staging** to keep background work
  off the shared CPUs. If you are specifically testing either, turn it on in staging's
  `.env` and turn it back off after.
- **Route enforcement is off** because staging is a single process. Bugs in world route
  epoch fencing will not reproduce here; those need a two-route staging topology stood up
  deliberately.
