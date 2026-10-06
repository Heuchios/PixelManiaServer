"use strict";

function cleanName(value: unknown): string {
  const clean = String(value || "Guest").trim();
  return clean.length > 0 ? clean : "Guest";
}

function cleanAccountName(value: unknown): string {
  const clean = String(value || "").trim();
  return clean.length > 0 ? clean : "";
}

function cleanEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function cleanStableIdentityId(value: unknown, maxLength = 128): string {
  return cleanAccountName(value).slice(0, maxLength);
}

function stableIdentityKey(value: unknown): string {
  return cleanStableIdentityId(value).toLowerCase();
}

function stableIdentityEquals(left: unknown, right: unknown): boolean {
  const leftKey = stableIdentityKey(left);
  const rightKey = stableIdentityKey(right);
  return leftKey !== "" && leftKey === rightKey;
}

function isValidWorldName(value: unknown): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 32 && !/[^A-Za-z0-9]/.test(value);
}

function isValidDoorDestinationWorld(value: unknown): boolean {
  return typeof value === "string" && (value === "" || /^door:/i.test(value) || isValidWorldName(value.split(":")[0]));
}

// Internal normalization also reads legacy persisted world identifiers. Validate
// user input before calling this, so invalid names never alias another world.
function cleanWorld(value: unknown, maxWorldNameLength = 32): string {
  const clean = String(value || "START").trim().toUpperCase().replace(/\s+/g, "_");
  const safe = clean.replace(/[^A-Z0-9_-]/g, "").slice(0, maxWorldNameLength);
  return safe.length > 0 ? safe : "START";
}

function cleanStaticNetfoxWorld(value: unknown, maxWorldNameLength = 32): string {
  const clean = String(value || "").trim().toUpperCase();
  if (clean === "" || clean === "*" || clean === "ALL") return "";
  return cleanWorld(clean, maxWorldNameLength);
}

export = {
  isValidWorldName,
  isValidDoorDestinationWorld,
  cleanAccountName,
  cleanEmail,
  cleanName,
  cleanStableIdentityId,
  cleanStaticNetfoxWorld,
  cleanWorld,
  stableIdentityEquals,
  stableIdentityKey,
};
