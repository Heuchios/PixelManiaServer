"use strict";

function clampInteger(value: unknown, min: number, max: number): number {
  const number = Math.trunc(Number(value) || 0);
  return Math.min(max, Math.max(min, number));
}

function clampString(value: unknown, limit = 64): string {
  return String(value || "").trim().slice(0, limit);
}

function safeFileName(value: unknown, fallback = "data"): string {
  const clean = String(value || fallback).trim().replace(/\s+/g, "_");
  const safe = clean.replace(/[^a-zA-Z0-9_-]/g, "");
  return safe.length > 0 ? safe : fallback;
}

function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanPunishmentReason(value: unknown, maxLength = 500): string {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || "No reason provided.";
}

function cleanDoorId(value: unknown, maxLength = 32): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, maxLength);
}

function cleanDoorDestination(value: unknown, maxLength = 80): string {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanDoorName(value: unknown, maxLength = 64): string {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function cleanDoorPassword(value: unknown, maxLength = 32): string {
  return String(value || "").trim().slice(0, maxLength);
}

export = {
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
