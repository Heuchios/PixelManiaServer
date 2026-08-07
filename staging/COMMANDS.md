# Command reference — staging, production, client export

Copy-paste ready. PowerShell blocks run from `G:\PixelMania\PixelManiaServer`
(client ones from `G:\PixelMania\pixel-mania`). Bash blocks run on the droplet as root:
`ssh root@68.183.141.114`.

---

## 1. Daily staging loop

```powershell
cd G:\PixelMania\PixelManiaServer
```

```powershell
# Compile the ONE src/*.ts file you edited. Skipping this = server keeps old behaviour.
npm run build:server-entry
# ls src/ then check package.json for the matching build:* script for other files
```

```powershell
# Full release gate: typecheck, security checks, item-db sync, wiring pins.
npm run check:security
```

```powershell
# Deploys refuse a dirty tree. Any branch is fine; the commit HASH is the contract.
git add -A
git commit -m "what changed"
```

```powershell
# Ship to STAGING only. Restarts staging for you. Never contacts production.
.\deploy_staging.ps1
```

```powershell
# Same, but skips check:security. For tight iteration only — never promote from a -Fast build.
.\deploy_staging.ps1 -Fast
```

---

## 2. Promote to production

```powershell
# 1. Final staging deploy WITHOUT -Fast so the full gate runs on the exact commit.
.\deploy_staging.ps1
```

```powershell
# 2. Ship the identical commit to production. Type PROMOTE when asked.
#    Refuses if local HEAD != the commit staging is running.
#    Verifies production's backend_sha256 matches staging's afterwards.
.\promote_staging_to_production.ps1
```

```powershell
# Promote AND raise the client version gate (only once players have the new client).
.\promote_staging_to_production.ps1 -ForceClientUpdate -ClientVersion 1.0.5 -MinClientVersion 1.0.1
```

---

## 3. Rollback

```powershell
# See what's deployed where before deciding.
.\rollback_release.ps1 68.183.141.114 -RemoteUser pixelmania-stg -Status   # staging
.\rollback_release.ps1 68.183.141.114 -Status                              # production
```

```powershell
# Swap current <-> previous. Each checks ITS OWN health port. Auto-restores on failure.
.\rollback_release.ps1 68.183.141.114 -RemoteUser pixelmania-stg           # staging
.\rollback_release.ps1 68.183.141.114                                      # production
```

---

## 4. Health and status

```powershell
# Is each environment up, and which release is live?
curl.exe -s https://staging-api.pixelmaniagame.com/health | ConvertFrom-Json | Select release_id, ok
curl.exe -s https://api.pixelmaniagame.com/health         | ConvertFrom-Json | Select release_id, ok, server_client_version, min_client_version
```

```bash
# Quick edge check from the droplet. 200 = up, 502 = nothing listening, 525 = no origin TLS.
curl -sS -o /dev/null -w 'prod:    %{http_code}\n' https://api.pixelmaniagame.com/health
curl -sS -o /dev/null -w 'staging: %{http_code}\n' https://staging-api.pixelmaniagame.com/health
```

```bash
# What's running in each PM2 daemon. Staging = 1 app. Production = 6.
sudo -u pixelmania-stg pm2 list
sudo -u pixelmania     pm2 list
```

```bash
# Who holds which port.
ss -ltnp | grep -E ':(8080|8180|18091|18092|18081|18082) '
```

---

## 5. Logs

```bash
# Staging (single process, so this IS the gameplay log).
sudo -u pixelmania-stg pm2 logs pixelmania --lines 100 --nostream
```

```bash
# Production. World joins and block writes happen on -a / -b, NOT on the 8080 app.
sudo -u pixelmania pm2 logs pixelmania-a --lines 100 --nostream
sudo -u pixelmania pm2 logs pixelmania-b --lines 100 --nostream
sudo -u pixelmania pm2 logs pixelmania   --lines 100 --nostream   # login/route only
```

```bash
# Caddy (both sites log to journald; staging has no file log by design).
journalctl -u caddy --since "10 minutes ago" --no-pager | grep staging-api
```

---

## 6. Restarting after a `.env` change

`.env` is NOT part of a deploy — it lives in `shared/.env` per environment.
**`pm2 restart --update-env` does not re-read it.** Only loading `ecosystem.config.js` does.

```bash
# Edit staging's env.
sudo -u pixelmania-stg nano /home/pixelmania-stg/PixelManiaServer/shared/.env
```

