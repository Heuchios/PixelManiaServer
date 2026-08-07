# Day-to-day workflow: staging → production

Everything runs from `G:\PixelMania\PixelManiaServer` in PowerShell.

**The core idea:** one commit is deployed to staging, tested, and then that *same commit*
is promoted to production. There is no second commit and no separate "production build".
`promote_staging_to_production.ps1` refuses to run if your local `HEAD` no longer matches
the commit staging is running — that refusal is the guarantee that production gets exactly
what you tested.

---

## A. Working on staging

### A0. Point the Godot editor at staging (once per session)

**Project Settings → filter `main run args` → Editor → Run → Main Run Args:**

```
-- --pixelmania-api-base https://staging-api.pixelmaniagame.com --pixelmania-ws-url wss://staging-api.pixelmaniagame.com/ws
```

Confirm in the Output panel: `Connecting to PixelMania server: wss://staging-api...`.
While that field is set, F5 always goes to staging. Clear it to go back to production.

### A1. Edit the source

Server code lives in `src/*.ts`. **Never edit the root `*.js`** — it is build output and
gets overwritten.

### A2. Build the file you changed

Each source file has its own build script:

```powershell
npm run build:server-entry                          # src/server.ts
npm run build:server-world-state-helpers            # src/server_world_state_helpers.ts
npm run build:item-data                             # src/server_item_database.ts
# ls src/ and check package.json for the rest
```

Skipping this leaves the server on the old behaviour, which reads as "my fix did nothing".

### A3. Commit

```powershell
git add -A
git commit -m "what you changed"
```

Required — the deploy refuses a dirty worktree. Any branch is fine; the commit **hash** is
what ties staging and production together, not the branch name.

### A4. Deploy to staging

```powershell
.\deploy_staging.ps1              # full gate
.\deploy_staging.ps1 -Fast        # skips check:security, for a tight loop
```

This touches **only** staging: user `pixelmania-stg`, port 8180,
`staging-api.pixelmaniagame.com`. It restarts staging's server for you — no manual restart
needed. Production is not contacted at all.

### A5. Test in the editor

Press F5 and actually play it: log in, join a world, place and break a block, rejoin and
check it persisted. Health checks and green deploy output do not prove the write path
works — that lesson cost an hour on 2026-08-06.

### A6. Repeat A1–A5 until it's right

Use `-Fast` while iterating. Run at least once **without** `-Fast` before promoting, so the
full `check:security` gate has passed on the exact commit you intend to ship.

---

## B. Promoting to production

### B1. Final clean staging deploy

```powershell
.\deploy_staging.ps1
```

No `-Fast`. This is the release gate.

### B2. Verify once more in the editor

### B3. Promote

```powershell
.\promote_staging_to_production.ps1
```

Type `PROMOTE` when prompted. The script:

1. reads staging's `shared/last_successful_release.json`
2. **refuses** unless local `git rev-parse HEAD` == staging's `backend_commit`
3. re-packages that identical commit with `git archive`
4. deploys to production, reusing the **same ReleaseId**
5. re-reads production's manifest and **compares `backend_sha256` against staging's**

Step 5 is the proof. If the hashes differ it throws instead of declaring success.

Production restarts as part of this. No manual restart.

### B4. Check production yourself

```powershell
# Clear Main Run Args in Godot first, then F5 to test against production.
```

```bash
curl -sS -o /dev/null -w 'prod: %{http_code}\n' https://api.pixelmaniagame.com/health
```

### If promotion refuses with "local HEAD does not match"

You changed something after the staging deploy. Either:

```powershell
.\deploy_staging.ps1          # re-test the new commit, then promote
```

or check out the commit staging actually ran (the error prints the hash).

---

## C. Rollback

Each environment rolls back independently.

```powershell
.\rollback_release.ps1 68.183.141.114 -RemoteUser pixelmania-stg   # staging
.\rollback_release.ps1 68.183.141.114                              # production
.\rollback_release.ps1 68.183.141.114 -Status                      # inspect first
```

Both swap `current` ⇄ `previous`, re-activate, and verify health against **their own**
port. If the rollback target fails health, the original release is restored automatically.

---

## D. Restarting a server by hand

