"use strict";

export {};

type PacketRecord = Record<string, any>;

interface AccountAuthDeps extends Record<string, any> {}

function createServerAccountAuthRoutes(deps: AccountAuthDeps) {
  const {
    ACCOUNT_EMAIL_CHANGE_TTL_MS,
    ACCOUNT_ONE_ACTIVE_SESSION,
    ACCOUNT_PASSWORD_RESET_TTL_MS,
    DEV_BACKEND_LOGIN_ALLOWED,
    POSTGRES_AUTHORITATIVE,
    POSTGRES_ENABLED,
    PUNISHMENT_SCOPE_GLOBAL,
    accountKey,
    accounts,
    activatePlayerAccount,
    checkLoginAttemptAllowed,
    clampString,
    cleanAccountName,
    cleanEmail,
    cleanWorld,
    createDefaultPlayerState,
    ensurePlayerState,
    findAccountByEmail,
    formatPunishmentBlockMessage,
    getAccountRole,
    getBlockingPunishment,
    getSocketAddress,
    getSocketDeviceInfo,
    getSocketUserAgent,
    hasActiveEmailVerificationToken,
    hasPassword,
    isAccountEmailVerified,
    isPostgresAuthoritativeReady,
    isRefreshTokenValid,
    isSessionTokenValid,
    issueSessionTokens,
    localEmailChangeRequests,
    localPasswordResetRequests,
    logSecurityEvent,
    makeEmailVerificationToken,
    makePasswordHash,
    makeRequestId,
    makeSecureToken,
    makeTokenHash,
    notifyOnlineFriendsOfFriendState,
    normalizePlayerHotbarState,
    playerStates,
    postgresStore,
    publicPunishmentPayload,
    queueAccountsSave,
    queueEmailChangeEmail,
    queuePasswordResetEmail,
    queueVerificationEmail,
    recordLoginAttempt,
    refreshAccountFromPostgres,
    sanitizeAccountNameArray,
    sanitizeAccountState,
    sanitizeMovementMode,
    savePlayerState,
    sendAccountActionOk,
    sendAuthError,
    sendAuthOk,
    sendFriendState,
    sendVerificationRequired,
    updatePlayerWorldIndex,
    validateEmail,
    validatePassword,
    validateUsername,
    verifyPassword,
  } = deps;

  const authSlowStageMs = Math.max(250, Number(deps.AUTH_SLOW_STAGE_MS || 1000));

  function isAuthSocketOpen(socket: unknown): boolean {
    if (!socket || typeof socket !== "object") return true;
    const readyState = (socket as PacketRecord).readyState;
    return typeof readyState !== "number" || readyState === 1;
  }

  async function runAuthStage(socket: unknown, stage: string, work: () => Promise<any>): Promise<any> {
    const startedAt = Date.now();
    try {
      return await work();
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= authSlowStageMs) {
        console.warn("[auth] slow authentication stage", JSON.stringify({
          stage,
          duration_ms: durationMs,
          socket_open: isAuthSocketOpen(socket),
          postgres_write_queue_depth: Number(postgresStore?.writeQueueDepth || 0),
        }));
      }
    }
  }

  async function handleAccountRegister(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    const requestId = makeRequestId(data);
    const usernameValidation = validateUsername(data.username);
    if (!usernameValidation.ok) {
      sendAuthError(socket, requestId, "register", usernameValidation.message);
      return;
    }

    const emailValidation = validateEmail(data.email);
    if (!emailValidation.ok) {
      sendAuthError(socket, requestId, "register", emailValidation.message);
      return;
    }

    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.ok) {
      sendAuthError(socket, requestId, "register", passwordValidation.message);
      return;
    }

    const key = accountKey(usernameValidation.username);
    const existing = accounts.get(key);
    if (existing && hasPassword(existing) && isAccountEmailVerified(existing)) {
      sendAuthError(socket, requestId, "register", "Username is already registered.");
      return;
    }
    if (existing && hasPassword(existing) && cleanEmail(existing.email || "") !== emailValidation.email) {
      sendAuthError(socket, requestId, "register", "That username is waiting for verification with a different email.");
      return;
    }

    const emailOwner = findAccountByEmail(emailValidation.email);
    if (emailOwner && accountKey(emailOwner.username) !== key && isAccountEmailVerified(emailOwner)) {
      sendAuthError(socket, requestId, "register", "Email is already registered.");
      return;
    }
    if (emailOwner && accountKey(emailOwner.username) !== key && !isAccountEmailVerified(emailOwner)) {
      sendAuthError(socket, requestId, "register", "That email is already waiting for verification.");
      return;
    }

    const passwordHash = makePasswordHash(passwordValidation.password);
    const now = new Date().toISOString();
    const account = {
      ...(existing || {}),
      username: existing?.username || usernameValidation.username,
      email: emailValidation.email,
      password_salt: passwordHash.salt,
      password_hash: passwordHash.hash,
      password_algorithm: passwordHash.algorithm,
      session_token_hash: "",
      refresh_token_hash: "",
      refresh_token_expires_at: "",
      email_verified: false,
      email_verified_at: "",
      role: getAccountRole(usernameValidation.username),
      created_at: existing?.created_at || now,
      last_seen_at: now,
      friends: sanitizeAccountNameArray(existing?.friends || [], 200),
      friend_requests_in: sanitizeAccountNameArray(existing?.friend_requests_in || existing?.pending_friend_requests || [], 200),
      friend_requests_out: sanitizeAccountNameArray(existing?.friend_requests_out || [], 200),
    };

    const verificationToken = makeEmailVerificationToken(account);
    accounts.set(key, account);

    if (isPostgresAuthoritativeReady()) {
      const saved = await postgresStore.saveAccountState(account, { touchLogin: false });
      if (!saved) {
        if (existing) {
          accounts.set(key, existing);
        } else {
          accounts.delete(key);
        }
        sendAuthError(socket, requestId, "register", "Could not create account. Try again soon.", {
          reason: "account_save_failed",
        });
        return;
      }
    } else {
      postgresStore.mirrorAccount(account, { touchLogin: false });
    }

    queueAccountsSave();
    queueVerificationEmail(account, verificationToken);
    sendVerificationRequired(socket, requestId, "register", account, "Account created. Check your email to verify before signing on.");
  }

  async function handleAccountPasswordResetRequest(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    const requestId = makeRequestId(data);
    const action = "password_reset_request";
    const usernameValidation = validateUsername(data.username);
    const emailValidation = validateEmail(data.email);
    const genericMessage = "If that account matches, I sent a password reset email.";
    const fail = (message: string, reason: string, extra: PacketRecord = {}) => {
      sendAuthError(socket, requestId, action, message, { reason, ...extra });
      recordLoginAttempt(socket, player, cleanAccountName(data.username), action, false, reason || message, data);
    };

    if (!usernameValidation.ok) {
      fail(usernameValidation.message, "invalid_username");
      return;
    }

    if (!emailValidation.ok) {
      fail(emailValidation.message, "invalid_email");
      return;
    }

    const rateLimit = await checkLoginAttemptAllowed(socket, usernameValidation.username, action);
    if (!rateLimit.ok) {
      fail(`Too many reset attempts. Try again in ${rateLimit.retry_after_seconds}s.`, "rate_limited", {
        retry_after_seconds: rateLimit.retry_after_seconds,
        retry_ms: rateLimit.retry_ms,
      });
      return;
    }

    if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE && !isPostgresAuthoritativeReady()) {
      fail("Account recovery is temporarily unavailable. Try again soon.", "postgres_unavailable");
      return;
    }

    const account = await refreshAccountFromPostgres(usernameValidation.username)
      || accounts.get(accountKey(usernameValidation.username));
    if (!account || !hasPassword(account) || cleanEmail(account.email || "") !== emailValidation.email) {
      recordLoginAttempt(socket, player, usernameValidation.username, action, false, "account_or_email_mismatch", data);
      sendAccountActionOk(socket, requestId, action, genericMessage);
      return;
    }

    const token = makeSecureToken(32);
    const tokenHash = makeTokenHash(token);
    const expiresAt = new Date(Date.now() + ACCOUNT_PASSWORD_RESET_TTL_MS).toISOString();

    if (isPostgresAuthoritativeReady()) {
      const stored = await postgresStore.createAccountPasswordResetRequest({
        username: account.username,
        email: cleanEmail(account.email || ""),
        token_hash: tokenHash,
        expires_at: expiresAt,
        ip: getSocketAddress(socket),
        userAgent: getSocketUserAgent(socket, data),
        deviceInfo: getSocketDeviceInfo(socket, data),
        request_id: requestId,
      });
      if (!stored.ok) {
        fail("Could not start password reset. Try again soon.", stored.reason || "password_reset_store_failed");
        return;
      }
    } else {
      for (const [existingHash, entry] of localPasswordResetRequests.entries()) {
        if (accountKey(entry.username) === accountKey(account.username)) {
          localPasswordResetRequests.delete(existingHash);
        }
      }
      localPasswordResetRequests.set(tokenHash, {
        username: account.username,
        email: cleanEmail(account.email || ""),
        expires_at: expiresAt,
        used: false,
      });
    }

    queuePasswordResetEmail(account, token);
    recordLoginAttempt(socket, player, account.username, action, true, "email_sent", data);
    logSecurityEvent(socket, player, "account_password_reset_requested", {
      username: account.username,
      email: cleanEmail(account.email || ""),
      request_id: requestId,
      expires_at: expiresAt,
    }, "info");
    sendAccountActionOk(socket, requestId, action, genericMessage, {
      email: cleanEmail(account.email || ""),
      expires_at: expiresAt,
    });
  }

  async function handleAccountEmailChangeRequest(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    const requestId = makeRequestId(data);
    const action = "email_change_request";
    const usernameValidation = validateUsername(data.username);
    const newEmailValidation = validateEmail(data.email || data.new_email);
    const passwordValidation = validatePassword(data.password);
    const fail = (message: string, reason: string, extra: PacketRecord = {}) => {
      sendAuthError(socket, requestId, action, message, { reason, ...extra });
      recordLoginAttempt(socket, player, cleanAccountName(data.username), action, false, reason || message, data);
    };

    if (!usernameValidation.ok) {
      fail(usernameValidation.message, "invalid_username");
      return;
    }

    if (!newEmailValidation.ok) {
      fail(newEmailValidation.message, "invalid_new_email");
      return;
    }

    if (!passwordValidation.ok) {
      fail(passwordValidation.message, "invalid_password");
      return;
    }

    const rateLimit = await checkLoginAttemptAllowed(socket, usernameValidation.username, action);
    if (!rateLimit.ok) {
      fail(`Too many email change attempts. Try again in ${rateLimit.retry_after_seconds}s.`, "rate_limited", {
        retry_after_seconds: rateLimit.retry_after_seconds,
        retry_ms: rateLimit.retry_ms,
      });
      return;
    }

    if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE && !isPostgresAuthoritativeReady()) {
      fail("Email change is temporarily unavailable. Try again soon.", "postgres_unavailable");
      return;
    }

    const account = await refreshAccountFromPostgres(usernameValidation.username)
      || accounts.get(accountKey(usernameValidation.username));
    if (!account || !hasPassword(account) || !verifyPassword(account, passwordValidation.password)) {
      fail("Username or password is wrong.", "password_mismatch");
      return;
    }

    const oldEmail = cleanEmail(account.email || "");
    const newEmail = newEmailValidation.email;
    if (newEmail === oldEmail) {
      fail("That email is already on this account.", "email_unchanged");
      return;
    }

    const emailOwner = findAccountByEmail(newEmail);
    if (emailOwner && accountKey(emailOwner.username) !== accountKey(account.username)) {
      fail("Email is already registered.", "email_in_use");
      return;
    }

    const token = makeSecureToken(32);
    const tokenHash = makeTokenHash(token);
    const expiresAt = new Date(Date.now() + ACCOUNT_EMAIL_CHANGE_TTL_MS).toISOString();

    if (isPostgresAuthoritativeReady()) {
      const stored = await postgresStore.createAccountEmailChangeRequest({
        username: account.username,
        old_email: oldEmail,
        new_email: newEmail,
        token_hash: tokenHash,
        expires_at: expiresAt,
        ip: getSocketAddress(socket),
        userAgent: getSocketUserAgent(socket, data),
        deviceInfo: getSocketDeviceInfo(socket, data),
        request_id: requestId,
      });
      if (!stored.ok) {
        fail("Could not start email change. Try again soon.", stored.reason || "email_change_store_failed");
        return;
      }
    } else {
      for (const [existingHash, entry] of localEmailChangeRequests.entries()) {
        if (accountKey(entry.username) === accountKey(account.username)) {
          localEmailChangeRequests.delete(existingHash);
        }
      }
      localEmailChangeRequests.set(tokenHash, {
        username: account.username,
        old_email: oldEmail,
        new_email: newEmail,
        expires_at: expiresAt,
        used: false,
      });
    }

    queueEmailChangeEmail(account, newEmail, token);
    recordLoginAttempt(socket, player, account.username, action, true, "email_sent", data);
    logSecurityEvent(socket, player, "account_email_change_requested", {
      username: account.username,
      old_email: oldEmail,
      new_email: newEmail,
      request_id: requestId,
      expires_at: expiresAt,
    }, "info");
    sendAccountActionOk(socket, requestId, action, "Check your new email to confirm the change.", {
      email: oldEmail,
      new_email: newEmail,
      expires_at: expiresAt,
    });
  }

  function ensureDevBackendAccount(username: unknown): PacketRecord | null {
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.ok) return null;

    const cleanUsername = usernameValidation.username;
    const key = accountKey(cleanUsername);
    const now = new Date().toISOString();
    let account = accounts.get(key);

    if (!account) {
      account = {
        username: cleanUsername,
        email: `${cleanUsername.toLowerCase()}@dev.local.invalid`,
        password_salt: "",
        password_hash: "",
        password_algorithm: "",
        session_token_hash: "",
        session_token_expires_at: "",
        refresh_token_hash: "",
        refresh_token_expires_at: "",
        email_verified: true,
        email_verified_at: now,
        email_verification_token_hash: "",
        email_verification_expires_at: "",
        role: getAccountRole(cleanUsername),
        created_at: now,
        last_seen_at: now,
        friends: [],
        friend_requests_in: [],
        friend_requests_out: [],
      };
      accounts.set(key, account);
      queueAccountsSave();
      postgresStore.mirrorAccount(account, { touchLogin: false });
    } else {
      account.last_seen_at = now;
      if (cleanEmail(account.email || "") === "") {
        account.email = `${cleanUsername.toLowerCase()}@dev.local.invalid`;
      }
    }

    return account;
  }

  function ensureDevBackendPlayerState(username: unknown): PacketRecord | null {
    const cleanUsername = cleanAccountName(username);
    if (cleanUsername === "") return null;

    const key = accountKey(cleanUsername);
    let state = ensurePlayerState(cleanUsername);
    if (!state) {
      state = createDefaultPlayerState(cleanUsername);
    }

    if (!state || typeof state !== "object" || Array.isArray(state)) return null;

    state.account_username = cleanUsername;
    if (!state.inventory || typeof state.inventory !== "object" || Array.isArray(state.inventory)) {
      state.inventory = {};
    }
    if (!state.tool_inventory || typeof state.tool_inventory !== "object" || Array.isArray(state.tool_inventory)) {
      state.tool_inventory = {};
    }

    for (const blockId of ["dirt", "grass", "stone", "wood", "leaf"]) {
      if (!Number.isFinite(Number(state.inventory[blockId])) || Number(state.inventory[blockId]) < 50) {
        state.inventory[blockId] = 200;
      }
    }
    // Punch is the reserved base action/hotbar tool, not a persisted inventory item.
    delete state.tool_inventory.punch;
    state.selected_item_type = clampString(state.selected_item_type || "punch");
    state.selected_item_category = clampString(state.selected_item_category || "tool");
    state.primary_hotbar_tool = clampString(state.primary_hotbar_tool || "punch");
    state.hotbar_items = ["punch", "dirt", "grass", "stone", "wood", "leaf"];
    state.hotbar_item_categories = ["tool", "block", "block", "block", "block", "block"];
    state.saved_at = new Date().toISOString();

    normalizePlayerHotbarState(state);
    playerStates.set(key, state);
    savePlayerState(cleanUsername);
    return state;
  }

  async function handleDevBackendLogin(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    const requestId = makeRequestId(data);
    const usernameValidation = validateUsername(data.username || data.dev_profile || data.profile || "");
    const action = "dev_backend_login";
    const fail = (message: string, reason: string, extra: PacketRecord = {}) => {
      sendAuthError(socket, requestId, action, message, { reason, ...extra });
    };

    if (!DEV_BACKEND_LOGIN_ALLOWED) {
      console.warn("[SECURITY] Backend dev login is disabled outside development.");
      fail("[SECURITY] Backend dev login is disabled outside development.", "dev_backend_login_disabled");
      return;
    }

    if (!usernameValidation.ok) {
      fail(usernameValidation.message || "Invalid dev profile.", "invalid_username");
      return;
    }

    const account = ensureDevBackendAccount(usernameValidation.username);
    if (!account) {
      fail("Could not create dev backend account.", "account_create_failed");
      return;
    }

    account.last_seen_at = new Date().toISOString();
    const tokens = issueSessionTokens(account);

    if (isPostgresAuthoritativeReady()) {
      const sessionResult = await postgresStore.saveSession(account, {
        ip: getSocketAddress(socket),
        userAgent: getSocketUserAgent(socket, data),
        deviceInfo: getSocketDeviceInfo(socket, data),
        sessionMode: "dev_backend_login",
      });
      if (!sessionResult.ok) {
        fail("Could not create dev backend session.", "session_create_failed");
        return;
      }
    } else {
      postgresStore.mirrorSession(account, {
        ip: getSocketAddress(socket),
        userAgent: getSocketUserAgent(socket, data),
        deviceInfo: getSocketDeviceInfo(socket, data),
        sessionMode: "dev_backend_login",
      });
    }

    const state = ensureDevBackendPlayerState(account.username);
    if (!state) {
      fail("Could not create dev backend inventory.", "inventory_create_failed");
      return;
    }

    const activation = activatePlayerAccount(socket, player, account, { replaceExisting: true });
    if (!activation.ok) {
      fail(activation.message, "activation_failed");
      return;
    }

    const worldName = cleanWorld(data.world || "NETFOX_TEST");
    player.world = worldName;
    player.current_world = worldName;
    player.current_world_id = worldName;
    player.joined_world = true;
    updatePlayerWorldIndex(player);
    postgresStore.mirrorAccount(account, { touchLogin: true });
    console.log("[DEV] Backend dev login authenticated", {
      username: account.username,
      player_id: player.id,
      world: worldName,
      movement_mode: sanitizeMovementMode(data.movement_mode || player.movement_mode),
    });

    sendAuthOk(socket, requestId, action, account, tokens);
    sendFriendState(socket, account.username, requestId);
    notifyOnlineFriendsOfFriendState(account.username);
  }

  async function handleAccountLogin(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    const requestId = makeRequestId(data);
    const username = cleanAccountName(data.username);
    const email = cleanEmail(data.email || "");
    const fail = (message: string, reason: string, extra: PacketRecord = {}) => {
      sendAuthError(socket, requestId, "login", message, extra);
      recordLoginAttempt(socket, player, username, "login", false, reason || message, data);
    };

    if (username === "") {
      fail("Enter your username.", "missing_username");
      return;
    }

    const rateLimit = await runAuthStage(socket, "password_login_rate_limit", () => (
      checkLoginAttemptAllowed(socket, username, "login")
    ));
    if (!isAuthSocketOpen(socket)) return;
    if (!rateLimit.ok) {
      fail(`Too many login attempts. Try again in ${rateLimit.retry_after_seconds}s.`, "rate_limited", {
        retry_after_seconds: rateLimit.retry_after_seconds,
        retry_ms: rateLimit.retry_ms,
      });
      return;
    }

    if (email === "") {
      fail("Enter your email address.", "missing_email");
      return;
    }

    let account = await runAuthStage(socket, "password_login_account_refresh", () => (
      refreshAccountFromPostgres(username)
    ))
      || accounts.get(accountKey(username));
    if (!isAuthSocketOpen(socket)) return;
    if (!account || !hasPassword(account)) {
      fail("Username not found.", "username_not_found");
      return;
    }

    if (email !== cleanEmail(account.email || "")) {
      fail("Email does not match that username.", "email_mismatch");
      return;
    }

    if (!verifyPassword(account, data.password)) {
      fail("Password does not match.", "password_mismatch");
      return;
    }

    if (!account.password_algorithm || account.password_algorithm === "legacy_scrypt") {
      const upgradedPasswordHash = makePasswordHash(data.password);
      account.password_salt = upgradedPasswordHash.salt;
      account.password_hash = upgradedPasswordHash.hash;
      account.password_algorithm = upgradedPasswordHash.algorithm;
      queueAccountsSave();
    }

    if (!isAccountEmailVerified(account)) {
      if (hasActiveEmailVerificationToken(account)) {
        fail("Verify your email before signing on. Check your email for the verification link.", "email_not_verified", {
          requires_email_verification: true,
          email: cleanEmail(account.email || ""),
        });
        return;
      }

      const verificationToken = makeEmailVerificationToken(account);
      queueAccountsSave();
      queueVerificationEmail(account, verificationToken);
      fail("Verify your email before signing on. I sent a new verification email.", "email_not_verified_new_link", {
        requires_email_verification: true,
        email: cleanEmail(account.email || ""),
      });
      return;
    }

    const loginPunishment = await runAuthStage(socket, "password_login_punishment", () => (
      getBlockingPunishment(account.username, ["ban", "lockout"], {
        scope: PUNISHMENT_SCOPE_GLOBAL,
      })
    ));
    if (!isAuthSocketOpen(socket)) return;
    if (loginPunishment) {
      fail(formatPunishmentBlockMessage("login", loginPunishment), "punishment_blocked", {
        punishment: publicPunishmentPayload(loginPunishment),
      });
      logSecurityEvent(socket, player, "punishment_blocked_login", {
        target_username: account.username,
        punishment_type: loginPunishment.punishment_type,
        punishment_id: loginPunishment.punishment_id,
      }, "warning");
      return;
    }

    account.last_seen_at = new Date().toISOString();
    const previousSessionHash = cleanAccountName(account.session_token_hash || "");
    const previousSessionExpiresAt = String(account.session_token_expires_at || "");
    const previousRefreshHash = cleanAccountName(account.refresh_token_hash || "");
    const previousRefreshExpiresAt = String(account.refresh_token_expires_at || "");
    const tokens = issueSessionTokens(account);

    if (isPostgresAuthoritativeReady()) {
      const sessionResult = await runAuthStage(socket, "password_login_session_save", () => (
        postgresStore.saveSession(account, {
          ip: getSocketAddress(socket),
          userAgent: getSocketUserAgent(socket, data),
          deviceInfo: getSocketDeviceInfo(socket, data),
          sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
          concurrent: true,
          revokeOtherSessions: ACCOUNT_ONE_ACTIVE_SESSION,
          shouldContinue: () => isAuthSocketOpen(socket),
        })
      ));
      if (!sessionResult.ok) {
        account.session_token_hash = previousSessionHash;
        account.session_token_expires_at = previousSessionExpiresAt;
        account.refresh_token_hash = previousRefreshHash;
        account.refresh_token_expires_at = previousRefreshExpiresAt;
        queueAccountsSave();
        if (sessionResult.reason === "aborted" || !isAuthSocketOpen(socket)) return;
        fail("Could not create your saved login session. Try again.", "session_create_failed");
        return;
      }
    } else {
      postgresStore.mirrorSession(account, {
        ip: getSocketAddress(socket),
        userAgent: getSocketUserAgent(socket, data),
        deviceInfo: getSocketDeviceInfo(socket, data),
        sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
      });
    }

    if (!isAuthSocketOpen(socket)) return;
    const activation = activatePlayerAccount(socket, player, account, { replaceExisting: true });
    if (!activation.ok) {
      fail(activation.message, "activation_failed");
      return;
    }

    postgresStore.mirrorAccount(account, { touchLogin: true });
    recordLoginAttempt(socket, player, account.username, "login", true, "success", data);
    sendAuthOk(socket, requestId, "login", account, tokens);
    sendFriendState(socket, account.username, requestId);
    notifyOnlineFriendsOfFriendState(account.username);
  }

  async function handleAccountTokenLogin(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    const requestId = makeRequestId(data);
    const username = cleanAccountName(data.username);
    const token = String(data.refresh_token || data.session_token || "").trim();
    const usingRefreshToken = String(data.refresh_token || "").trim() !== "";
    const fail = (message: string, reason: string, extra: PacketRecord = {}) => {
      const cleanReason = reason || message;
      sendAuthError(socket, requestId, "token_login", message, { reason: cleanReason, ...extra });
      recordLoginAttempt(socket, player, username, usingRefreshToken ? "refresh_token_login" : "token_login", false, cleanReason, data);
    };

    if (username === "" || token === "") {
      fail("Saved login expired. Sign on again.", "missing_token");
      return;
    }

    const rateLimit = await runAuthStage(socket, "token_login_rate_limit", () => (
      checkLoginAttemptAllowed(socket, username, usingRefreshToken ? "refresh_token_login" : "token_login")
    ));
    if (!isAuthSocketOpen(socket)) return;
    if (!rateLimit.ok) {
      fail(`Too many login attempts. Try again in ${rateLimit.retry_after_seconds}s.`, "rate_limited", {
        retry_after_seconds: rateLimit.retry_after_seconds,
        retry_ms: rateLimit.retry_ms,
      });
      return;
    }

    const tokenHash = makeTokenHash(token);
    let account = accounts.get(accountKey(username));
    let previousSessionHash = cleanAccountName(account?.session_token_hash || tokenHash);
    let previousSessionExpiresAt = String(account?.session_token_expires_at || "");
    let previousRefreshHash = cleanAccountName(account?.refresh_token_hash || "");
    let previousRefreshExpiresAt = String(account?.refresh_token_expires_at || "");

    if (isPostgresAuthoritativeReady()) {
      const validation = await runAuthStage(socket, "token_login_session_validation", () => (
        postgresStore.validateSessionToken(username, tokenHash, {
          ip: getSocketAddress(socket),
          userAgent: getSocketUserAgent(socket, data),
          deviceInfo: getSocketDeviceInfo(socket, data),
          tokenKind: usingRefreshToken ? "refresh" : "session_or_refresh",
          concurrent: true,
          shouldContinue: () => isAuthSocketOpen(socket),
        })
      ));
      if (validation.reason === "aborted" || !isAuthSocketOpen(socket)) return;
      if (!validation.ok) {
        fail("Saved login expired. Sign on again.", validation.reason || "invalid_or_expired");
        return;
      }

      const validatedAccount = sanitizeAccountState(validation.account);
      if (!validatedAccount) {
        fail("Saved login expired. Sign on again.", "invalid_account_state");
        return;
      }

      account = accounts.get(accountKey(validatedAccount.username)) || validatedAccount;
      Object.assign(account, validatedAccount);
      accounts.set(accountKey(account.username), account);
      previousSessionHash = cleanAccountName(account.session_token_hash || validation.session_token_hash || "");
      previousSessionExpiresAt = String(account.session_token_expires_at || validation.expires_at || "");
      previousRefreshHash = cleanAccountName(account.refresh_token_hash || validation.refresh_token_hash || "");
      previousRefreshExpiresAt = String(account.refresh_token_expires_at || validation.refresh_expires_at || "");
    } else if (!isSessionTokenValid(account, token) && !isRefreshTokenValid(account, token)) {
      fail("Saved login expired. Sign on again.", "invalid_or_expired");
      return;
    }

    if (!isAccountEmailVerified(account)) {
      fail("Verify your email before signing on.", "email_not_verified", {
        requires_email_verification: true,
        email: cleanEmail(account.email || ""),
      });
      return;
    }

    const loginPunishment = await runAuthStage(socket, "token_login_punishment", () => (
      getBlockingPunishment(account.username, ["ban", "lockout"], {
        scope: PUNISHMENT_SCOPE_GLOBAL,
      })
    ));
    if (!isAuthSocketOpen(socket)) return;
    if (loginPunishment) {
      fail(formatPunishmentBlockMessage("login", loginPunishment), "punishment_blocked", {
        punishment: publicPunishmentPayload(loginPunishment),
      });
      logSecurityEvent(socket, player, "punishment_blocked_token_login", {
        target_username: account.username,
        punishment_type: loginPunishment.punishment_type,
        punishment_id: loginPunishment.punishment_id,
      }, "warning");
      return;
    }

    if (!isAuthSocketOpen(socket)) return;
    account.last_seen_at = new Date().toISOString();
    const nextTokens = issueSessionTokens(account);

    if (isPostgresAuthoritativeReady()) {
      const sessionResult = await runAuthStage(socket, "token_login_session_rotation", () => (
        postgresStore.saveSession(account, {
          ip: getSocketAddress(socket),
          userAgent: getSocketUserAgent(socket, data),
          deviceInfo: getSocketDeviceInfo(socket, data),
          rotatedFromTokenHash: tokenHash,
          sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
          concurrent: true,
          revokeRotatedToken: true,
          revokeOtherSessions: ACCOUNT_ONE_ACTIVE_SESSION,
          shouldContinue: () => isAuthSocketOpen(socket),
        })
      ));
      if (!sessionResult.ok) {
        account.session_token_hash = previousSessionHash;
        account.session_token_expires_at = previousSessionExpiresAt;
        account.refresh_token_hash = previousRefreshHash;
        account.refresh_token_expires_at = previousRefreshExpiresAt;
        queueAccountsSave();
        if (sessionResult.reason === "aborted" || !isAuthSocketOpen(socket)) return;
        fail("Could not refresh your saved login. Sign on again.", "session_refresh_failed");
        return;
      }
    } else {
      postgresStore.mirrorSession(account, {
        ip: getSocketAddress(socket),
        userAgent: getSocketUserAgent(socket, data),
        deviceInfo: getSocketDeviceInfo(socket, data),
        sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
      });
    }

    if (!isAuthSocketOpen(socket)) return;
    const activation = activatePlayerAccount(socket, player, account, { replaceExisting: true });
    if (!activation.ok) {
      fail(activation.message, "activation_failed");
      return;
    }

    postgresStore.mirrorAccount(account, { touchLogin: true });
    recordLoginAttempt(socket, player, account.username, usingRefreshToken ? "refresh_token_login" : "token_login", true, "success", data);
    sendAuthOk(socket, requestId, "token_login", account, nextTokens);
    sendFriendState(socket, account.username, requestId);
    notifyOnlineFriendsOfFriendState(account.username);
  }

  return {
    ensureDevBackendAccount,
    ensureDevBackendPlayerState,
    handleAccountEmailChangeRequest,
    handleAccountLogin,
    handleAccountPasswordResetRequest,
    handleAccountRegister,
    handleAccountTokenLogin,
    handleDevBackendLogin,
  };
}

module.exports = {
  createServerAccountAuthRoutes,
};
