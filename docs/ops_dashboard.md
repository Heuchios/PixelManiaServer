# PixelMania Ops Dashboard

The ops dashboard is a private control surface for PixelMania server status, PM2 controls, logs, deploy, and rollback.

## Safety defaults

- The dashboard refuses to start unless `OPS_DASHBOARD_ADMIN_PASSWORD_HASH`, `OPS_DASHBOARD_TOKEN`, or `OPS_DASHBOARD_TOKEN_HASH` is set.
- Real login starts from `OPS_DASHBOARD_ADMIN_USERNAME` plus `OPS_DASHBOARD_ADMIN_PASSWORD_HASH`, then moves into a persistent account file with server-side sessions and signed HttpOnly cookies.
- Start/stop/restart/deploy/rollback buttons are read-only until `OPS_DASHBOARD_ALLOW_CONTROL=true`.
- The deploy button stays disabled until `OPS_DASHBOARD_DEPLOY_COMMAND` is set. The included deploy helper pulls from GitHub with fast-forward-only safety checks.
- The rollback button stays disabled until `OPS_DASHBOARD_ROLLBACK_COMMAND` is set. The included rollback helper resets the production checkout to `HEAD~1` by default, validates, then reloads main/ws-a/ws-b.
- Keep `OPS_DASHBOARD_HOST=127.0.0.1` and put it behind SSH tunnel, VPN, Cloudflare Access, or another admin-only HTTPS layer.

## Local run

```powershell
$env:OPS_DASHBOARD_ADMIN_USERNAME="admin"
$env:OPS_DASHBOARD_ADMIN_PASSWORD_HASH="<hash from npm run ops:password>"
npm run ops:dashboard
```

Open `http://127.0.0.1:9090` and sign in.

## Password login setup

Generate a strong admin password and hash:

```bash
npm run ops:password
```

Put `OPS_DASHBOARD_ADMIN_USERNAME=admin` and the generated `OPS_DASHBOARD_ADMIN_PASSWORD_HASH=...` in production `.env`, then sign in with the raw password shown by the command. If you already have a password, hash it with:

```bash
npm run ops:password -- "your-existing-password"
```

Sessions default to 12 hours. Set `OPS_DASHBOARD_SESSION_TTL_HOURS` to adjust it. Keep `OPS_DASHBOARD_COOKIE_SECURE=false` for localhost/SSH tunnels; set it to `true` only when the dashboard is served over HTTPS.

After signing in, use the Admin account panel to set your real email, send a verification link, change password, request a reset link, or revoke all sessions. `OPS_DASHBOARD_ACCOUNT_FILE` stores the account state, active session hashes, pending email verification, and password reset token hashes.

Verification and reset links are sent with the same `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` settings used by the main server. If SMTP is not configured, the dashboard writes the link to PM2 logs.

Set `OPS_DASHBOARD_LOGIN_CODE_ENABLED=true` to require a one-time email code after password login. The code uses the verified admin email and expires after `OPS_DASHBOARD_LOGIN_CODE_TTL_MINUTES`.

Back up `OPS_DASHBOARD_ACCOUNT_FILE`; it is the durable admin account and session store. Install the hourly local backup cron job with:

```bash
sudo bash scripts/install_ops_dashboard_backup_cron.sh
```

Backups default to `/var/backups/pixelmania/ops-dashboard`, keep 30 days, and write a checksum next to each backup.

## Legacy token setup

Generate a strong token and hash:

```bash
npm run ops:token
```

Put `OPS_DASHBOARD_TOKEN_HASH=...` in production `.env` only if you need temporary legacy bearer-token access. If you already have a token, hash it with:

```bash
npm run ops:token -- "your-existing-token"
```

## PM2 run

```bash
pm2 startOrReload ecosystem.ops.config.js --env production
pm2 save
```

## Ops-only droplet deploy

Use this for the first real-server read-only dashboard test. It copies only the ops dashboard files, sets `OPS_DASHBOARD_ALLOW_CONTROL=false`, starts `pixelmania-ops`, and does not restart the game server:

```powershell
.\deploy_ops_dashboard_readonly.ps1 <droplet-ip>
```

If you already generated a token:

```powershell
.\deploy_ops_dashboard_readonly.ps1 <droplet-ip> -OpsDashboardToken "your-token"
```

After it finishes, open a tunnel:

```bash
ssh -L 9090:127.0.0.1:9090 root@<droplet-ip>
```

Then browse to `http://127.0.0.1:9090`.

Enable the guarded server controls after restart has been tested:

```powershell
.\enable_ops_dashboard_server_controls.ps1 <droplet-ip>
```

This enables Restart, Start, Stop, Deploy, and Rollback. Stop still requires typing `STOP`, Deploy requires typing `DEPLOY`, and Rollback requires typing `ROLLBACK`.

## HTTPS hostname

Keep the dashboard bound to `127.0.0.1`; expose it through Caddy instead of opening the Node process directly. First create a DNS A record for the private ops hostname, for example:

```text
ops.pixelmaniagame.com -> 68.183.141.114
```

After DNS resolves, run:

```bash
sudo bash scripts/install_ops_dashboard_https.sh ops.pixelmaniagame.com
```

The helper adds a marked Caddy site block, sets `OPS_DASHBOARD_PUBLIC_BASE_URL=https://ops.pixelmaniagame.com`, turns on `OPS_DASHBOARD_COOKIE_SECURE=true`, reloads Caddy, and reloads `pixelmania-ops`.

## Main env values

