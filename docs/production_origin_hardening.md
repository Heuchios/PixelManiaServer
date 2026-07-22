# Production Origin Hardening

PixelMania serves public API and WebSocket traffic through Cloudflare. The
origin firewall accepts ports 80 and 443 only from Cloudflare's published IPv4
and IPv6 networks. SSH remains public for deployment and emergency access, but
it accepts keys only. Tailscale remains available as a separate recovery path.

The server-side policy is managed by
`/usr/local/sbin/pixelmania-origin-hardening`. It does not modify Caddy,
PixelMania releases, PM2, PostgreSQL, Redis, or persistent game data.

## Apply Safely

Run the wrapper from the committed backend repository:

```powershell
cd G:\PixelMania\PixelManiaServer
.\harden_production_origin.ps1 68.183.141.114
```

Apply creates a timestamped backup below
`/var/backups/pixelmania-origin-hardening`, then starts a five-minute automatic
rollback timer. The wrapper opens a fresh key-only SSH session, checks public
health through Cloudflare, runs the post-deploy smoke checks, and proves that a
TLS request pinned directly to the origin IP is blocked. Only then does it
cancel the automatic rollback.

The policy downloads the current ranges from Cloudflare's official
`ips-v4` and `ips-v6` endpoints each time it is applied. Re-run the command
after Cloudflare announces a range change.

## Inspect Or Recover

Show the effective SSH settings, managed UFW rules, and any pending rollback:

```powershell
.\harden_production_origin.ps1 68.183.141.114 -Mode Status
```

If external verification is interrupted but all checks are known to pass, the
same verification can confirm the pending policy:

```powershell
.\harden_production_origin.ps1 68.183.141.114 -Mode Confirm
```

Restore a specific backup reported by the apply command:

```powershell
.\harden_production_origin.ps1 68.183.141.114 -Mode Rollback `
  -RollbackBackup /var/backups/pixelmania-origin-hardening/20260721T120000Z
```

The equivalent emergency command from a root console is:

```bash
/usr/local/sbin/pixelmania-origin-hardening rollback \
  /var/backups/pixelmania-origin-hardening/20260721T120000Z
```

Do not manually add public `Anywhere` rules for ports 80 or 443. Cloudflare
HTTP/3 terminates at the edge; the Cloudflare-to-origin connection uses the
managed TCP rules. Port 24566/UDP remains closed while Netfox is disabled.

## SSH Rules

- Root remains available with an authorized SSH key for OS recovery.
- Password and keyboard-interactive authentication are disabled.
- The normal release deploy continues to use the unprivileged `pixelmania`
  account.
- TCP forwarding remains enabled because the private operations dashboard uses
  an SSH tunnel.
- X11 forwarding is disabled.

This host-level UFW policy is independent of a DigitalOcean Cloud Firewall. If
a cloud firewall is attached later, mirror the same Cloudflare web ranges and
retain TCP 22 only for trusted operator sources or a verified Tailscale path.
