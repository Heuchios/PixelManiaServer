"use strict";

import crypto = require("node:crypto");
import fs = require("node:fs");
import path = require("node:path");

type WarnFunction = (...args: unknown[]) => void;
type JsonRecord = Record<string, any>;

interface PersistenceWaitSummary {
  ok: boolean;
  total: number;
  failed: number;
}

interface WorldLoadRevisionDecision {
  source: "database" | "memory" | "empty";
  reason: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function backupCorruptJsonFile(filePath: string, warn: WarnFunction = console.warn): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  } catch (error) {
    warn(`Could not back up corrupt JSON ${filePath}:`, errorMessage(error));
  }
}

function readJsonFile(filePath: string, warn: WarnFunction = console.warn): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    warn(`Could not read ${filePath}:`, errorMessage(error));
    backupCorruptJsonFile(filePath, warn);
    return null;
  }
}

function writeJsonFileAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function clonePersistenceSnapshot<T>(data: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(data);
  }
  return JSON.parse(JSON.stringify(data)) as T;
}

function normalizeWorldRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) return 0;
  return revision;
}

function resolveWorldLoadRevision(input: unknown): WorldLoadRevisionDecision {
  const details = isRecord(input) ? input : {};
  const memoryExists = details.memory_exists === true;
  const databaseFound = details.database_found === true;
  const memoryRevision = normalizeWorldRevision(details.memory_revision);
  const databaseRevision = normalizeWorldRevision(details.database_revision);
  const memoryAuthoritative = details.memory_authoritative === true;

  if (!databaseFound) {
    if (memoryExists && memoryRevision > 0 && memoryAuthoritative) {
      return { source: "memory", reason: "database_missing_preserve_owned_memory" };
    }
    return { source: "empty", reason: "database_missing" };
  }
  if (!memoryExists || databaseRevision >= memoryRevision) {
    return { source: "database", reason: memoryExists ? "database_revision_current" : "memory_missing" };
  }
  if (memoryAuthoritative) {
    return { source: "memory", reason: "owned_memory_revision_newer" };
  }
  return { source: "database", reason: "uncommitted_memory_rejected" };
}

function createWorldPersistenceCoordinator() {
  const tails = new Map<string, Promise<void>>();

  function enqueue<T>(worldName: unknown, work: () => Promise<T> | T): Promise<T> {
    const key = String(worldName || "START").trim().toUpperCase() || "START";
    const previous = tails.get(key) || Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  }

  async function wait(worldName: unknown): Promise<void> {
    const key = String(worldName || "START").trim().toUpperCase() || "START";
    const tail = tails.get(key);
    if (tail) await tail;
  }

  async function waitAll(): Promise<void> {
    await Promise.all(Array.from(tails.values()));
  }

  function pendingCount(): number {
    return tails.size;
  }

  return { enqueue, pendingCount, wait, waitAll };
}

async function writeJsonFileAtomicAsync(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.promises.unlink(tempPath);
    } catch (_unlinkError) {
      // Best effort cleanup for failed async temp writes.
    }
    throw error;
  }
}

function trackPersistenceWrite(
  pendingPersistenceWrites: Set<Promise<unknown>>,
  promise: unknown,
  label = "persistence write",
  warn: WarnFunction = console.warn,
  failureLabels: Set<string> | null = null
): unknown {
  if (!promise || typeof (promise as { then?: unknown }).then !== "function") return promise;

  const tracked = Promise.resolve(promise)
    .then((value) => {
      if (value === false) {
        failureLabels?.add(label);
      } else {
        failureLabels?.delete(label);
      }
      return value;
    }, (error) => {
      failureLabels?.add(label);
      warn(`[persistence] ${label} failed:`, errorMessage(error));
      return false;
    })
    .finally(() => {
      pendingPersistenceWrites.delete(tracked);
    });

  pendingPersistenceWrites.add(tracked);
  return tracked;
}

async function waitForPersistenceWrites(
  pendingPersistenceWrites: Set<Promise<unknown>>,
  failureLabels: Set<string> | null = null
): Promise<PersistenceWaitSummary> {
  let total = 0;
  let observedFailures = 0;
  while (pendingPersistenceWrites.size > 0) {
    const pending = Array.from(pendingPersistenceWrites);
    const results = await Promise.allSettled(pending);
    total += results.length;
    observedFailures += results.filter((result) => (
      result.status === "rejected" || (result.status === "fulfilled" && result.value === false)
    )).length;
  }
  const failed = failureLabels ? failureLabels.size : observedFailures;
  return { ok: failed === 0, total, failed };
}