Normally you never need to — deploys restart for you. The one real case is a **`.env`
change**, which is *not* part of a deploy (see section E).

**`pm2 restart <name> --update-env` does NOT re-read `.env`.** It refreshes env from your
shell. `.env` is read by `dotenv` inside `ecosystem.config.js`, so only starting from that
config picks it up.

Staging:

```bash
sudo -u pixelmania-stg -H bash -lc '
  set -a; . /home/pixelmania-stg/PixelManiaServer/current/.release-env; set +a
  export PIXELMANIA_RELEASE_ROOT=/home/pixelmania-stg/PixelManiaServer
  export PIXELMANIA_BACKEND_ROOT=/home/pixelmania-stg/PixelManiaServer/current
  cd /home/pixelmania-stg/PixelManiaServer/current
  pm2 delete pixelmania >/dev/null 2>&1
  pm2 start ecosystem.config.js --only pixelmania --env production
  pm2 save'
```

Production: prefer a deploy. If you must, the same shape but as `pixelmania`, and remember
production runs **six** apps (`pixelmania`, `-a`, `-b`, `-route-a`, `-route-b`, `-ops`) —
`pm2 delete` on the wrong one is an outage.

Verify from the server's own boot log, never from PM2's stored env:

```bash
sudo -u pixelmania-stg pm2 logs pixelmania --lines 40 --nostream | grep -i "route enforcement"
```

---

## E. Things that do NOT flow staging → production automatically

**`.env` / configuration.** Each environment has its own
`~/PixelManiaServer/shared/.env`, kept outside the release. A config change you test on
staging is **not** promoted — you must apply it to production separately, then restart per
section D. This is deliberate (staging must never ship its database credentials), but it
means config changes need their own checklist.

**Client (Godot) changes.** `pixel-mania` is a separate repo. Players only get client
changes through a **client export and update**, not through any server deploy. The deploy
packages selected client files into the release for validation only. To force players onto
a new client:

```powershell
.\promote_staging_to_production.ps1 -ForceClientUpdate -ClientVersion 1.0.5
```

**New items.** Adding an item to `pixel-mania/Scripts/item_database.gd` also requires an
entry in `PixelManiaServer/src/server_item_database.ts`, then `npm run build:item-data`,
then commit **both** the `.ts` and the generated `.js`. Otherwise `npm run check:item-db`
fails the gate and the deploy refuses to ship.

**Database schema/data.** Staging's data is a point-in-time clone. Re-clone when it drifts:

```bash
sudo bash /home/pixelmania-stg/PixelManiaServer/current/staging/clone_production_to_staging.sh
```

Off-peak — the `pg_dump` read burst is the one part of this setup live players could feel.

---

## F. Why you can't hit production by accident

- **Separate OS user → separate PM2 daemon.** Staging's deploy literally cannot see
  production's processes; `pm2 describe pixelmania-a` fails under `pixelmania-stg`.
- **`deploy_staging.ps1` hard-throws** if `RemoteUser` is `pixelmania` or the health port
  is 8080.
- **Separate database and Redis DB.** `pixelmania_staging` / Redis DB 1 with its own key
  prefix.
- **Promotion needs a typed `PROMOTE`** plus a matching commit hash.

The one command that *would* hurt production is a manual `pm2 delete` run as the
`pixelmania` user. Nothing in the normal flow does that.

---

## Quick reference

| I want to… | Command |
|---|---|
| Ship my work to staging | `.\deploy_staging.ps1` |
| Fast iteration on staging | `.\deploy_staging.ps1 -Fast` |
| Ship the tested build live | `.\promote_staging_to_production.ps1` |
| Undo staging | `.\rollback_release.ps1 68.183.141.114 -RemoteUser pixelmania-stg` |
| Undo production | `.\rollback_release.ps1 68.183.141.114` |
| See what's deployed | `.\rollback_release.ps1 68.183.141.114 -Status` |
| Refresh staging data | `sudo bash .../staging/clone_production_to_staging.sh` |
| Staging logs | `sudo -u pixelmania-stg pm2 logs pixelmania --lines 100 --nostream` |
| Production logs | `sudo -u pixelmania pm2 logs pixelmania-a --lines 100 --nostream` |
