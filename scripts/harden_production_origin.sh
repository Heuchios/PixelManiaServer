#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-status}"
BACKUP_ARGUMENT="${2:-}"
STATE_DIR="/var/lib/pixelmania-origin-hardening"
BACKUP_ROOT="/var/backups/pixelmania-origin-hardening"
SSH_DROPIN="/etc/ssh/sshd_config.d/00-pixelmania-hardening.conf"
INSTALL_PATH="/usr/local/sbin/pixelmania-origin-hardening"
CF_IPV4_URL="https://www.cloudflare.com/ips-v4"
CF_IPV6_URL="https://www.cloudflare.com/ips-v6"
ROLLBACK_DELAY="${PIXELMANIA_HARDENING_ROLLBACK_DELAY:-5m}"
PENDING_BACKUP_FILE="$STATE_DIR/pending-backup"
PENDING_UNIT_FILE="$STATE_DIR/pending-unit"
CONFIRMED_BACKUP_FILE="$STATE_DIR/confirmed-backup"

log() {
  printf '[origin-hardening] %s\n' "$*"
}

die() {
  printf '[origin-hardening] ERROR: %s\n' "$*" >&2
  return 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "run this command as root"
  fi
}

require_commands() {
  local command_name
  for command_name in curl python3 realpath sshd systemctl systemd-run ufw; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command is unavailable: $command_name"
  done
}

initialize_state() {
  install -d -o root -g root -m 0700 "$STATE_DIR" "$BACKUP_ROOT"
}

read_pending_unit() {
  if [ -f "$PENDING_UNIT_FILE" ]; then
    tr -d '\r\n' < "$PENDING_UNIT_FILE"
  fi
}

cancel_pending_timer() {
  local pending_unit
  pending_unit="$(read_pending_unit)"
  if [ -n "$pending_unit" ]; then
    systemctl stop "${pending_unit}.timer" >/dev/null 2>&1 || true
    systemctl stop "${pending_unit}.service" >/dev/null 2>&1 || true
    systemctl reset-failed "${pending_unit}.timer" "${pending_unit}.service" >/dev/null 2>&1 || true
  fi
  rm -f "$PENDING_UNIT_FILE"
}

