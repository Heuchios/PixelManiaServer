"use strict";

import crypto = require("node:crypto");

import IdentityHelpers = require("./server_identity_helpers");

type ValidationResult = {
  ok: boolean;
  message?: string;
  username?: string;
  email?: string;
  password?: string;
};

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value || {}));
}

function makeAuditHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function validateUsername(value: unknown, minUsernameLength = 3, maxUsernameLength = 16): ValidationResult {
  const username = IdentityHelpers.cleanAccountName(value);
  if (username.length < minUsernameLength) {
    return { ok: false, message: `Username must be at least ${minUsernameLength} characters.` };
  }
  if (username.length > maxUsernameLength) {
    return { ok: false, message: `Username must be ${maxUsernameLength} characters or less.` };
  }
  if (!/^[A-Za-z0-9_]+$/.test(username)) {
    return { ok: false, message: "Use letters, numbers, and underscore only." };
  }
  return { ok: true, username };
}

function validateEmail(value: unknown): ValidationResult {
  const email = IdentityHelpers.cleanEmail(value);
  if (email === "") {
    return { ok: false, message: "Enter an email address." };
  }
  if (email.includes(" ")) {
    return { ok: false, message: "Email cannot contain spaces." };
  }
  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }
  const domain = email.slice(atIndex + 1);
  if (domain.length < 3 || domain.indexOf(".") <= 0 || domain.endsWith(".")) {
    return { ok: false, message: "Enter a valid email address." };
  }
  return { ok: true, email };
}

function validatePassword(value: unknown, minPasswordLength = 8): ValidationResult {
  const password = String(value || "");
  if (password.length < minPasswordLength) {
    return { ok: false, message: `Password must be at least ${minPasswordLength} characters.` };
  }
  return { ok: true, password };
}

export = {
  cloneJson,
  makeAuditHash,
  validateEmail,
  validatePassword,
  validateUsername,
};
