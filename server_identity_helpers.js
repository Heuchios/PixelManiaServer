// Generated from src/server_identity_helpers.ts. Do not edit by hand.
"use strict";
function cleanName(value) {
    const clean = String(value || "Guest").trim();
    return clean.length > 0 ? clean : "Guest";
}
function cleanAccountName(value) {
    const clean = String(value || "").trim();
    return clean.length > 0 ? clean : "";
}
function cleanEmail(value) {
    return String(value || "").trim().toLowerCase();
}
function cleanStableIdentityId(value, maxLength = 128) {
    return cleanAccountName(value).slice(0, maxLength);
}
function stableIdentityKey(value) {
    return cleanStableIdentityId(value).toLowerCase();
}
function stableIdentityEquals(left, right) {
    const leftKey = stableIdentityKey(left);
    const rightKey = stableIdentityKey(right);
    return leftKey !== "" && leftKey === rightKey;
}
function cleanWorld(value, maxWorldNameLength = 32) {
    const clean = String(value || "START").trim().toUpperCase().replace(/\s+/g, "_");
    const safe = clean.replace(/[^A-Z0-9_-]/g, "").slice(0, maxWorldNameLength);
    return safe.length > 0 ? safe : "START";
}
function cleanStaticNetfoxWorld(value, maxWorldNameLength = 32) {
    const clean = String(value || "").trim().toUpperCase();
    if (clean === "" || clean === "*" || clean === "ALL")
        return "";
    return cleanWorld(clean, maxWorldNameLength);
}
module.exports = {
    cleanAccountName,
    cleanEmail,
    cleanName,
    cleanStableIdentityId,
    cleanStaticNetfoxWorld,
    cleanWorld,
    stableIdentityEquals,
    stableIdentityKey,
};
