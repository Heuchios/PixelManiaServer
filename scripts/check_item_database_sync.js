#!/usr/bin/env node
// @ts-check

const fs = require("node:fs");
const path = require("node:path");
/** @type {{ ITEMS: Record<string, unknown> }} */
const itemDatabase = require("../server_item_database");
const { ITEMS } = itemDatabase;

/** @returns {string} */
function resolveClientItemDatabasePath() {
  const explicitPath = process.argv[2] || process.env.PIXELMANIA_CLIENT_ITEM_DB;
  if (explicitPath) {
    return path.resolve(process.cwd(), explicitPath);
  }

  const clientDir = process.env.PIXELMANIA_CLIENT_DIR
    ? path.resolve(process.cwd(), process.env.PIXELMANIA_CLIENT_DIR)
    : path.resolve(__dirname, "..", "..", "pixel-mania");

  return path.join(clientDir, "Scripts", "item_database.gd");
}

/**
 * @param {string} source
 * @param {number} startIndex
 * @returns {{ value: string, nextIndex: number }}
 */
function readQuotedString(source, startIndex) {
  const quote = source[startIndex];
  let value = "";

  for (let i = startIndex + 1; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "\\") {
      value += source[i + 1] || "";
      i += 1;
      continue;
    }

    if (ch === quote) {
      return { value, nextIndex: i + 1 };
    }

    value += ch;
  }

  throw new Error(`Unterminated string near character ${startIndex}`);
}

/**
 * @param {string} source
 * @param {number} startIndex
 * @returns {number}
 */
