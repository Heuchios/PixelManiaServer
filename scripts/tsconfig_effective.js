#!/usr/bin/env node
// @ts-check
"use strict";

// Resolves what tsc actually uses for a project, rather than what one tsconfig
// file happens to spell out locally.
//
// Every per-module tsconfig now `extends ./tsconfig.json`, so assertions written
// against the raw JSON of a single file stop seeing the options that matter --
// they live in the base. A guard that reads raw JSON therefore passes whether
// the setting is inherited, is overridden to something weaker in the base, or
// has been quietly deleted. Guards must read the resolved values instead.

const fs = require("node:fs");
const path = require("node:path");

// The options `strict: true` turns on. tsc treats an explicit per-option value
// as an override of `strict`, so the effective value is `explicit ?? strict`.
const STRICT_FAMILY_OPTIONS = [
  "alwaysStrict",
  "noImplicitAny",
  "noImplicitThis",
  "strictBindCallApply",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
];

/**
 * @param {string} configPath
 * @returns {Record<string, any>}
 */
function readConfigJson(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing tsconfig: ${configPath}`);
  }
  const source = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${configPath}: ${String(error)}`);
  }
}

/**
 * Resolves a project's `extends` chain the way tsc does: `compilerOptions` merge
 * shallowly with the child winning, while `files` / `include` / `exclude` are
 * replaced wholesale by the nearest config that declares them.
 *
 * @param {string} configPath absolute path to a tsconfig file
 * @returns {{ configPath: string, extendsChain: string[], compilerOptions: Record<string, any>, include: string[] | undefined, exclude: string[] | undefined, files: string[] | undefined }}
 */
function resolveTsconfig(configPath) {
  /** @type {string[]} */
  const extendsChain = [];
  /** @type {Record<string, any>[]} */
  const layers = [];
  /** @type {Set<string>} */
  const visited = new Set();

  let currentPath = path.resolve(configPath);
  while (true) {
    if (visited.has(currentPath)) {
      throw new Error(`Circular tsconfig extends chain at ${currentPath}`);
    }
    visited.add(currentPath);

    const config = readConfigJson(currentPath);
    layers.push(config);

    const parent = config.extends;
    if (parent === undefined) {
      break;
    }
    if (typeof parent !== "string") {
      throw new Error(`Only a single string "extends" is supported; ${currentPath} has ${JSON.stringify(parent)}`);
    }
    if (!parent.startsWith(".")) {
      throw new Error(`Only relative "extends" is supported; ${currentPath} extends ${parent}`);
    }
    extendsChain.push(parent);
    currentPath = path.resolve(path.dirname(currentPath), parent);
  }

  // layers[0] is the leaf. Merge base-first so the leaf wins.
  /** @type {Record<string, any>} */
  const compilerOptions = {};
  for (const layer of [...layers].reverse()) {
    Object.assign(compilerOptions, layer.compilerOptions || {});
  }

  /** @param {string} key */
  function nearest(key) {
    for (const layer of layers) {
      if (layer[key] !== undefined) {
        return layer[key];
      }
    }
    return undefined;
  }

  return {
    configPath: path.resolve(configPath),
    extendsChain,
    compilerOptions,
    include: nearest("include"),
    exclude: nearest("exclude"),
    files: nearest("files"),
  };
}

/**
 * The real value tsc will use for one of the `strict` family options.
 *
 * @param {Record<string, any>} compilerOptions
 * @param {string} option
 * @returns {boolean}
 */
function effectiveStrictOption(compilerOptions, option) {
  if (Object.prototype.hasOwnProperty.call(compilerOptions, option) && compilerOptions[option] !== undefined) {
    return compilerOptions[option] === true;
  }
  return compilerOptions.strict === true;
}

/**
 * Every strict-family option's effective value, plus `strict` itself.
 *
 * @param {Record<string, any>} compilerOptions
 * @returns {Record<string, boolean>}
 */
function effectiveStrictness(compilerOptions) {
  /** @type {Record<string, boolean>} */
  const result = { strict: compilerOptions.strict === true };
  for (const option of STRICT_FAMILY_OPTIONS) {
    result[option] = effectiveStrictOption(compilerOptions, option);
  }
  return result;
}

module.exports = {
  STRICT_FAMILY_OPTIONS,
  effectiveStrictOption,
  effectiveStrictness,
  resolveTsconfig,
};
