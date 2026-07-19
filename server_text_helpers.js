// Generated from src/server_text_helpers.ts. Do not edit by hand.
"use strict";
function clampInteger(value, min, max) {
    const number = Math.trunc(Number(value) || 0);
    return Math.min(max, Math.max(min, number));
}
function clampString(value, limit = 64) {
    return String(value || "").trim().slice(0, limit);
}
function safeFileName(value, fallback = "data") {
    const clean = String(value || fallback).trim().replace(/\s+/g, "_");
    const safe = clean.replace(/[^a-zA-Z0-9_-]/g, "");
    return safe.length > 0 ? safe : fallback;
}
function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function cleanPunishmentReason(value, maxLength = 500) {
    const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
    return clean || "No reason provided.";
}
function cleanDoorId(value, maxLength = 32) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_")
        .replace(/[^A-Z0-9_-]/g, "")
        .slice(0, maxLength);
}
function cleanDoorDestination(value, maxLength = 80) {
    return String(value || "").trim().slice(0, maxLength);
}
function cleanDoorName(value, maxLength = 64) {
    return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}
function cleanDoorPassword(value, maxLength = 32) {
    return String(value || "").trim().slice(0, maxLength);
}
module.exports = {
    clampInteger,
    clampString,
    cleanDoorDestination,
    cleanDoorId,
    cleanDoorName,
    cleanDoorPassword,
    cleanPunishmentReason,
    escapeHtml,
    safeFileName,
};
