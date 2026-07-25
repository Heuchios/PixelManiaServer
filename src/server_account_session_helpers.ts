"use strict";

import crypto = require("node:crypto");
import net = require("node:net");

const AccountHelpers = require("./server_account_helpers") as {
  validateUsername(value: unknown, minUsernameLength?: number, maxUsernameLength?: number): ValidationResult;
  validateEmail(value: unknown): ValidationResult;
  validatePassword(value: unknown, minPasswordLength?: number): ValidationResult;
};
const TextHelpers = require("./server_text_helpers") as {
  escapeHtml(value: unknown): string;
};
const nodemailer = require("nodemailer") as any;

type PacketRecord = Record<string, any>;

type ValidationResult = {
  ok: boolean;
  message?: string;
  username?: string;
  email?: string;
  password?: string;
  action?: string;
  retry_ms?: number;
  retry_after_seconds?: number;
};

interface AccountSessionDeps extends PacketRecord {}

type ProxyRequestLike = {
  headers?: Record<string, unknown>;
  socket?: {
    remoteAddress?: unknown;
  };
} | null | undefined;

function normalizeSocketAddress(value: unknown): string {
  let address = String(value || "").trim();
  if (address.startsWith("::ffff:")) {
    address = address.slice("::ffff:".length);
  }
  return net.isIP(address) ? address : "";
}

function firstForwardedAddress(value: unknown): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return normalizeSocketAddress(String(rawValue || "").split(",", 1)[0]);
}

function isTrustedLoopbackProxy(address: unknown): boolean {
  const normalized = normalizeSocketAddress(address);
  return normalized === "127.0.0.1" || normalized === "::1";
}

function resolveTrustedProxyClientAddress(request: ProxyRequestLike): string {
  const peerAddress = normalizeSocketAddress(request?.socket?.remoteAddress);
  if (!isTrustedLoopbackProxy(peerAddress)) return peerAddress;

  const cloudflareAddress = firstForwardedAddress(request?.headers?.["cf-connecting-ip"]);
  if (cloudflareAddress) return cloudflareAddress;

  const forwardedAddress = firstForwardedAddress(request?.headers?.["x-forwarded-for"]);
  return forwardedAddress || peerAddress;
}

