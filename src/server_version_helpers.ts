"use strict";

type VersionParts = [number, number, number];

function getClientVersion(data: { client_version?: unknown; version?: unknown } | null | undefined): string {
  return String(data?.client_version || data?.version || "").trim();
}

function parseVersionParts(value: unknown): VersionParts | null {
  const clean = String(value || "").trim().replace(/^v/i, "");
  if (clean === "") return null;

  const core = clean.split(/[+-]/)[0];
  if (!/^\d+(?:\.\d+){0,2}$/.test(core)) return null;
  const parts = core.split(".").map(Number);

  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3) as VersionParts;
}

function compareVersions(a: unknown, b: unknown): number | null {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return null;

  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function isClientVersionAllowed(clientVersion: unknown, minClientVersion: unknown): boolean {
  const comparison = compareVersions(clientVersion, minClientVersion);
  return comparison !== null && comparison >= 0;
}

export = {
  compareVersions,
  getClientVersion,
  isClientVersionAllowed,
  parseVersionParts,
};
