# Versioned Production Releases

PixelMania production deployments are immutable releases. The deployer packages
the exact backend Git commit, uploads archives to the server, validates a new
release away from live traffic, and switches a `current` symlink only after the
release is ready.

## Layout

For the default `pixelmania` deployment account and `RemoteDir`, the server layout is:

```text
/home/pixelmania/PixelManiaServer/
  bin/rollback_release.sh
  current -> releases/<release-id>
  previous -> releases/<previous-release-id>
  incoming/
  releases/
  shared/
    .env
    current_release
    deployments.log
    last_successful_release.json
    ops_dashboard_admin.json
    ops_dashboard_audit.log
```

The first versioned deployment keeps the old `~/PixelManiaServer` tree as the
legacy rollback target. After another successful deployment, `previous` points
to the prior immutable release.

## Deploy

The backend repository must be clean and committed. Generated JavaScript must
match its TypeScript source because the archive is built from `HEAD`, not from
uncommitted working files.

```powershell
cd G:\PixelMania\PixelManiaServer
.\deploy_to_droplet.ps1 68.183.141.114
```

The deployer logs in as the unprivileged `pixelmania` account by default. On a
server that still runs PM2 as root, perform the one-time migration first:

```powershell
.\migrate_production_to_service_user.ps1 68.183.141.114
```

The migration refuses to cut over with active players, performs an isolated
snapshot restore test, enables hourly main-server snapshots, and restores the
root PM2 processes automatically if the new processes fail health checks.

Useful options:

```powershell
.\deploy_to_droplet.ps1 68.183.141.114 -RunSmokeChecks
.\deploy_to_droplet.ps1 68.183.141.114 -RunRemoteFullChecks
.\deploy_to_droplet.ps1 68.183.141.114 -ForceClientUpdate
```

The normal deploy runs the full security and TypeScript gate locally. The
remote server installs production dependencies and runs focused release,
item-database, and anti-dupe checks before activation. `-RunRemoteFullChecks`
also installs development dependencies and repeats the full security suite on
the server; use it only when the server has enough memory.

## Roll Back

View the active pointers without changing anything:

```powershell
.\rollback_release.ps1 68.183.141.114 -Status
```

Swap `current` and `previous`, restart the existing PM2 apps, and verify health:

```powershell
.\rollback_release.ps1 68.183.141.114
```

The equivalent command on the server is:

```bash
bash /home/pixelmania/PixelManiaServer/bin/rollback_release.sh --yes
```

If the rollback target fails its health check, the rollback command restores
the original pointers and starts the original release again.

## Safety Rules

- Never edit files under `releases/` or through `current`.
- Keep secrets only in `shared/.env`; release archives never contain `.env`.
- Persistent game data remains outside releases through `PIXELMANIA_DATA_DIR`.
- Run PM2 as `pixelmania`; reserve root SSH for operating-system administration.
- Keep periodic snapshots enabled only on the main authority process. Route
  replicas intentionally force their snapshot interval to `0`.
- A failed activation automatically invokes rollback before the deploy exits.
- Do not delete the `current` or `previous` target while PM2 is using it.
- Run `npm run check:release-deploy` after changing deployment or PM2 files.

When enabling dashboard controls, leave `OPS_DASHBOARD_DEPLOY_COMMAND`,
`OPS_DASHBOARD_RESTART_COMMAND`, `OPS_DASHBOARD_START_COMMAND`, and
`OPS_DASHBOARD_ROLLBACK_COMMAND` blank. The PM2 configuration then disables
in-place dashboard deploys and supplies release-aware restart and rollback
commands. Release mode also ignores stale overrides for these commands so an
older `.env` cannot reactivate Git-based deployment inside an immutable release.