```bash
# Apply it (delete + start from the ecosystem file, preserving the release env).
sudo -u pixelmania-stg -H bash -lc '
  set -a; . /home/pixelmania-stg/PixelManiaServer/current/.release-env; set +a
  export PIXELMANIA_RELEASE_ROOT=/home/pixelmania-stg/PixelManiaServer
  export PIXELMANIA_BACKEND_ROOT=/home/pixelmania-stg/PixelManiaServer/current
  cd /home/pixelmania-stg/PixelManiaServer/current
  pm2 delete pixelmania >/dev/null 2>&1
  pm2 start ecosystem.config.js --only pixelmania --env production
  pm2 save'
```

```bash
# Verify from the server's OWN boot line, not from pm2 env.
sleep 3
sudo -u pixelmania-stg pm2 logs pixelmania --lines 40 --nostream | grep -iE "route enforcement|listening privately"
```

> For production, prefer a deploy. A stray `pm2 delete` as the `pixelmania` user is an outage.

---

## 7. Refresh staging data from production

```bash
# Destroys staging's database and replaces it with a production snapshot.
# Releases world ownership and flushes staging Redis automatically. Run OFF-PEAK.
sudo bash /home/pixelmania-stg/PixelManiaServer/current/staging/clone_production_to_staging.sh
```

```bash
# If blocks get rejected with "PostgreSQL rejected the world update.", the ownership
# fence was imported from production. The clone script does this now; run it manually
# if you restored a database some other way.
sudo -u postgres psql -d pixelmania_staging -c \
 "UPDATE pixelmania.worlds SET world_owner_epoch = 0, world_owner_token = '', world_owner_instance = '';"
redis-cli -n 1 FLUSHDB
```

```bash
# Compare staging against production.
for db in pixelmania pixelmania_staging; do
  echo "== $db =="
  for t in worlds accounts players inventory; do
    printf '  %-10s %s\n' "$t" "$(sudo -u postgres psql -tA -d $db -c "SELECT count(*) FROM pixelmania.$t;")"
  done
done
```

---

## 8. Godot client

```powershell
cd G:\PixelMania\pixel-mania
```

Point the **editor** at staging — Project Settings → filter `main run args`:

```
-- --pixelmania-api-base https://staging-api.pixelmaniagame.com --pixelmania-ws-url wss://staging-api.pixelmaniagame.com/ws
```

Clear that field to go back to production. It never affects exports (it lives under
`[editor]` in `project.godot`).

```powershell
# What will actually be packaged? Exports use the WORKING TREE, not your last commit.
git status --short
```

```powershell
# Release exports (what players get). --export-release cannot be mis-clicked.
$godot = "G:\PixelMania\Godot\bin\godot.windows.editor.x86_64.exe"   # adjust to your editor binary
& $godot --headless --export-release "Windows Desktop"      G:\Test\PixelMania.exe
& $godot --headless --export-release "com.pixelmania.game"  G:\Test\PixelMania.aab
```

```powershell
# Debug export — the ONLY way to test a packaged build against staging (Windows only).
& $godot --headless --export-debug "Windows Desktop" G:\Test\PixelMania-debug.exe
G:\Test\PixelMania-debug.exe -- --pixelmania-api-base https://staging-api.pixelmaniagame.com --pixelmania-ws-url wss://staging-api.pixelmaniagame.com/ws
```

```powershell
# PROVE the release build is really release: the override must be IGNORED.
# Expect "Connecting to PixelMania server: wss://api.pixelmaniagame.com/ws-a"
G:\Test\PixelMania.exe -- --pixelmania-api-base https://staging-api.pixelmaniagame.com
```

Before every export, confirm in `project.godot`:

```powershell
Select-String -Path project.godot -Pattern 'main_scene|window/size/mode'
# must show: run/main_scene="res://Scenes/ui/login/LoginScene.tscn"
```

---

## 9. Emergency

```bash
# Production edge down? Check Caddy first — staging shares this instance.
systemctl status caddy --no-pager -l | tail -20
cp -p /etc/caddy/Caddyfile.bak.pixelmania-staging /etc/caddy/Caddyfile   # restore pre-staging config
systemctl reload caddy
```

```powershell
# Bad release live? Roll back, then investigate.
.\rollback_release.ps1 68.183.141.114
```

```bash
# Worlds unjoinable (client freezes ~88%)? Reseed the Redis epoch from Postgres.
sudo -u postgres psql pixelmania -Atc "select lower(world_name), world_owner_epoch from pixelmania.worlds where world_owner_epoch > 0" \
  | while IFS='|' read -r w e; do redis-cli set "pixelmania:world_route_epoch:$w" "$((e + 10))" > /dev/null; echo "$w -> $((e + 10))"; done
```
