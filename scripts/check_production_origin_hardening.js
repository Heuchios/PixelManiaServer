#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertCheck(condition, message) {
  if (!condition) {
    throw new Error(`[origin-hardening] ${message}`);
  }
  console.log(`[origin-hardening] ok: ${message}`);
}

function findBash() {
  if (process.platform !== "win32") return "bash";
  return [
    process.env.GIT_BASH_PATH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null;
}

const shellScript = read("scripts/harden_production_origin.sh");
const powershell = read("harden_production_origin.ps1");
const docs = read("docs/production_origin_hardening.md");
const packageJson = JSON.parse(read("package.json"));

if (process.platform === "win32") {
  const powershellExecutable = process.env.ComSpec ? "powershell.exe" : "powershell";
  const parseCommand = [
    "$ErrorActionPreference = 'Stop'",
    `$null = [ScriptBlock]::Create([IO.File]::ReadAllText('${path.join(root, "harden_production_origin.ps1").replace(/'/gu, "''")}'))`,
  ].join("; ");
  const parseResult = childProcess.spawnSync(powershellExecutable, ["-NoProfile", "-NonInteractive", "-Command", parseCommand], {
    encoding: "utf8",
    windowsHide: true,
  });
  assertCheck(parseResult.status === 0, `Windows wrapper parses as PowerShell${parseResult.stderr ? `: ${parseResult.stderr.trim()}` : ""}`);
}

const bash = findBash();
if (bash) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-origin-hardening-"));
  const tempScript = path.join(tempDirectory, "hardening.sh");
  try {
    fs.writeFileSync(tempScript, `${shellScript.replace(/\r\n?/gu, "\n")}\n`, "utf8");
    const result = childProcess.spawnSync(bash, ["-n", tempScript], {
      encoding: "utf8",
      windowsHide: true,
    });
    assertCheck(result.status === 0, `hardening shell script passes bash -n${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
} else {
  console.log("[origin-hardening] skip: bash syntax check (bash unavailable)");
}

assertCheck(shellScript.includes("https://www.cloudflare.com/ips-v4"), "IPv4 policy uses Cloudflare's published range list");
assertCheck(shellScript.includes("https://www.cloudflare.com/ips-v6"), "IPv6 policy uses Cloudflare's published range list");
assertCheck(shellScript.includes("systemd-run") && shellScript.includes("auto-rollback"), "apply arms an automatic rollback timer");
assertCheck(shellScript.includes("PermitRootLogin prohibit-password"), "root SSH is restricted to key authentication");
assertCheck(shellScript.includes("PasswordAuthentication no"), "SSH password authentication is disabled");
assertCheck(shellScript.includes("pixelmania-cloudflare-http") && shellScript.includes("pixelmania-cloudflare-https"), "Cloudflare firewall rules are named and replaceable");
assertCheck((shellScript.match(/while IFS= read -r cidr \|\| \[ -n "\$cidr" \]/gu) || []).length === 2, "Cloudflare range loops retain a final line without a trailing newline");
assertCheck(shellScript.includes("24566/udp"), "unused Netfox ingress is removed and verified closed");

const sshCheckIndex = powershell.indexOf("Test-FreshSshConnection");
const cloudflareCheckIndex = powershell.indexOf("Test-CloudflareHealth");
const bypassCheckIndex = powershell.indexOf("Test-DirectOriginBlocked");
const confirmCallIndex = powershell.lastIndexOf('Invoke-RemoteHardening -RemoteMode "Confirm"');
assertCheck(sshCheckIndex >= 0 && cloudflareCheckIndex >= 0 && bypassCheckIndex >= 0, "Windows apply wrapper verifies SSH, Cloudflare, and origin blocking");
assertCheck(powershell.includes('"--resolve", "$($uri.Host):443:$RemoteIp"'), "direct-origin verification pins TLS to the origin IP");
assertCheck(confirmCallIndex > bypassCheckIndex, "automatic rollback is confirmed only after external verification");
assertCheck(powershell.includes("BatchMode=yes"), "SSH verification cannot silently fall back to a password prompt");

assertCheck(docs.includes("automatic rollback") && docs.includes("Cloudflare"), "operator documentation covers rollback and Cloudflare ownership");
assertCheck(packageJson.scripts["check:origin-hardening"] === "node scripts/check_production_origin_hardening.js", "package exposes the origin-hardening check");
assertCheck(packageJson.scripts["check:security"].includes("npm run check:origin-hardening"), "security gate includes origin-hardening validation");

console.log("[origin-hardening] success");