function getJsonSavedAtTime(filePath: string, warn: WarnFunction = console.warn): number {
  const data = readJsonFile(filePath, warn);
  if (isRecord(data)) {
    const savedAt = Date.parse(String(data.saved_at || data.updated_at || ""));
    if (Number.isFinite(savedAt)) return savedAt;

    const playerSavedAt = Date.parse(String(data.player_data?.saved_at || ""));
    if (Number.isFinite(playerSavedAt)) return playerSavedAt;
  }

  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (_error) {
    return 0;
  }
}

function getCountDictionaryScore(value: unknown): number {
  if (!isRecord(value)) return 0;

  let score = 0;
  for (const rawCount of Object.values(value)) {
    const count = Number(rawCount);
    if (Number.isFinite(count) && count > 0) {
      score += count;
    }
  }
  return score;
}

function getJsonContentScore(data: unknown): number {
  if (!isRecord(data)) return 0;

  const playerData = isRecord(data.player_data) ? data.player_data : data;
  const playerInventoryScore = [
    "inventory",
    "seed_inventory",
    "tool_inventory",
    "back_inventory",
    "hat_inventory",
    "hair_inventory",
    "eyewear_inventory",
    "beard_inventory",
    "shirt_inventory",
    "pants_inventory",
    "shoes_inventory",
    "ride_inventory",
    "currency_inventory",
    "material_inventory",
    "lure_inventory",
    "fish_inventory",
  ].reduce((total, field) => total + getCountDictionaryScore(playerData[field]), 0);
  if (playerInventoryScore > 0) return playerInventoryScore;

  const worldScore = [
    "foreground",
    "blocks",
    "background",
    "background_blocks",
    "removed_foreground",
    "removed_background",
    "seeds",
    "planted_seeds",
    "interactions",
    "drops",
    "item_drops",
  ].reduce((total, field) => total + (Array.isArray(data[field]) ? data[field].length : 0), 0);
  if (worldScore > 0) return worldScore;

  if (Array.isArray(data.accounts)) return data.accounts.length;
  return 0;
}

function copyJsonIfMissingOrNewer(
  sourcePath: string,
  targetPath: string,
  label: string,
  warn: WarnFunction = console.warn
): void {
  if (!fs.existsSync(sourcePath)) return;

  const sourceData = readJsonFile(sourcePath, warn);
  if (!sourceData) return;

  if (fs.existsSync(targetPath)) {
    const targetData = readJsonFile(targetPath, warn);
    const sourceTime = getJsonSavedAtTime(sourcePath, warn);
    const targetTime = getJsonSavedAtTime(targetPath, warn);
    const sourceScore = getJsonContentScore(sourceData);
    const targetScore = getJsonContentScore(targetData);
    const targetLooksLikeEmptyPlaceholder = targetScore <= 5 && sourceScore > targetScore + 5;
    if (targetTime >= sourceTime && !targetLooksLikeEmptyPlaceholder) return;

    const backupPath = `${targetPath}.pre-migration-${Date.now()}`;
    fs.copyFileSync(targetPath, backupPath);
    warn(`PixelManiaServer data migration backed up older ${label}: ${backupPath}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  warn(`PixelManiaServer data migration copied ${label}: ${sourcePath} -> ${targetPath}`);
}

function copyJsonFolderIfMissingOrNewer(
  sourceFolder: string,
  targetFolder: string,
  label: string,
  warn: WarnFunction = console.warn
): void {
  if (!fs.existsSync(sourceFolder)) return;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(sourceFolder, { withFileTypes: true });
  } catch (error) {
    warn(`Could not scan legacy ${label} folder ${sourceFolder}:`, errorMessage(error));
    return;
  }

  fs.mkdirSync(targetFolder, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    copyJsonIfMissingOrNewer(
      path.join(sourceFolder, entry.name),
      path.join(targetFolder, entry.name),
      `${label} file`,
      warn
    );
  }
}

export = {
  backupCorruptJsonFile,
  clonePersistenceSnapshot,
  copyJsonFolderIfMissingOrNewer,
  copyJsonIfMissingOrNewer,
  createWorldPersistenceCoordinator,
  getCountDictionaryScore,
  getJsonContentScore,
  getJsonSavedAtTime,
  normalizeWorldRevision,
  readJsonFile,
  resolveWorldLoadRevision,
  trackPersistenceWrite,
  waitForPersistenceWrites,
  writeJsonFileAtomic,
  writeJsonFileAtomicAsync,
};