function skipWhitespace(source, startIndex) {
  let index = startIndex;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

/**
 * @param {string} source
 * @param {number} startIndex
 * @returns {number}
 */
function skipLineComment(source, startIndex) {
  let index = startIndex;
  while (index < source.length && source[index] !== "\n") {
    index += 1;
  }
  return index;
}

/**
 * @param {string} source
 * @param {string} constName
 * @returns {string}
 */
function extractDictionaryBody(source, constName) {
  const constIndex = source.indexOf(`const ${constName}`);
  if (constIndex < 0) {
    throw new Error(`Could not find const ${constName}`);
  }

  const openIndex = source.indexOf("{", constIndex);
  if (openIndex < 0) {
    throw new Error(`Could not find opening dictionary brace for ${constName}`);
  }

  let depth = 1;

  for (let i = openIndex + 1; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "#") {
      i = skipLineComment(source, i);
      continue;
    }

    if (ch === "\"" || ch === "'") {
      i = readQuotedString(source, i).nextIndex - 1;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }

  throw new Error(`Could not find closing dictionary brace for ${constName}`);
}

/**
 * @param {string} dictionaryBody
 * @returns {string[]}
 */
function extractTopLevelDictionaryKeys(dictionaryBody) {
  /** @type {string[]} */
  const keys = [];
  let depth = 0;

  for (let i = 0; i < dictionaryBody.length; i += 1) {
    const ch = dictionaryBody[i];

    if (ch === "#") {
      i = skipLineComment(dictionaryBody, i);
      continue;
    }

    if (ch === "\"" || ch === "'") {
      const parsed = readQuotedString(dictionaryBody, i);

      if (depth === 0) {
        const afterString = skipWhitespace(dictionaryBody, parsed.nextIndex);
        if (dictionaryBody[afterString] === ":") {
          keys.push(parsed.value);
        }
      }

      i = parsed.nextIndex - 1;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return keys;
}

/**
 * @param {string} dictionaryBody
 * @returns {Set<string>}
 */
function extractGeneratedSeedIds(dictionaryBody) {
  /** @type {Set<string>} */
  const seedIds = new Set();
  const seedFieldPattern = /["']seed["']\s*:\s*["']([^"']+)["']/g;
  let match = seedFieldPattern.exec(dictionaryBody);

  while (match) {
    const seedId = String(match[1] || "").trim().toLowerCase();
    if (seedId !== "") {
      seedIds.add(seedId);
    }
    match = seedFieldPattern.exec(dictionaryBody);
  }

  return seedIds;
}

/**
 * @param {string} source
 * @param {number} openIndex
 * @returns {string}
 */
function readBracedBody(source, openIndex) {
  let depth = 0;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "#") {
      i = skipLineComment(source, i);
      continue;
    }

    if (ch === "\"" || ch === "'") {
      i = readQuotedString(source, i).nextIndex - 1;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }

  return "";
}

/**
 * Client block ids explicitly flagged as non-collidable.
 * @param {string} dictionaryBody
 * @returns {Set<string>}
 */
function extractClientNonCollidableIds(dictionaryBody) {
  /** @type {Set<string>} */
  const ids = new Set();
  let depth = 0;

  for (let i = 0; i < dictionaryBody.length; i += 1) {
    const ch = dictionaryBody[i];

    if (ch === "#") {
      i = skipLineComment(dictionaryBody, i);
      continue;
    }

    if (ch === "\"" || ch === "'") {
      const parsed = readQuotedString(dictionaryBody, i);

      if (depth === 0) {
        const afterString = skipWhitespace(dictionaryBody, parsed.nextIndex);
        if (dictionaryBody[afterString] === ":") {
          const afterColon = skipWhitespace(dictionaryBody, afterString + 1);
          if (dictionaryBody[afterColon] === "{") {
            const body = readBracedBody(dictionaryBody, afterColon);
            if (
              /["']no_collision["']\s*:\s*true/.test(body)
              || /["']collidable["']\s*:\s*false/.test(body)
            ) {
              ids.add(parsed.value);
            }
          }
        }
      }

      i = parsed.nextIndex - 1;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return ids;
}

/**
 * Mirrors isSolidMovementCollisionBlock() in src/server.ts. A block the client
 * treats as non-collidable must never be solid here: the client walks into the
 * tile, the server rejects the move as movement_blocked, and the correction
 * hard-snaps the player back every frame. In game that reads as being trapped
 * by the block.
 * @param {unknown} value
 * @returns {boolean}
 */
function isSolidMovementCollisionBlock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const definition = /** @type {Record<string, unknown>} */ (value);
  if (definition.category !== "block") return false;
  if (definition.no_collision === true || definition.collidable === false) return false;
  if (definition.platform_collision === true) return false;
  const collisionType = String(definition.collision_type || "full").trim().toLowerCase();
  return collisionType === "" || collisionType === "full" || collisionType === "custom";
}

/**
 * @param {Iterable<string>} ids
 * @returns {string[]}
 */
function sortIds(ids) {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** @returns {void} */
function main() {
  const clientItemDatabasePath = resolveClientItemDatabasePath();

  if (!fs.existsSync(clientItemDatabasePath)) {
    console.error(`Client item database not found: ${clientItemDatabasePath}`);
    console.error("Pass a path as the first argument or set PIXELMANIA_CLIENT_ITEM_DB.");
    process.exit(1);
  }

  const source = fs.readFileSync(clientItemDatabasePath, "utf8");
  const clientBody = extractDictionaryBody(source, "ITEMS");
  const clientItemIds = new Set(extractTopLevelDictionaryKeys(clientBody));
  const generatedClientSeedIds = extractGeneratedSeedIds(clientBody);
  for (const seedId of generatedClientSeedIds) {
    clientItemIds.add(seedId);
  }
  const serverItemIds = new Set(Object.keys(ITEMS));

  const missingOnServer = sortIds([...clientItemIds].filter((itemId) => !serverItemIds.has(itemId)));
  const serverOnly = sortIds([...serverItemIds].filter((itemId) => !clientItemIds.has(itemId)));
  const clientNonCollidableIds = extractClientNonCollidableIds(clientBody);
  const collisionMismatches = sortIds(
    [...clientNonCollidableIds].filter((itemId) => isSolidMovementCollisionBlock(ITEMS[itemId])),
  );

  console.log(`Client item database: ${clientItemDatabasePath}`);
  console.log(`Client items: ${clientItemIds.size}`);
  console.log(`Client virtual block seeds: ${generatedClientSeedIds.size}`);
  console.log(`Server items: ${serverItemIds.size}`);
  console.log(`Client non-collidable blocks: ${clientNonCollidableIds.size}`);

  if (missingOnServer.length > 0) {
    console.error("\nMissing from server_item_database.js:");
    for (const itemId of missingOnServer) {
      console.error(` - ${itemId}`);
    }
  }

  if (serverOnly.length > 0) {
    console.log("\nServer-only items:");
    for (const itemId of serverOnly) {
      console.log(` - ${itemId}`);
    }
  }

  if (collisionMismatches.length > 0) {
    console.error("\nCollision mismatch - client says non-collidable, server says solid:");
    for (const itemId of collisionMismatches) {
      console.error(` - ${itemId}`);
    }
    console.error("Add `no_collision: true` (and `collidable: false`) to these server definitions.");
    console.error("Otherwise the server rejects movement into the tile and hard-snaps the player back.");
  }

  if (missingOnServer.length > 0) {
    console.error("\nItem database sync failed. Add the missing item IDs to the server database before release.");
    process.exit(1);
  }

  if (collisionMismatches.length > 0) {
    console.error("\nItem database sync failed on collision parity.");
    process.exit(1);
  }

  console.log("\nItem database sync OK. Every client item exists on the server, and collision flags agree.");
}

main();