function createServerAccountSessionHelpers(deps: AccountSessionDeps) {
  const {
    ACCOUNT_EMAIL_CHANGE_TTL_MS,
    ACCOUNT_PASSWORD_RESET_TTL_MS,
    EMAIL_VERIFICATION_TTL_MS,
    LOGIN_ATTEMPT_LIMIT_ACCOUNT,
    LOGIN_ATTEMPT_LIMIT_IP,
    LOGIN_ATTEMPT_WINDOW_MS,
    TOKEN_LOGIN_ATTEMPT_LIMIT_ACCOUNT,
    TOKEN_LOGIN_ATTEMPT_LIMIT_IP,
    MAX_USERNAME_LENGTH,
    MIN_PASSWORD_LENGTH,
    MIN_USERNAME_LENGTH,
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_SCRYPT_KEYLEN,
    PASSWORD_SCRYPT_N,
    PASSWORD_SCRYPT_P,
    PASSWORD_SCRYPT_R,
    PUBLIC_BASE_URL,
    SESSION_REFRESH_TOKEN_TTL_MS,
    SESSION_TOKEN_TTL_MS,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    accountKey,
    accounts,
    cleanAccountName,
    cleanEmail,
    getSocketAddress,
    getSocketDeviceInfo,
    getSocketUserAgent,
    isPostgresAuthoritativeReady,
    localEmailChangeRequests,
    localLoginAttemptBuckets,
    localPasswordResetRequests,
    logSecurityEvent,
    makeRequestId,
    postgresStore,
    queueAccountsSave,
    redisStore,
    sanitizeAccountState,
  } = deps;

  let mailTransporter: any = null;

  function validateUsername(value: unknown): ValidationResult {
    return AccountHelpers.validateUsername(value, MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH);
  }

  function validateEmail(value: unknown): ValidationResult {
    return AccountHelpers.validateEmail(value);
  }

  function validatePassword(value: unknown): ValidationResult {
    return AccountHelpers.validatePassword(value, MIN_PASSWORD_LENGTH);
  }

  function parsePasswordHashAlgorithm(algorithm = "") {
    const raw = String(algorithm || "").trim().toLowerCase();
    if (!raw || raw === "scrypt" || raw === "legacy_scrypt") {
      return {
        name: "scrypt",
        N: 16384,
        r: 8,
        p: 1,
        keylen: 64,
        algorithm: "legacy_scrypt",
      };
    }

    const match = raw.match(/^scrypt:n=(\d+),r=(\d+),p=(\d+),keylen=(\d+)$/);
    if (!match) {
      return {
        name: "scrypt",
        N: PASSWORD_SCRYPT_N,
        r: PASSWORD_SCRYPT_R,
        p: PASSWORD_SCRYPT_P,
        keylen: PASSWORD_SCRYPT_KEYLEN,
        algorithm: PASSWORD_HASH_ALGORITHM,
      };
    }

    return {
      name: "scrypt",
      N: Math.max(16384, Math.trunc(Number(match[1]) || PASSWORD_SCRYPT_N)),
      r: Math.max(8, Math.trunc(Number(match[2]) || PASSWORD_SCRYPT_R)),
      p: Math.max(1, Math.trunc(Number(match[3]) || PASSWORD_SCRYPT_P)),
      keylen: Math.max(32, Math.trunc(Number(match[4]) || PASSWORD_SCRYPT_KEYLEN)),
      algorithm: raw,
    };
  }

  function makePasswordHash(password: unknown, salt = crypto.randomBytes(16).toString("hex"), algorithm = PASSWORD_HASH_ALGORITHM) {
    const parsed = parsePasswordHashAlgorithm(algorithm);
    const hash = crypto.scryptSync(String(password || ""), salt, parsed.keylen, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: Math.max(64 * 1024 * 1024, 256 * parsed.N * parsed.r),
    }).toString("hex");
    return { salt, hash, algorithm: parsed.algorithm };
  }

  function verifyPassword(account: PacketRecord | null | undefined, password: unknown): boolean {
    if (!account || !account.password_salt || !account.password_hash) return false;

    const result = makePasswordHash(password, account.password_salt, account.password_algorithm || "legacy_scrypt");
    const expected = Buffer.from(account.password_hash, "hex");
    const actual = Buffer.from(result.hash, "hex");
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }

  function makeTokenHash(token: unknown): string {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
  }

  function makeSecureToken(byteLength = 32): string {
    return crypto.randomBytes(Math.max(16, Math.trunc(Number(byteLength) || 32))).toString("hex");
  }

  function queueSessionFallbackSave(): void {
    if (!isPostgresAuthoritativeReady()) {
      queueAccountsSave();
    }
  }

  function issueSessionToken(account: PacketRecord): string {
    const token = makeSecureToken(32);
    account.session_token_expires_at = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();
    account.session_token_hash = makeTokenHash(token);
    account.refresh_token_hash = "";
    account.refresh_token_expires_at = "";
    account.last_seen_at = new Date().toISOString();
    queueSessionFallbackSave();
    return token;
  }

  function issueSessionTokens(account: PacketRecord) {
    const sessionToken = makeSecureToken(32);
    const refreshToken = makeSecureToken(48);
    account.session_token_hash = makeTokenHash(sessionToken);
    account.session_token_expires_at = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();
    account.refresh_token_hash = makeTokenHash(refreshToken);
    account.refresh_token_expires_at = new Date(Date.now() + SESSION_REFRESH_TOKEN_TTL_MS).toISOString();
    account.last_seen_at = new Date().toISOString();
    queueSessionFallbackSave();
    return { sessionToken, refreshToken };
  }

  function clearSessionToken(account: PacketRecord | null | undefined): void {
    if (!account) return;
    const username = cleanAccountName(account.username || "");
    account.session_token_hash = "";
    account.session_token_expires_at = "";
    account.refresh_token_hash = "";
    account.refresh_token_expires_at = "";
    queueSessionFallbackSave();
    if (username !== "" && typeof postgresStore?.revokeSessionsByUsername === "function") {
      postgresStore.revokeSessionsByUsername(username);
    }
  }

  function isSessionTokenValid(account: PacketRecord | null | undefined, token: unknown): boolean {
    if (!account || !account.session_token_hash) return false;
    if (account.session_token_hash !== makeTokenHash(token)) return false;

    const expiresAt = Date.parse(String(account.session_token_expires_at || ""));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      clearSessionToken(account);
      return false;
    }

    return true;
  }

  function isRefreshTokenValid(account: PacketRecord | null | undefined, token: unknown): boolean {
    if (!account || !account.refresh_token_hash) return false;
    if (account.refresh_token_hash !== makeTokenHash(token)) return false;

    const expiresAt = Date.parse(String(account.refresh_token_expires_at || ""));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      clearSessionToken(account);
      return false;
    }

    return true;
  }

  function isAccountEmailVerified(account: PacketRecord | null | undefined): boolean {
    return Boolean(account && account.email_verified);
  }

  function makeEmailVerificationToken(account: PacketRecord): string {
    const token = crypto.randomBytes(32).toString("hex");
    account.email_verification_token_hash = makeTokenHash(token);
    account.email_verification_expires_at = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
    account.email_verified = false;
    account.email_verified_at = "";
    return token;
  }

  function makeEmailVerificationUrl(token: unknown): string {
    return `${PUBLIC_BASE_URL}/verify-email?token=${encodeURIComponent(String(token || ""))}`;
  }

  function makePasswordResetUrl(token: unknown): string {
    return `${PUBLIC_BASE_URL}/reset-password?token=${encodeURIComponent(String(token || ""))}`;
  }

  function makeEmailChangeUrl(token: unknown): string {
    return `${PUBLIC_BASE_URL}/change-email?token=${encodeURIComponent(String(token || ""))}`;
  }

  function hasActiveEmailVerificationToken(account: PacketRecord | null | undefined): boolean {
    if (!account || !account.email_verification_token_hash) return false;
    const expiresAt = Date.parse(String(account.email_verification_expires_at || ""));
    return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
  }

  function getMailTransporter() {
    if (mailTransporter) return mailTransporter;
    if (!SMTP_HOST) return null;

    const transportOptions: PacketRecord = {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
    };

    if (SMTP_USER !== "" || SMTP_PASS !== "") {
      transportOptions.auth = {
        user: SMTP_USER,
        pass: SMTP_PASS,
      };
    }

    mailTransporter = nodemailer.createTransport(transportOptions);
    return mailTransporter;
  }

  async function sendVerificationEmail(account: PacketRecord, token: unknown): Promise<void> {
    const verificationUrl = makeEmailVerificationUrl(token);
    const to = cleanEmail(account.email || "");
    if (to === "") return;

    const transporter = getMailTransporter();
    if (!transporter) {
      console.warn(`Email verification link for ${account.username} <${to}>: ${verificationUrl}`);
      return;
    }

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: "Verify your PixelMania account",
      text: [
        `Hi ${account.username},`,
        "",
        "Verify your PixelMania account before signing on:",
        verificationUrl,
        "",
        "If you did not create this account, ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${TextHelpers.escapeHtml(account.username)},</p>`,
        "<p>Verify your PixelMania account before signing on:</p>",
        `<p><a href="${TextHelpers.escapeHtml(verificationUrl)}">Verify PixelMania Account</a></p>`,
        "<p>If you did not create this account, ignore this email.</p>",
      ].join("\n"),
    });
  }

  function queueVerificationEmail(account: PacketRecord, token: unknown): void {
    sendVerificationEmail(account, token).catch((error: Error) => {
      console.warn(`Could not send verification email to ${account.email}:`, error.message);
      console.warn(`Email verification link for ${account.username}: ${makeEmailVerificationUrl(token)}`);
    });
  }

  async function sendPasswordResetEmail(account: PacketRecord, token: unknown): Promise<void> {
    const resetUrl = makePasswordResetUrl(token);
    const to = cleanEmail(account?.email || "");
    if (to === "") return;

    const transporter = getMailTransporter();
    if (!transporter) {
      console.warn(`Password reset link for ${account.username} <${to}>: ${resetUrl}`);
      return;
    }

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: "Reset your PixelMania password",
      text: [
        `Hi ${account.username},`,
        "",
        "Reset your PixelMania password here:",
        resetUrl,
        "",
        "If you did not request this, ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${TextHelpers.escapeHtml(account.username)},</p>`,
        "<p>Reset your PixelMania password here:</p>",
        `<p><a href="${TextHelpers.escapeHtml(resetUrl)}">Reset PixelMania Password</a></p>`,
        "<p>If you did not request this, ignore this email.</p>",
      ].join("\n"),
    });
  }

  function queuePasswordResetEmail(account: PacketRecord, token: unknown): void {
    sendPasswordResetEmail(account, token).catch((error: Error) => {
      console.warn(`Could not send password reset email to ${account?.email || ""}:`, error.message);
      console.warn(`Password reset link for ${account?.username || "unknown"}: ${makePasswordResetUrl(token)}`);
    });
  }

  async function sendEmailChangeEmail(account: PacketRecord, newEmail: unknown, token: unknown): Promise<void> {
    const changeUrl = makeEmailChangeUrl(token);
    const to = cleanEmail(newEmail || "");
    if (to === "") return;

    const transporter = getMailTransporter();
    if (!transporter) {
      console.warn(`Email change link for ${account.username} <${to}>: ${changeUrl}`);
      return;
    }

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: "Confirm your PixelMania email change",
      text: [
        `Hi ${account.username},`,
        "",
        "Confirm this as your new PixelMania account email:",
        changeUrl,
        "",
        "If you did not request this, ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${TextHelpers.escapeHtml(account.username)},</p>`,
        "<p>Confirm this as your new PixelMania account email:</p>",
        `<p><a href="${TextHelpers.escapeHtml(changeUrl)}">Confirm PixelMania Email Change</a></p>`,
        "<p>If you did not request this, ignore this email.</p>",
      ].join("\n"),
    });
  }

  function queueEmailChangeEmail(account: PacketRecord, newEmail: unknown, token: unknown): void {
    sendEmailChangeEmail(account, newEmail, token).catch((error: Error) => {
      console.warn(`Could not send email change confirmation to ${newEmail}:`, error.message);
      console.warn(`Email change link for ${account?.username || "unknown"}: ${makeEmailChangeUrl(token)}`);
    });
  }

  async function verifyEmailToken(token: unknown) {
    const cleanToken = String(token || "").trim();
    if (cleanToken === "") {
      return { ok: false, message: "This verification link is missing its token." };
    }

    const tokenHash = makeTokenHash(cleanToken);
    if (isPostgresAuthoritativeReady()) {
      const result = await postgresStore.consumeAccountEmailVerificationToken(tokenHash);
      if (!result.ok) {
        return {
          ok: false,
          message: result.reason === "expired"
            ? "This verification link expired. Register again to send a new email."
            : "This verification link is invalid or has already been used.",
        };
      }

      const username = cleanAccountName(result.username || "");
      let account = username !== "" ? accounts.get(accountKey(username)) : null;
      if (!account && username !== "") {
        account = sanitizeAccountState(await postgresStore.loadAccountState(username));
      }
      if (account) {
        account.email_verified = true;
        account.email_verified_at = String(result.email_verified_at || new Date().toISOString());
        account.email_verification_token_hash = "";
        account.email_verification_expires_at = "";
        clearSessionToken(account);
        accounts.set(accountKey(account.username), account);
        queueAccountsSave();
      } else if (username !== "") {
        await postgresStore.revokeSessionsForUsername(username, "email_verified");
      }

      return { ok: true, message: "Your PixelMania email is verified. You can return to the game and sign on." };
    }

    for (const account of accounts.values()) {
      if (account.email_verification_token_hash !== tokenHash) continue;

      const expiresAt = Date.parse(String(account.email_verification_expires_at || ""));
      if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
        account.email_verification_token_hash = "";
        account.email_verification_expires_at = "";
        queueAccountsSave();
        return { ok: false, message: "This verification link expired. Register again to send a new email." };
      }

      account.email_verified = true;
      account.email_verified_at = new Date().toISOString();
      account.email_verification_token_hash = "";
      account.email_verification_expires_at = "";
      clearSessionToken(account);
      queueAccountsSave();
      return { ok: true, message: "Your PixelMania email is verified. You can return to the game and sign on." };
    }

    return { ok: false, message: "This verification link is invalid or has already been used." };
  }

  async function consumePasswordResetToken(token: unknown) {
    const cleanToken = String(token || "").trim();
    if (cleanToken === "") return { ok: false, message: "This password reset link is missing its token." };
    const tokenHash = makeTokenHash(cleanToken);

    if (isPostgresAuthoritativeReady()) {
      const result = await postgresStore.consumeAccountPasswordResetRequest(tokenHash);
      if (!result.ok) {
        return { ok: false, message: "This password reset link is invalid, expired, or already used." };
      }
      return result;
    }

    const entry = localPasswordResetRequests.get(tokenHash);
    if (!entry || entry.used) {
      return { ok: false, message: "This password reset link is invalid, expired, or already used." };
    }
    const expiresAt = Date.parse(String(entry.expires_at || ""));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      localPasswordResetRequests.delete(tokenHash);
      return { ok: false, message: "This password reset link expired. Request a new one from the game." };
    }
    localPasswordResetRequests.delete(tokenHash);
    return {
      ok: true,
      username: cleanAccountName(entry.username || ""),
      email: cleanEmail(entry.email || ""),
    };
  }

  async function applyPasswordResetToken(token: unknown, password: unknown) {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.ok) {
      return { ok: false, message: passwordValidation.message };
    }

    const passwordHash = makePasswordHash(passwordValidation.password);
    if (isPostgresAuthoritativeReady()) {
      const cleanToken = String(token || "").trim();
      if (cleanToken === "") {
        return { ok: false, message: "This password reset link is missing its token." };
      }

      const resetResult = await postgresStore.resetAccountPasswordWithToken(makeTokenHash(cleanToken), passwordHash);
      if (!resetResult.ok) {
        return {
          ok: false,
          message: resetResult.reason === "invalid_or_expired"
            ? "This password reset link is invalid, expired, or already used."
            : "Could not change your password. Request a new link and try again.",
        };
      }

      const username = cleanAccountName(resetResult.username || "");
      const account = username !== "" ? accounts.get(accountKey(username)) : null;
      if (account) {
        account.password_salt = passwordHash.salt;
        account.password_hash = passwordHash.hash;
        account.password_algorithm = passwordHash.algorithm;
        account.last_seen_at = new Date().toISOString();
        clearSessionToken(account);
        queueAccountsSave();
      }

      return { ok: true, username, message: "Your password was changed. Return to the game and sign on again." };
    }

    const tokenResult = await consumePasswordResetToken(token);
    if (!tokenResult.ok) {
      return tokenResult;
    }

    const username = cleanAccountName(tokenResult.username || "");
    if (username === "") {
      return { ok: false, message: "This password reset link is invalid." };
    }

    const account = accounts.get(accountKey(username));
    if (account) {
      account.password_salt = passwordHash.salt;
      account.password_hash = passwordHash.hash;
      account.password_algorithm = passwordHash.algorithm;
      account.last_seen_at = new Date().toISOString();
      clearSessionToken(account);
      queueAccountsSave();
    }

    if (!account) {
      return { ok: false, message: "Could not find this account. Request a new link and try again." };
    }

    return { ok: true, username, message: "Your password was changed. Return to the game and sign on again." };
  }

  async function confirmEmailChangeToken(token: unknown) {
    const cleanToken = String(token || "").trim();
    if (cleanToken === "") return { ok: false, message: "This email change link is missing its token." };
    const tokenHash = makeTokenHash(cleanToken);

    let tokenResult: PacketRecord;
    if (isPostgresAuthoritativeReady()) {
      tokenResult = await postgresStore.consumeAccountEmailChangeRequest(tokenHash);
      if (!tokenResult.ok) {
        return { ok: false, message: "This email change link is invalid, expired, or already used." };
      }
    } else {
      const entry = localEmailChangeRequests.get(tokenHash);
      if (!entry || entry.used) {
        return { ok: false, message: "This email change link is invalid, expired, or already used." };
      }
      const expiresAt = Date.parse(String(entry.expires_at || ""));
      if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
        localEmailChangeRequests.delete(tokenHash);
        return { ok: false, message: "This email change link expired. Request a new one from the game." };
      }
      localEmailChangeRequests.delete(tokenHash);
      tokenResult = {
        ok: true,
        username: cleanAccountName(entry.username || ""),
        old_email: cleanEmail(entry.old_email || ""),
        new_email: cleanEmail(entry.new_email || ""),
      };
    }

    const username = cleanAccountName(tokenResult.username || "");
    const newEmail = cleanEmail(tokenResult.new_email || "");
    if (username === "" || newEmail === "") {
      return { ok: false, message: "This email change link is invalid." };
    }

    const emailOwner = findAccountByEmail(newEmail);
    if (emailOwner && accountKey(emailOwner.username) !== accountKey(username)) {
      return { ok: false, message: "That email is already registered to another account." };
    }

    const account = accounts.get(accountKey(username));
    if (account) {
      account.email = newEmail;
      account.email_verified = true;
      account.email_verified_at = new Date().toISOString();
      account.email_verification_token_hash = "";
      account.email_verification_expires_at = "";
      clearSessionToken(account);
      queueAccountsSave();
    }

    if (isPostgresAuthoritativeReady()) {
      const update = await postgresStore.updateAccountEmail(username, newEmail);
      if (!update.ok) {
        return {
          ok: false,
          message: update.reason === "email_in_use"
            ? "That email is already registered to another account."
            : "Could not change your email. Request a new link and try again.",
        };
      }
      await postgresStore.revokeSessionsForUsername(username, "email_changed");
    } else if (!account) {
      return { ok: false, message: "Could not find this account. Request a new link and try again." };
    }

    return { ok: true, username, message: "Your email was changed. Return to the game and sign on again." };
  }

  function hasPassword(account: PacketRecord | null | undefined): boolean {
    return Boolean(account && account.password_salt && account.password_hash);
  }

  function findAccountByEmail(email: unknown): PacketRecord | null {
    const clean = cleanEmail(email);
    if (clean === "") return null;

    for (const account of accounts.values()) {
      if (cleanEmail(account.email || "") === clean) {
        return account;
      }
    }

    return null;
  }

  function getLoginAttemptSubject(socket: PacketRecord | null | undefined, username = "") {
    const cleanUsername = accountKey(username || "");
    const ip = getSocketAddress(socket);
    return {
      username: cleanUsername,
      ip,
      ipSubject: ip !== "" ? `ip:${ip}` : `socket:${socket?.playerId || "unknown"}`,
      accountSubject: cleanUsername !== "" ? `account:${cleanUsername}` : "",
    };
  }

  function consumeLocalLoginAttempt(scope: unknown, subject: unknown, limit: unknown, windowMs: unknown) {
    const key = `${scope}:${subject}`;
    const now = Date.now();
    const safeWindowMs = Math.max(1000, Math.trunc(Number(windowMs) || LOGIN_ATTEMPT_WINDOW_MS));
    const bucket = localLoginAttemptBuckets.get(key) || {
      count: 0,
      resetAt: now + safeWindowMs,
    };

    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + safeWindowMs;
    }

    bucket.count += 1;
    localLoginAttemptBuckets.set(key, bucket);
    return {
      allowed: bucket.count <= Number(limit),
      count: bucket.count,
      resetInMs: Math.max(0, bucket.resetAt - now),
    };
  }

  async function checkLoginAttemptAllowed(socket: PacketRecord | null | undefined, username: unknown, action = "login"): Promise<ValidationResult> {
    const subject = getLoginAttemptSubject(socket, String(username || ""));
    const checks: PacketRecord[] = [];
    const isTokenLogin = action === "refresh_token_login" || action === "token_login";
    const scopePrefix = isTokenLogin ? "auth:token" : "auth:login";
    const ipLimit = isTokenLogin ? TOKEN_LOGIN_ATTEMPT_LIMIT_IP : LOGIN_ATTEMPT_LIMIT_IP;
    const accountLimit = isTokenLogin ? TOKEN_LOGIN_ATTEMPT_LIMIT_ACCOUNT : LOGIN_ATTEMPT_LIMIT_ACCOUNT;

    if (redisStore.isReady()) {
      checks.push(await redisStore.checkRateLimit(`${scopePrefix}:ip`, subject.ipSubject, ipLimit, LOGIN_ATTEMPT_WINDOW_MS));
      if (subject.accountSubject) {
        checks.push(await redisStore.checkRateLimit(`${scopePrefix}:account`, subject.accountSubject, accountLimit, LOGIN_ATTEMPT_WINDOW_MS));
      }
    } else {
      checks.push(consumeLocalLoginAttempt(`${scopePrefix}:ip`, subject.ipSubject, ipLimit, LOGIN_ATTEMPT_WINDOW_MS));
      if (subject.accountSubject) {
        checks.push(consumeLocalLoginAttempt(`${scopePrefix}:account`, subject.accountSubject, accountLimit, LOGIN_ATTEMPT_WINDOW_MS));
      }
    }

    const blocked = checks.find((entry) => !entry.allowed);
    if (!blocked) return { ok: true };

    const retryMs = Math.max(1000, Math.trunc(Number(blocked.resetInMs) || LOGIN_ATTEMPT_WINDOW_MS));
    return {
      ok: false,
      action,
      retry_ms: retryMs,
      retry_after_seconds: Math.ceil(retryMs / 1000),
    };
  }

  function recordLoginAttempt(
    socket: PacketRecord | null | undefined,
    player: PacketRecord | null | undefined,
    username: unknown,
    action: unknown,
    ok: unknown,
    reason: unknown,
    data: PacketRecord = {},
  ): void {
    const details = {
      action: String(action || "login"),
      username: cleanAccountName(username || ""),
      ip: getSocketAddress(socket),
      user_agent: getSocketUserAgent(socket, data),
      device_info: getSocketDeviceInfo(socket, data),
      request_id: makeRequestId(data || {}),
      reason: String(reason || ""),
      ok: Boolean(ok),
    };
    logSecurityEvent(socket, player, ok ? "account_login_success" : "account_login_failed", details, ok ? "info" : "warning");
    postgresStore.recordLoginAttempt({
      ...details,
      success: Boolean(ok),
      at: new Date().toISOString(),
    });
  }

  return {
    applyPasswordResetToken,
    checkLoginAttemptAllowed,
    clearSessionToken,
    confirmEmailChangeToken,
    consumeLocalLoginAttempt,
    consumePasswordResetToken,
    findAccountByEmail,
    getLoginAttemptSubject,
    getMailTransporter,
    hasActiveEmailVerificationToken,
    hasPassword,
    isAccountEmailVerified,
    isRefreshTokenValid,
    isSessionTokenValid,
    issueSessionToken,
    issueSessionTokens,
    makeEmailChangeUrl,
    makeEmailVerificationToken,
    makeEmailVerificationUrl,
    makePasswordHash,
    makePasswordResetUrl,
    makeSecureToken,
    makeTokenHash,
    parsePasswordHashAlgorithm,
    queueEmailChangeEmail,
    queuePasswordResetEmail,
    queueVerificationEmail,
    recordLoginAttempt,
    sendEmailChangeEmail,
    sendPasswordResetEmail,
    sendVerificationEmail,
    validateEmail,
    validatePassword,
    validateUsername,
    verifyEmailToken,
    verifyPassword,
  };
}

export = {
  createServerAccountSessionHelpers,
  normalizeSocketAddress,
  resolveTrustedProxyClientAddress,
};
