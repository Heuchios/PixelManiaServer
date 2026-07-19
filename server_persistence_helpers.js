// Generated from src/server_persistence_helpers.ts. Do not edit by hand.
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function backupCorruptJsonFile(filePath, warn = console.warn) {
    try {
        if (!fs.existsSync(filePath))
            return;
        const backupPath = `${filePath}.corrupt-${Date.now()}`;
        fs.copyFileSync(filePath, backupPath);
    }
    catch (error) {
        warn(`Could not back up corrupt JSON ${filePath}:`, errorMessage(error));
    }
}
function readJsonFile(filePath, warn = console.warn) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch (error) {
        warn(`Could not read ${filePath}:`, errorMessage(error));
        backupCorruptJsonFile(filePath, warn);
        return null;
    }
}
function writeJsonFileAtomic(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
}
async function writeJsonFileAtomicAsync(filePath, data) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    try {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        await fs.promises.rename(tempPath, filePath);
    }
    catch (error) {
        try {
            await fs.promises.unlink(tempPath);
        }
        catch (_unlinkError) {
            // Best effort cleanup for failed async temp writes.
        }
        throw error;
    }
}
function trackPersistenceWrite(pendingPersistenceWrites, promise, label = "persistence write", warn = console.warn) {
    if (!promise || typeof promise.then !== "function")
        return promise;
    const tracked = Promise.resolve(promise)
        .catch((error) => {
        warn(`[persistence] ${label} failed:`, errorMessage(error));
    })
        .finally(() => {
        pendingPersistenceWrites.delete(tracked);
    });
    pendingPersistenceWrites.add(tracked);
    return tracked;
}
async function waitForPersistenceWrites(pendingPersistenceWrites) {
    if (pendingPersistenceWrites.size === 0)
        return;
    await Promise.allSettled(Array.from(pendingPersistenceWrites));
}
function getJsonSavedAtTime(filePath, warn = console.warn) {
    const data = readJsonFile(filePath, warn);
    if (isRecord(data)) {
        const savedAt = Date.parse(String(data.saved_at || data.updated_at || ""));
        if (Number.isFinite(savedAt))
            return savedAt;
        const playerSavedAt = Date.parse(String(data.player_data?.saved_at || ""));
        if (Number.isFinite(playerSavedAt))
            return playerSavedAt;
    }
    try {
        return fs.statSync(filePath).mtimeMs;
    }
    catch (_error) {
        return 0;
    }
}
function getCountDictionaryScore(value) {
    if (!isRecord(value))
        return 0;
    let score = 0;
    for (const rawCount of Object.values(value)) {
        const count = Number(rawCount);
        if (Number.isFinite(count) && count > 0) {
            score += count;
        }
    }
    return score;
}
function getJsonContentScore(data) {
    if (!isRecord(data))
        return 0;
    const playerData = isRecord(data.player_data) ? data.player_data : data;
    const playerInventoryScore = [
        "inventory",
        "seed_inventory",
        "tool_inventory",
        "back_inventory",
        "hat_inventory",
        "hair_inventory",
        "eyewear_inventory",
        "shirt_inventory",
        "pants_inventory",
        "shoes_inventory",
        "ride_inventory",
        "currency_inventory",
        "material_inventory",
        "lure_inventory",
        "fish_inventory",
    ].reduce((total, field) => total + getCountDictionaryScore(playerData[field]), 0);
    if (playerInventoryScore > 0)
        return playerInventoryScore;
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
    if (worldScore > 0)
        return worldScore;
    if (Array.isArray(data.accounts))
        return data.accounts.length;
    return 0;
}
function copyJsonIfMissingOrNewer(sourcePath, targetPath, label, warn = console.warn) {
    if (!fs.existsSync(sourcePath))
        return;
    const sourceData = readJsonFile(sourcePath, warn);
    if (!sourceData)
        return;
    if (fs.existsSync(targetPath)) {
        const targetData = readJsonFile(targetPath, warn);
        const sourceTime = getJsonSavedAtTime(sourcePath, warn);
        const targetTime = getJsonSavedAtTime(targetPath, warn);
        const sourceScore = getJsonContentScore(sourceData);
        const targetScore = getJsonContentScore(targetData);
        const targetLooksLikeEmptyPlaceholder = targetScore <= 5 && sourceScore > targetScore + 5;
        if (targetTime >= sourceTime && !targetLooksLikeEmptyPlaceholder)
            return;
        const backupPath = `${targetPath}.pre-migration-${Date.now()}`;
        fs.copyFileSync(targetPath, backupPath);
        warn(`PixelManiaServer data migration backed up older ${label}: ${backupPath}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    warn(`PixelManiaServer data migration copied ${label}: ${sourcePath} -> ${targetPath}`);
}
function copyJsonFolderIfMissingOrNewer(sourceFolder, targetFolder, label, warn = console.warn) {
    if (!fs.existsSync(sourceFolder))
        return;
    let entries = [];
    try {
        entries = fs.readdirSync(sourceFolder, { withFileTypes: true });
    }
    catch (error) {
        warn(`Could not scan legacy ${label} folder ${sourceFolder}:`, errorMessage(error));
        return;
    }
    fs.mkdirSync(targetFolder, { recursive: true });
    for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json")
            continue;
        copyJsonIfMissingOrNewer(path.join(sourceFolder, entry.name), path.join(targetFolder, entry.name), `${label} file`, warn);
    }
}
module.exports = {
    backupCorruptJsonFile,
    copyJsonFolderIfMissingOrNewer,
    copyJsonIfMissingOrNewer,
    getCountDictionaryScore,
    getJsonContentScore,
    getJsonSavedAtTime,
    readJsonFile,
    trackPersistenceWrite,
    waitForPersistenceWrites,
    writeJsonFileAtomic,
    writeJsonFileAtomicAsync,
};
