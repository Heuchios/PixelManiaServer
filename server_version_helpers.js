// Generated from src/server_version_helpers.ts. Do not edit by hand.
"use strict";
function getClientVersion(data) {
    return String(data?.client_version || data?.version || "").trim();
}
function parseVersionParts(value) {
    const clean = String(value || "").trim().replace(/^v/i, "");
    if (clean === "")
        return null;
    const core = clean.split(/[+-]/)[0];
    if (!/^\d+(?:\.\d+){0,2}$/.test(core))
        return null;
    const parts = core.split(".").map(Number);
    if (parts.some((part) => !Number.isSafeInteger(part)))
        return null;
    while (parts.length < 3)
        parts.push(0);
    return parts.slice(0, 3);
}
function compareVersions(a, b) {
    const left = parseVersionParts(a);
    const right = parseVersionParts(b);
    if (!left || !right)
        return null;
    for (let index = 0; index < 3; index += 1) {
        if (left[index] > right[index])
            return 1;
        if (left[index] < right[index])
            return -1;
    }
    return 0;
}
function isClientVersionAllowed(clientVersion, minClientVersion) {
    const comparison = compareVersions(clientVersion, minClientVersion);
    return comparison !== null && comparison >= 0;
}
module.exports = {
    compareVersions,
    getClientVersion,
    isClientVersionAllowed,
    parseVersionParts,
};