- `OPS_DASHBOARD_HEALTH_URL`: defaults to `http://127.0.0.1:8080/health`.
- `OPS_DASHBOARD_ADMIN_USERNAME`: defaults to `admin`.
- `OPS_DASHBOARD_ADMIN_EMAIL`: optional first email for the initial account. If blank, sign in with the username first, then set email in the dashboard.
- `OPS_DASHBOARD_ADMIN_PASSWORD_HASH`: scrypt password hash generated by `npm run ops:password`.
- `OPS_DASHBOARD_ACCOUNT_FILE`: persistent account/session store. Defaults to `ops_dashboard_admin.json`.
- `OPS_DASHBOARD_SESSION_SECRET`: optional session signing secret. Defaults to deriving from configured auth material.
- `OPS_DASHBOARD_SESSION_TTL_HOURS`: defaults to `12`.
- `OPS_DASHBOARD_COOKIE_SECURE`: set to `true` only behind HTTPS.
- `OPS_DASHBOARD_PUBLIC_BASE_URL`: base URL used for email verification and reset links. Defaults to `http://127.0.0.1:9090`.
- `OPS_DASHBOARD_EMAIL_VERIFICATION_TTL_MINUTES`: defaults to `60`.
- `OPS_DASHBOARD_PASSWORD_RESET_TTL_MINUTES`: defaults to `30`.
- `OPS_DASHBOARD_MIN_PASSWORD_LENGTH`: defaults to `10`.
- `OPS_DASHBOARD_LOGIN_CODE_ENABLED`: defaults to `false`. When `true`, verified-email accounts must enter an emailed one-time login code after password login.
- `OPS_DASHBOARD_LOGIN_CODE_TTL_MINUTES`: defaults to `10`.
- `OPS_DASHBOARD_ACCOUNT_BACKUP_DIR`: defaults to `/var/backups/pixelmania/ops-dashboard`.
- `OPS_DASHBOARD_ACCOUNT_BACKUP_RETENTION_DAYS`: defaults to `30`.
- `OPS_DASHBOARD_ACCOUNT_BACKUP_SCHEDULE`: cron schedule for the admin account backup. Defaults to hourly at minute 17.
- `OPS_DASHBOARD_DOMAIN`: optional HTTPS hostname used by `scripts/install_ops_dashboard_https.sh`. Defaults to `ops.pixelmaniagame.com`.
- `OPS_DASHBOARD_ROUTE_TARGETS`: semicolon-separated route dashboard targets in `label|pm2_app|health_url|ws_url` format. Defaults include `ws-a`/`pixelmania-a` on `18091` and `ws-b`/`pixelmania-b` on `18092`.
- `OPS_DASHBOARD_PM2_APP`: defaults to `pixelmania`.
- `OPS_DASHBOARD_ALLOW_CONTROL`: enables PM2 controls when set to `true`.
- `OPS_DASHBOARD_ALLOWED_ACTIONS`: comma-separated actions allowed when controls are enabled. Defaults to `restart`.
- `OPS_DASHBOARD_RESTART_APPS`: comma-separated app labels shown for the Restart button. Defaults to `pixelmania,pixelmania-a,pixelmania-b`.
- `OPS_DASHBOARD_RESTART_COMMAND`: command run by the Restart button. Defaults to reloading `ecosystem.config.js`, then running `scripts/start_route_production_instances.sh` so `ws-a` and `ws-b` keep their route-specific ports, URLs, and data directories.
- `OPS_DASHBOARD_START_COMMAND`: command run by the Start button. Defaults to the same grouped main + route startup path as Restart.
- `OPS_DASHBOARD_STOP_COMMAND`: command run by the Stop button. Defaults to stopping `pixelmania`, `pixelmania-a`, and `pixelmania-b`, then saving PM2 state.
- `OPS_DASHBOARD_ALLOW_STOP_WITH_PLAYERS`: defaults to `false`, which blocks Stop while the main server or any route server reports players online.
- `OPS_DASHBOARD_ALLOW_DEPLOY_WITH_PLAYERS`: defaults to `false`, which blocks Deploy while the main server or any route server reports players online.
- `OPS_DASHBOARD_ALLOW_ROLLBACK_WITH_PLAYERS`: defaults to `false`, which blocks Rollback while the main server or any route server reports players online.
- `OPS_DASHBOARD_CONFIRM_ACTIONS`: comma-separated actions that require typing the uppercase action name. Defaults to `stop,deploy,rollback`.
- `OPS_DASHBOARD_DEPLOY_COMMAND`: command run by the Deploy button. Defaults to `bash scripts/ops_dashboard_git_deploy.sh`, which fetches `origin/main`, fast-forwards only when safe, runs validation, then reloads `pixelmania`, `ws-a`, and `ws-b`.
- `OPS_DASHBOARD_ROLLBACK_COMMAND`: command run by the Rollback button. Defaults to `bash scripts/ops_dashboard_git_rollback.sh`, which blocks when players are online, saves the current commit as `ops-rollback-return`, resets to `HEAD~1` or `OPS_ROLLBACK_TARGET`, validates, then reloads `pixelmania`, `ws-a`, and `ws-b`.
- `OPS_ROLLBACK_TARGET`: optional rollback target. Defaults to `HEAD~1`; the helper only accepts an ancestor of the currently deployed commit.
- `OPS_DASHBOARD_LOG_FILE`: optional direct log file tail; PM2 logs are used when blank.

## Recommended rollout order

1. Start read-only with `OPS_DASHBOARD_ALLOW_CONTROL=false`.
2. Verify status, health, and logs.
3. Put the dashboard behind admin-only HTTPS or an SSH tunnel.
4. Set `OPS_DASHBOARD_ALLOW_CONTROL=true`.
5. Test restart while players are offline or during a maintenance window.
6. Enable Deploy only after restart/start/stop controls are proven.
7. Test Rollback during a no-player maintenance window, then use Deploy to roll forward again.
