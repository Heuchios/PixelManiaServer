// Generated from src/server_account_helpers.ts. Do not edit by hand.
"use strict";
const crypto = require("node:crypto");
const IdentityHelpers = require("./server_identity_helpers");
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
}
function makeAuditHash(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}
function validateUsername(value, minUsernameLength = 3, maxUsernameLength = 16) {
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
function validateEmail(value) {
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
function validatePassword(value, minPasswordLength = 8) {
    const password = String(value || "");
    if (password.length < minPasswordLength) {
        return { ok: false, message: `Password must be at least ${minPasswordLength} characters.` };
    }
    return { ok: true, password };
}
module.exports = {
    cloneJson,
    makeAuditHash,
    validateEmail,
    validatePassword,
    validateUsername,
};