validate_backup_path() {
  local requested="$1"
  local resolved
  [ -n "$requested" ] || die "a backup directory is required"
  resolved="$(realpath -e "$requested")" || die "backup directory does not exist: $requested"
  case "$resolved" in
    "$BACKUP_ROOT"/*) printf '%s\n' "$resolved" ;;
    *) die "backup path must be below $BACKUP_ROOT" ;;
  esac
}

restore_backup() {
  local backup
  backup="$(validate_backup_path "$1")"
  [ -f "$backup/user.rules" ] || die "backup is missing user.rules: $backup"
  [ -f "$backup/user6.rules" ] || die "backup is missing user6.rules: $backup"

  install -o root -g root -m 0640 "$backup/user.rules" /etc/ufw/user.rules
  install -o root -g root -m 0640 "$backup/user6.rules" /etc/ufw/user6.rules
  if [ -f "$backup/ssh-dropin.absent" ]; then
    rm -f "$SSH_DROPIN"
  else
    [ -f "$backup/ssh-dropin.conf" ] || die "backup is missing SSH drop-in state: $backup"
    install -o root -g root -m 0600 "$backup/ssh-dropin.conf" "$SSH_DROPIN"
  fi

  sshd -t
  systemctl reload ssh
  ufw reload >/dev/null
  rm -f "$PENDING_BACKUP_FILE" "$PENDING_UNIT_FILE"
  log "restored firewall and SSH configuration from $backup"
}

validate_range_file() {
  local file="$1"
  local version="$2"
  python3 - "$file" "$version" <<'PY'
import ipaddress
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
version = int(sys.argv[2])
entries = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
minimum = 10 if version == 4 else 5
if len(entries) < minimum:
    raise SystemExit(f"Cloudflare IPv{version} list is unexpectedly short: {len(entries)}")
for entry in entries:
    network = ipaddress.ip_network(entry, strict=True)
    if network.version != version:
        raise SystemExit(f"unexpected address family in IPv{version} list: {entry}")
if len(entries) != len(set(entries)):
    raise SystemExit(f"Cloudflare IPv{version} list contains duplicate ranges")
PY
}

fetch_cloudflare_ranges() {
  local target_dir="$1"
  curl -fsSL --connect-timeout 10 --max-time 30 "$CF_IPV4_URL" -o "$target_dir/cloudflare-ipv4.txt"
  curl -fsSL --connect-timeout 10 --max-time 30 "$CF_IPV6_URL" -o "$target_dir/cloudflare-ipv6.txt"
  sed -i 's/\r$//' "$target_dir/cloudflare-ipv4.txt" "$target_dir/cloudflare-ipv6.txt"
  validate_range_file "$target_dir/cloudflare-ipv4.txt" 4
  validate_range_file "$target_dir/cloudflare-ipv6.txt" 6
}

delete_ufw_rules_matching() {
  local pattern="$1"
  local line
  local number
  while true; do
    line="$(ufw status numbered | grep -E "$pattern" | head -n 1 || true)"
    [ -n "$line" ] || break
    number="$(printf '%s\n' "$line" | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/')"
    [[ "$number" =~ ^[0-9]+$ ]] || die "could not parse UFW rule number from: $line"
    ufw --force delete "$number" >/dev/null
  done
}

install_ssh_policy() {
  local temporary
  temporary="$(mktemp)"
  cat > "$temporary" <<'EOF'
# Managed by PixelMania production origin hardening.
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
AllowTcpForwarding yes
EOF
  install -o root -g root -m 0600 "$temporary" "$SSH_DROPIN"
  rm -f "$temporary"
  sshd -t
  systemctl reload ssh
}

install_cloudflare_ufw_policy() {
  local range_file="$1"
  local cidr

  ufw status | grep -Eq '^OpenSSH[[:space:]]+ALLOW[[:space:]]+Anywhere' \
    || die "the existing public OpenSSH recovery rule is missing"
  delete_ufw_rules_matching '# pixelmania-ssh-key'
  ufw allow 80/tcp comment 'pixelmania-hardening-temporary-http' >/dev/null
  ufw allow 443/tcp comment 'pixelmania-hardening-temporary-https' >/dev/null

  delete_ufw_rules_matching '# pixelmania-cloudflare-(http|https)'

  while IFS= read -r cidr || [ -n "$cidr" ]; do
    [ -n "$cidr" ] || continue
    ufw allow proto tcp from "$cidr" to any port 80 comment 'pixelmania-cloudflare-http' >/dev/null
    ufw allow proto tcp from "$cidr" to any port 443 comment 'pixelmania-cloudflare-https' >/dev/null
  done < "$range_file/cloudflare-ipv4.txt"

  while IFS= read -r cidr || [ -n "$cidr" ]; do
    [ -n "$cidr" ] || continue
    ufw allow proto tcp from "$cidr" to any port 80 comment 'pixelmania-cloudflare-http' >/dev/null
    ufw allow proto tcp from "$cidr" to any port 443 comment 'pixelmania-cloudflare-https' >/dev/null
  done < "$range_file/cloudflare-ipv6.txt"

  delete_ufw_rules_matching '^\[[[:space:]]*[0-9]+\][[:space:]]+(80|80/tcp)([[:space:]]+\(v6\))?[[:space:]]+ALLOW IN[[:space:]]+Anywhere'
  delete_ufw_rules_matching '^\[[[:space:]]*[0-9]+\][[:space:]]+(443|443/tcp)([[:space:]]+\(v6\))?[[:space:]]+ALLOW IN[[:space:]]+Anywhere'
  delete_ufw_rules_matching '^\[[[:space:]]*[0-9]+\][[:space:]]+24566/udp([[:space:]]+\(v6\))?[[:space:]]+ALLOW IN'
  ufw reload >/dev/null
}

verify_effective_policy() {
  local ssh_effective
  local managed_rule_count
  ssh_effective="$(sshd -T)"
  grep -qx 'passwordauthentication no' <<< "$ssh_effective" || die "effective SSH policy still allows password authentication"
  grep -qx 'kbdinteractiveauthentication no' <<< "$ssh_effective" || die "effective SSH policy still allows keyboard-interactive authentication"
  grep -qx 'permitrootlogin without-password' <<< "$ssh_effective" \
    || grep -qx 'permitrootlogin prohibit-password' <<< "$ssh_effective" \
    || die "effective root SSH policy is not key-only"
  grep -qx 'x11forwarding no' <<< "$ssh_effective" || die "effective SSH policy still allows X11 forwarding"

  managed_rule_count="$(ufw status | grep -c '# pixelmania-cloudflare-' || true)"
  [ "$managed_rule_count" -ge 30 ] || die "too few Cloudflare UFW rules are active: $managed_rule_count"
  if ufw status numbered | grep -Eq '^\[[[:space:]]*[0-9]+\][[:space:]]+(80|80/tcp|443|443/tcp)([[:space:]]+\(v6\))?[[:space:]]+ALLOW IN[[:space:]]+Anywhere'; then
    die "a public catch-all HTTP or HTTPS rule remains active"
  fi
  if ufw status numbered | grep -Eq '24566/udp'; then
    die "unused Netfox UDP port 24566 is still allowed"
  fi
}

show_status() {
  local pending_unit=""
  log "effective SSH authentication policy"
  sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|x11forwarding|allowtcpforwarding) '
  log "managed firewall rules"
  ufw status | grep -E 'Status:|pixelmania-cloudflare-|pixelmania-ssh-key|OpenSSH|24566' || true
  pending_unit="$(read_pending_unit)"
  if [ -n "$pending_unit" ]; then
    log "automatic rollback pending: ${pending_unit}.timer"
    systemctl status "${pending_unit}.timer" --no-pager --lines=0 || true
  else
    log "no automatic rollback timer is pending"
  fi
}

apply_policy() {
  local timestamp
  local backup
  local rollback_unit
  local range_dir

  ufw status | grep -q '^Status: active' || die "UFW must already be active before hardening"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="$BACKUP_ROOT/$timestamp"
  rollback_unit="pixelmania-origin-hardening-rollback-${timestamp,,}"
  range_dir="$(mktemp -d)"

  fetch_cloudflare_ranges "$range_dir"
  install -d -o root -g root -m 0700 "$backup"
  install -o root -g root -m 0640 /etc/ufw/user.rules "$backup/user.rules"
  install -o root -g root -m 0640 /etc/ufw/user6.rules "$backup/user6.rules"
  if [ -f "$SSH_DROPIN" ]; then
    install -o root -g root -m 0600 "$SSH_DROPIN" "$backup/ssh-dropin.conf"
  else
    touch "$backup/ssh-dropin.absent"
  fi
  install -o root -g root -m 0600 "$range_dir/cloudflare-ipv4.txt" "$backup/cloudflare-ipv4.txt"
  install -o root -g root -m 0600 "$range_dir/cloudflare-ipv6.txt" "$backup/cloudflare-ipv6.txt"

  cancel_pending_timer
  printf '%s\n' "$backup" > "$PENDING_BACKUP_FILE"
  printf '%s\n' "$rollback_unit" > "$PENDING_UNIT_FILE"
  systemd-run \
    --unit="$rollback_unit" \
    --on-active="$ROLLBACK_DELAY" \
    --property=Type=oneshot \
    "$INSTALL_PATH" auto-rollback "$backup" >/dev/null
  log "automatic rollback scheduled in $ROLLBACK_DELAY using $backup"

  rollback_on_error() {
    local exit_code=$?
    trap - ERR
    log "apply failed; restoring the saved configuration"
    restore_backup "$backup" || true
    cancel_pending_timer
    rm -rf "$range_dir"
    exit "$exit_code"
  }
  trap rollback_on_error ERR

  install_ssh_policy
  install_cloudflare_ufw_policy "$range_dir"
  verify_effective_policy
  trap - ERR
  rm -rf "$range_dir"
  log "policy applied; verify a fresh SSH session and public HTTPS, then run: $INSTALL_PATH confirm"
}

confirm_policy() {
  local backup=""
  if [ -f "$PENDING_BACKUP_FILE" ]; then
    backup="$(tr -d '\r\n' < "$PENDING_BACKUP_FILE")"
  fi
  [ -n "$backup" ] || die "there is no pending hardening change to confirm"
  cancel_pending_timer
  printf '%s\n' "$backup" > "$CONFIRMED_BACKUP_FILE"
  rm -f "$PENDING_BACKUP_FILE"
  verify_effective_policy
  log "policy confirmed; automatic rollback cancelled"
}

main() {
  require_root
  require_commands
  initialize_state
  case "$MODE" in
    apply) apply_policy ;;
    confirm) confirm_policy ;;
    status) show_status ;;
    rollback)
      cancel_pending_timer
      restore_backup "$BACKUP_ARGUMENT"
      ;;
    auto-rollback)
      log "confirmation deadline expired; restoring the previous policy"
      restore_backup "$BACKUP_ARGUMENT"
      ;;
    *) die "usage: $0 {apply|confirm|status|rollback <backup-directory>}" ;;
  esac
}

main "$@"
