"use strict";

const logTargetStorageKey = "pixelmania_ops_log_target";
const viewTabStorageKey = "pixelmania_ops_view_tab";
localStorage.removeItem("pixelmania_ops_token");
let activeLogTarget = localStorage.getItem(logTargetStorageKey) || "main";
let activeView = localStorage.getItem(viewTabStorageKey) || "overview";
let statusTimer = null;
let logsTimer = null;
let deployTimer = null;
let auditTimer = null;
let resourcesTimer = null;
let accountTimer = null;
let databaseTimer = null;
let errorsTimer = null;
let allowedActions = new Set();
let pendingLoginChallenge = null;
let latestIncidentSnapshot = null;
const resetToken = new URLSearchParams(window.location.search).get("reset") || "";

const elements = {
  loginCard: document.getElementById("loginCard"),
  resetCard: document.getElementById("resetCard"),
  loginError: document.getElementById("loginError"),
  usernameInput: document.getElementById("usernameInput"),
  passwordInput: document.getElementById("passwordInput"),
  loginCodeBox: document.getElementById("loginCodeBox"),
  loginCodeInput: document.getElementById("loginCodeInput"),
  loginCodeButton: document.getElementById("loginCodeButton"),
  loginCodeState: document.getElementById("loginCodeState"),
  resetEmailInput: document.getElementById("resetEmailInput"),
  resetRequestButton: document.getElementById("resetRequestButton"),
  resetRequestState: document.getElementById("resetRequestState"),
  resetNewPasswordInput: document.getElementById("resetNewPasswordInput"),
  resetConfirmPasswordInput: document.getElementById("resetConfirmPasswordInput"),
  resetPasswordState: document.getElementById("resetPasswordState"),
  logoutButton: document.getElementById("logoutButton"),
  notice: document.getElementById("notice"),
  statusPill: document.getElementById("statusPill"),
  statusLabel: document.getElementById("statusLabel"),
  uptimeValue: document.getElementById("uptimeValue"),
  playersValue: document.getElementById("playersValue"),
  worldsValue: document.getElementById("worldsValue"),
  memoryValue: document.getElementById("memoryValue"),
  databaseValue: document.getElementById("databaseValue"),
  redisValue: document.getElementById("redisValue"),
  tickValue: document.getElementById("tickValue"),
  networkValue: document.getElementById("networkValue"),
  resourcesState: document.getElementById("resourcesState"),
  resourceCpu: document.getElementById("resourceCpu"),
  resourceCpuDetail: document.getElementById("resourceCpuDetail"),
  resourceRam: document.getElementById("resourceRam"),
  resourceRamDetail: document.getElementById("resourceRamDetail"),
  resourceDisk: document.getElementById("resourceDisk"),
  resourceDiskDetail: document.getElementById("resourceDiskDetail"),
  resourceUptime: document.getElementById("resourceUptime"),
  resourceHost: document.getElementById("resourceHost"),
  processGrid: document.getElementById("processGrid"),
  accountState: document.getElementById("accountState"),
  accountEmail: document.getElementById("accountEmail"),
  accountPendingEmail: document.getElementById("accountPendingEmail"),
  accountVerified: document.getElementById("accountVerified"),
  accountVerificationDetail: document.getElementById("accountVerificationDetail"),
  accountSessions: document.getElementById("accountSessions"),
  accountSessionDetail: document.getElementById("accountSessionDetail"),
  accountMail: document.getElementById("accountMail"),
  accountMailDetail: document.getElementById("accountMailDetail"),
  accountLoginCode: document.getElementById("accountLoginCode"),
  accountLoginCodeDetail: document.getElementById("accountLoginCodeDetail"),
  accountMessage: document.getElementById("accountMessage"),
  sendVerificationButton: document.getElementById("sendVerificationButton"),
  logoutAllButton: document.getElementById("logoutAllButton"),
  changeEmailForm: document.getElementById("changeEmailForm"),
  newEmailInput: document.getElementById("newEmailInput"),
  emailPasswordInput: document.getElementById("emailPasswordInput"),
  changePasswordForm: document.getElementById("changePasswordForm"),
  currentPasswordInput: document.getElementById("currentPasswordInput"),
  newPasswordInput: document.getElementById("newPasswordInput"),
  confirmPasswordInput: document.getElementById("confirmPasswordInput"),
  deployVersionState: document.getElementById("deployVersionState"),
  deployCurrentCommit: document.getElementById("deployCurrentCommit"),
  deployCurrentSubject: document.getElementById("deployCurrentSubject"),
  deployRemoteCommit: document.getElementById("deployRemoteCommit"),
  deployRemoteSubject: document.getElementById("deployRemoteSubject"),
  rollbackTargetCommit: document.getElementById("rollbackTargetCommit"),
  rollbackTargetSubject: document.getElementById("rollbackTargetSubject"),
  deployGuardState: document.getElementById("deployGuardState"),
  deployGuardDetail: document.getElementById("deployGuardDetail"),
  deployLastState: document.getElementById("deployLastState"),
  deployLastDetail: document.getElementById("deployLastDetail"),
  rollbackLastState: document.getElementById("rollbackLastState"),
  rollbackLastDetail: document.getElementById("rollbackLastDetail"),
  deployHealthList: document.getElementById("deployHealthList"),
  deployDirtyList: document.getElementById("deployDirtyList"),
  auditState: document.getElementById("auditState"),
  auditTable: document.getElementById("auditTable"),
  routesGrid: document.getElementById("routesGrid"),
  worldsTable: document.getElementById("worldsTable"),
  routeTestState: document.getElementById("routeTestState"),
  routeTestButton: document.getElementById("routeTestButton"),
  routeTestGrid: document.getElementById("routeTestGrid"),
  databaseHealthState: document.getElementById("databaseHealthState"),
  databaseHealthGrid: document.getElementById("databaseHealthGrid"),
  errorSummaryState: document.getElementById("errorSummaryState"),
  errorSummaryOutput: document.getElementById("errorSummaryOutput"),
  refreshErrorsButton: document.getElementById("refreshErrorsButton"),
  copyIncidentButton: document.getElementById("copyIncidentButton"),
  downloadIncidentButton: document.getElementById("downloadIncidentButton"),
  incidentSnapshotState: document.getElementById("incidentSnapshotState"),
  incidentSnapshotMessage: document.getElementById("incidentSnapshotMessage"),
  incidentSnapshotPreview: document.getElementById("incidentSnapshotPreview"),
  consoleOutput: document.getElementById("consoleOutput"),
  consoleState: document.getElementById("consoleState"),
  debugReportButton: document.getElementById("debugReportButton"),
  debugReportState: document.getElementById("debugReportState"),
  actionState: document.getElementById("actionState"),
  actionOutput: document.getElementById("actionOutput"),
  refreshButton: document.getElementById("refreshButton"),
  confirmDialog: document.getElementById("confirmDialog"),
  confirmForm: document.getElementById("confirmForm"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmText: document.getElementById("confirmText"),
  confirmInputWrap: document.getElementById("confirmInputWrap"),
  confirmInputLabel: document.getElementById("confirmInputLabel"),
  confirmInput: document.getElementById("confirmInput"),
  confirmError: document.getElementById("confirmError"),
  confirmCancel: document.getElementById("confirmCancel"),
  confirmSubmit: document.getElementById("confirmSubmit"),
};

let confirmationRequiredActions = new Set(["stop", "deploy", "rollback"]);
let pendingConfirmation = null;
const logButtons = Array.from(document.querySelectorAll("[data-log-target]"));
const viewButtons = Array.from(document.querySelectorAll("[data-view-tab]"));
const viewPanels = Array.from(document.querySelectorAll("[data-view-panel]"));

elements.loginCard.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = elements.usernameInput.value.trim();
  const password = elements.passwordInput.value;
  elements.loginError.textContent = "";
  if (!username || !password) return;
  try {
    const data = await apiFetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    elements.passwordInput.value = "";
    if (data.code_required) {
      showLoginCodeChallenge(data);
      return;
    }
    unlock();
  } catch (error) {
    elements.passwordInput.value = "";
    elements.loginError.textContent = error.message || "Could not sign in.";
  }
});

elements.loginCodeButton.addEventListener("click", async () => {
  await verifyLoginCode();
});

elements.loginCodeInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await verifyLoginCode();
  }
});

elements.refreshButton.addEventListener("click", () => {
  refreshAll();
});

elements.logoutButton.addEventListener("click", async () => {
  try {
    await apiFetch("/api/logout", { method: "POST" });
  } catch (_error) {
    // Logging out should still clear the local UI even if the network request fails.
  }
  lock();
});

elements.resetRequestButton.addEventListener("click", async () => {
  await requestPasswordReset();
});

elements.resetCard.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitPasswordReset();
});

elements.sendVerificationButton.addEventListener("click", async () => {
  await sendVerificationEmail();
});

elements.logoutAllButton.addEventListener("click", async () => {
  await logoutAllSessions();
});

elements.changeEmailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await changeAccountEmail();
});

elements.changePasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await changeAccountPassword();
});

elements.routeTestButton.addEventListener("click", async () => {
  await loadRouteTests();
});

elements.refreshErrorsButton.addEventListener("click", async () => {
  await loadErrorSummary();
});

elements.copyIncidentButton.addEventListener("click", async () => {
  await copyIncidentSnapshot();
});

elements.downloadIncidentButton.addEventListener("click", async () => {
  await downloadIncidentSnapshot();
});

for (const button of logButtons) {
  button.addEventListener("click", () => {
    setActiveLogTarget(button.dataset.logTarget || "main");
  });
}

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    setActiveView(button.dataset.viewTab || "overview");
  });
}

elements.debugReportButton.addEventListener("click", () => {
  copyDebugReport();
});

elements.confirmForm.addEventListener("submit", (event) => {
  event.preventDefault();
  resolveActionConfirmation();
});

elements.confirmCancel.addEventListener("click", () => {
  closeActionConfirmation(null);
});

elements.confirmDialog.addEventListener("click", (event) => {
  if (event.target === elements.confirmDialog) {
    closeActionConfirmation(null);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.confirmDialog.classList.contains("hidden")) {
    closeActionConfirmation(null);
  }
});

for (const button of document.querySelectorAll("[data-action]")) {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    await runAction(action);
  });
}

if (resetToken) {
  showResetCard();
} else {
  checkSession();
}

async function checkSession() {
  try {
    await apiFetch("/api/session");
    unlock();
  } catch (_error) {
    lock();
  }
}

function unlock() {
  clearTimers();
  document.body.classList.add("unlocked");
  elements.loginCard.classList.remove("hidden");
  elements.resetCard.classList.add("hidden");
  hideLoginCodeChallenge();
  renderViewTabs();
  renderLogTabs();
  refreshAll();
  statusTimer = window.setInterval(loadStatus, 5000);
  logsTimer = window.setInterval(loadLogs, 6000);
  deployTimer = window.setInterval(loadDeployStatus, 30000);
  auditTimer = window.setInterval(loadAuditLog, 15000);
  resourcesTimer = window.setInterval(loadResources, 10000);
  accountTimer = window.setInterval(loadAccount, 30000);
  databaseTimer = window.setInterval(loadDatabaseHealth, 15000);
  errorsTimer = window.setInterval(loadErrorSummary, 30000);
}

function lock() {
  clearTimers();
  document.body.classList.remove("unlocked");
  elements.loginCard.classList.remove("hidden");
  elements.resetCard.classList.add("hidden");
  window.setTimeout(() => {
    elements.usernameInput.focus();
  }, 0);
}

function showResetCard() {
  clearTimers();
  document.body.classList.remove("unlocked");
  elements.loginCard.classList.add("hidden");
  elements.resetCard.classList.remove("hidden");
  window.setTimeout(() => {
    elements.resetNewPasswordInput.focus();
  }, 0);
}

function clearTimers() {
  window.clearInterval(statusTimer);
  window.clearInterval(logsTimer);
  window.clearInterval(deployTimer);
  window.clearInterval(auditTimer);
  window.clearInterval(resourcesTimer);
  window.clearInterval(accountTimer);
  window.clearInterval(databaseTimer);
  window.clearInterval(errorsTimer);
  statusTimer = null;
  logsTimer = null;
  deployTimer = null;
  auditTimer = null;
  resourcesTimer = null;
  accountTimer = null;
  databaseTimer = null;
  errorsTimer = null;
}

async function refreshAll() {
  await Promise.allSettled([
    loadStatus(),
    loadLogs(),
    loadActions(),
    loadDeployStatus(),
    loadAuditLog(),
    loadResources(),
    loadAccount(),
    loadDatabaseHealth(),
    loadErrorSummary(),
  ]);
}

async function loadStatus() {
  try {
    const data = await apiFetch("/api/status");
    renderStatus(data);
  } catch (error) {
    showNotice(error.message || "Could not load status.");
    renderOffline();
  }
}

async function loadLogs() {
  try {
    const data = await apiFetch(`/api/logs?target=${encodeURIComponent(activeLogTarget)}&lines=220`);
    elements.consoleState.textContent = data.ok ? `${data.label || activeLogTarget} live` : "unavailable";
    elements.consoleOutput.textContent = data.text || data.error || "No logs yet.";
    renderAction(data.current_action, data.history && data.history[0]);
  } catch (error) {
    elements.consoleState.textContent = "offline";
    elements.consoleOutput.textContent = error.message || "Could not load logs.";
  }
}

async function loadDeployStatus() {
  try {
    const data = await apiFetch("/api/deploy-status");
    renderDeployStatus(data);
  } catch (error) {
    renderDeployStatusError(error.message || "Could not load deploy status.");
  }
}

async function loadAuditLog() {
  try {
    const data = await apiFetch("/api/audit-log?limit=25");
    renderAuditLog(data);
  } catch (error) {
    renderAuditLogError(error.message || "Could not load audit log.");
  }
}

async function loadResources() {
  try {
    const data = await apiFetch("/api/resources");
    renderResources(data);
  } catch (error) {
    renderResourcesError(error.message || "Could not load resources.");
  }
}

async function loadAccount() {
  try {
    const data = await apiFetch("/api/account");
    renderAccount(data);
  } catch (error) {
    renderAccountError(error.message || "Could not load account.");
  }
}

async function loadDatabaseHealth() {
  try {
    const data = await apiFetch("/api/database-health");
    renderDatabaseHealth(data);
  } catch (error) {
    renderDatabaseHealthError(error.message || "Could not load database health.");
  }
}

async function loadErrorSummary() {
  elements.errorSummaryState.textContent = "checking";
  try {
    const data = await apiFetch("/api/logs?target=errors&lines=320");
    renderErrorSummary(data);
  } catch (error) {
    elements.errorSummaryState.textContent = "unavailable";
    elements.errorSummaryState.className = "status-danger";
    elements.errorSummaryOutput.textContent = error.message || "Could not load errors.";
  }
}

async function loadRouteTests() {
  elements.routeTestButton.disabled = true;
  elements.routeTestState.textContent = "testing";
  elements.routeTestGrid.innerHTML = '<article class="route-test-card muted">Testing routes...</article>';
  try {
    const data = await apiFetch("/api/route-tests");
    renderRouteTests(data);
  } catch (error) {
    elements.routeTestState.textContent = "failed";
    elements.routeTestState.className = "status-danger";
    elements.routeTestGrid.innerHTML = `<article class="route-test-card muted">${escapeHtml(error.message || "Could not test routes.")}</article>`;
  } finally {
    elements.routeTestButton.disabled = false;
  }
}

async function sendVerificationEmail() {
  setAccountMessage("sending verification...");
  elements.sendVerificationButton.disabled = true;
  try {
    const data = await apiFetch("/api/account/send-verification", { method: "POST" });
    setAccountMessage(data.message || "Verification sent.");
    await loadAccount();
  } catch (error) {
    setAccountMessage(error.message || "Could not send verification.");
  } finally {
    elements.sendVerificationButton.disabled = false;
  }
}

async function changeAccountEmail() {
  setAccountMessage("sending confirmation...");
  try {
    const data = await apiFetch("/api/account/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: elements.newEmailInput.value.trim(),
        password: elements.emailPasswordInput.value,
      }),
    });
    elements.emailPasswordInput.value = "";
    elements.newEmailInput.value = "";
    setAccountMessage(data.message || "Confirmation sent.");
    await loadAccount();
  } catch (error) {
    elements.emailPasswordInput.value = "";
    setAccountMessage(error.message || "Could not change email.");
  }
}

async function changeAccountPassword() {
  const newPassword = elements.newPasswordInput.value;
  const confirmPassword = elements.confirmPasswordInput.value;
  if (newPassword !== confirmPassword) {
    setAccountMessage("New passwords do not match.");
    return;
  }
  setAccountMessage("changing password...");
  try {
    const data = await apiFetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: elements.currentPasswordInput.value,
        new_password: newPassword,
      }),
    });
    elements.currentPasswordInput.value = "";
    elements.newPasswordInput.value = "";
    elements.confirmPasswordInput.value = "";
    setAccountMessage(data.message || "Password changed.");
    await loadAccount();
  } catch (error) {
    elements.currentPasswordInput.value = "";
    setAccountMessage(error.message || "Could not change password.");
  }
}

async function logoutAllSessions() {
  setAccountMessage("signing out sessions...");
  try {
    const data = await apiFetch("/api/account/logout-all", { method: "POST" });
    setAccountMessage(data.message || "All sessions signed out.");
    lock();
  } catch (error) {
    setAccountMessage(error.message || "Could not logout sessions.");
  }
}

async function requestPasswordReset() {
  const email = elements.resetEmailInput.value.trim();
  if (!email) {
    elements.resetRequestState.textContent = "Enter your verified email.";
    return;
  }
  elements.resetRequestButton.disabled = true;
  elements.resetRequestState.textContent = "sending...";
  try {
    const data = await apiFetch("/api/account/reset-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    elements.resetRequestState.textContent = data.message || "If that verified email exists, a reset link was sent.";
  } catch (error) {
    elements.resetRequestState.textContent = error.message || "Could not request reset.";
  } finally {
    elements.resetRequestButton.disabled = false;
  }
}

async function submitPasswordReset() {
  const newPassword = elements.resetNewPasswordInput.value;
  const confirmPassword = elements.resetConfirmPasswordInput.value;
  if (newPassword !== confirmPassword) {
    elements.resetPasswordState.textContent = "Passwords do not match.";
    return;
  }
  elements.resetPasswordState.textContent = "resetting...";
  try {
    await apiFetch("/api/account/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: resetToken,
        new_password: newPassword,
      }),
    });
    window.history.replaceState({}, "", "/");
    elements.resetNewPasswordInput.value = "";
    elements.resetConfirmPasswordInput.value = "";
    unlock();
  } catch (error) {
    elements.resetPasswordState.textContent = error.message || "Could not reset password.";
  }
}

function showLoginCodeChallenge(data) {
  pendingLoginChallenge = data;
  elements.loginCodeBox.classList.remove("hidden");
  elements.loginCodeInput.value = "";
  elements.loginCodeState.textContent = data.message
    ? `${data.message} ${data.email_hint || ""}`.trim()
    : "Enter the one-time code.";
  window.setTimeout(() => {
    elements.loginCodeInput.focus();
  }, 0);
}

function hideLoginCodeChallenge() {
  pendingLoginChallenge = null;
  elements.loginCodeBox.classList.add("hidden");
  elements.loginCodeInput.value = "";
  elements.loginCodeState.textContent = "";
}

async function verifyLoginCode() {
  if (!pendingLoginChallenge || !pendingLoginChallenge.challenge_id) {
    elements.loginCodeState.textContent = "Start sign in again.";
    return;
  }
  const code = elements.loginCodeInput.value.trim();
  if (!code) {
    elements.loginCodeState.textContent = "Enter the code.";
    return;
  }
  elements.loginCodeButton.disabled = true;
  elements.loginCodeState.textContent = "checking...";
  try {
    await apiFetch("/api/login/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id: pendingLoginChallenge.challenge_id,
        code,
      }),
    });
    hideLoginCodeChallenge();
    unlock();
  } catch (error) {
    elements.loginCodeInput.value = "";
    elements.loginCodeState.textContent = error.message || "Could not verify code.";
  } finally {
    elements.loginCodeButton.disabled = false;
  }
}

async function copyDebugReport() {
  elements.debugReportButton.disabled = true;
  elements.debugReportState.textContent = "copying...";
  try {
    const data = await apiFetch("/api/debug-report");
    await copyTextToClipboard(data.text || "");
    elements.debugReportState.textContent = "copied";
  } catch (error) {
    elements.debugReportState.textContent = error.message || "copy failed";
  } finally {
    window.setTimeout(() => {
      elements.debugReportButton.disabled = false;
      if (elements.debugReportState.textContent === "copied") {
        elements.debugReportState.textContent = "";
      }
    }, 1800);
  }
}

async function loadIncidentSnapshot() {
  const data = await apiFetch("/api/incident-snapshot");
  latestIncidentSnapshot = data;
  elements.incidentSnapshotState.textContent = `generated ${formatTimestamp(data.generated_at)}`;
  elements.incidentSnapshotState.className = "status-ok";
  elements.incidentSnapshotPreview.textContent = data.text || "Snapshot generated.";
  return data;
}

async function copyIncidentSnapshot() {
  elements.copyIncidentButton.disabled = true;
  elements.incidentSnapshotMessage.textContent = "copying...";
  try {
    const data = await loadIncidentSnapshot();
    await copyTextToClipboard(data.text || "");
    elements.incidentSnapshotMessage.textContent = "copied";
  } catch (error) {
    elements.incidentSnapshotState.textContent = "failed";
    elements.incidentSnapshotState.className = "status-danger";
    elements.incidentSnapshotMessage.textContent = error.message || "copy failed";
  } finally {
    window.setTimeout(() => {
      elements.copyIncidentButton.disabled = false;
      if (elements.incidentSnapshotMessage.textContent === "copied") {
        elements.incidentSnapshotMessage.textContent = "";
      }
    }, 1800);
  }
}

async function downloadIncidentSnapshot() {
  elements.downloadIncidentButton.disabled = true;
  elements.incidentSnapshotMessage.textContent = "preparing...";
  try {
    const data = latestIncidentSnapshot || await loadIncidentSnapshot();
    const json = JSON.stringify(data.bundle || data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date(data.generated_at || Date.now()).toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `pixelmania-incident-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    elements.incidentSnapshotMessage.textContent = "downloaded";
  } catch (error) {
    elements.incidentSnapshotState.textContent = "failed";
    elements.incidentSnapshotState.className = "status-danger";
    elements.incidentSnapshotMessage.textContent = error.message || "download failed";
  } finally {
    window.setTimeout(() => {
      elements.downloadIncidentButton.disabled = false;
      if (elements.incidentSnapshotMessage.textContent === "downloaded") {
        elements.incidentSnapshotMessage.textContent = "";
      }
    }, 1800);
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard is unavailable.");
  }
}

function setActiveLogTarget(target) {
  activeLogTarget = target || "main";
  localStorage.setItem(logTargetStorageKey, activeLogTarget);
  renderLogTabs();
  loadLogs();
}

function renderLogTabs() {
  for (const button of logButtons) {
    const active = button.dataset.logTarget === activeLogTarget;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function setActiveView(view) {
  activeView = view || "overview";
  localStorage.setItem(viewTabStorageKey, activeView);
  renderViewTabs();
}

function renderViewTabs() {
  const available = new Set(viewButtons.map((button) => button.dataset.viewTab));
  if (!available.has(activeView)) activeView = "overview";
  for (const button of viewButtons) {
    const active = button.dataset.viewTab === activeView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  for (const panel of viewPanels) {
    panel.classList.toggle("hidden", panel.dataset.viewPanel !== activeView);
  }
}

async function loadActions() {
  try {
    const data = await apiFetch("/api/actions");
    renderAction(data.current_action, data.history && data.history[0]);
  } catch (_error) {
    renderAction(null, null);
  }
}

async function runAction(action) {
  try {
    const confirmation = await getActionConfirmation(action);
    if (confirmation === null) return;
    const data = await apiFetch(`/api/actions/${encodeURIComponent(action)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirmation }),
    });
    renderAction(data.current_action, null);
    showNotice(`${action} started.`);
    await window.setTimeout(loadActions, 1000);
  } catch (error) {
    showNotice(error.message || `Could not run ${action}.`);
  }
}

function renderStatus(data) {
  const summary = data.summary || {};
  confirmationRequiredActions = new Set((data.dashboard && data.dashboard.confirmation_required_actions) || []);
  allowedActions = new Set((data.dashboard && data.dashboard.allowed_actions) || []);
  const routes = data.routes || [];
  const totalPlayersOnline = getTotalPlayersOnline(summary, routes);
  const totalWorldsLoaded = getTotalWorldsLoaded(summary, routes);
  const onlineWorlds = getOnlineWorlds(summary, routes);
  const stopGuardEnabled = Boolean(data.dashboard && data.dashboard.stop_player_guard_enabled);
  const deployGuardEnabled = Boolean(data.dashboard && data.dashboard.deploy_player_guard_enabled);
  const rollbackGuardEnabled = Boolean(data.dashboard && data.dashboard.rollback_player_guard_enabled);
  const online = Boolean(summary.online);
  elements.statusPill.classList.toggle("offline", !online);
  elements.statusLabel.textContent = online ? "online" : "offline";
  elements.uptimeValue.textContent = formatDuration(summary.uptime_ms);
  elements.playersValue.textContent = formatPlayers(totalPlayersOnline, summary.max_players_per_world);
  elements.worldsValue.textContent = formatNumber(totalWorldsLoaded);
  elements.memoryValue.textContent = formatBytes(summary.memory_bytes);
  elements.databaseValue.textContent = summary.database || "--";
  elements.redisValue.textContent = summary.redis_ready ? "ready" : "off";
  elements.tickValue.textContent = summary.tps ? `${summary.tps.toFixed(1)} TPS` : "--";
  elements.networkValue.textContent = `net in ${formatBytes(summary.inbound_bytes_received)} · out ${formatBytes(summary.outbound_bytes_sent)}`;
  renderRoutes(routes);
  renderWorlds(onlineWorlds);
  renderAction(data.current_action, data.last_action);

  const buttons = Array.from(document.querySelectorAll("[data-action]"));
  const controlsEnabled = Boolean(data.dashboard && data.dashboard.control_enabled);
  const deployEnabled = Boolean(data.dashboard && data.dashboard.deploy_enabled);
  const rollbackEnabled = Boolean(data.dashboard && data.dashboard.rollback_enabled);
  for (const button of buttons) {
    const action = button.dataset.action;
    const actionAllowed = allowedActions.has(action);
    const stopBlocked = action === "stop" && stopGuardEnabled && totalPlayersOnline > 0;
    const deployBlocked = action === "deploy" && deployGuardEnabled && totalPlayersOnline > 0;
    const rollbackBlocked = action === "rollback" && rollbackGuardEnabled && totalPlayersOnline > 0;
    button.disabled = !controlsEnabled
      || !actionAllowed
      || Boolean(data.current_action)
      || stopBlocked
      || deployBlocked
      || rollbackBlocked
      || (action === "deploy" && !deployEnabled)
      || (action === "rollback" && !rollbackEnabled);
  }

  if (!controlsEnabled) {
    showNotice("Control buttons are in read-only mode.");
  } else if ((stopGuardEnabled || deployGuardEnabled || rollbackGuardEnabled) && totalPlayersOnline > 0) {
    const lockedActions = [
      stopGuardEnabled ? "Stop" : "",
      deployGuardEnabled ? "Deploy" : "",
      rollbackGuardEnabled ? "Rollback" : "",
    ].filter(Boolean).join(" and ");
    showNotice(`${lockedActions} locked while ${totalPlayersOnline} player${totalPlayersOnline === 1 ? "" : "s"} online.`);
  } else if (allowedActions.size === 1 && allowedActions.has("restart")) {
    const restartApps = ((data.dashboard && data.dashboard.restart_apps) || []).join(", ");
    showNotice(`Control buttons are limited to restart only${restartApps ? `: ${restartApps}` : "."}`);
  } else if ((allowedActions.has("deploy") && !deployEnabled) || (allowedActions.has("rollback") && !rollbackEnabled)) {
    const disabled = [
      allowedActions.has("deploy") && !deployEnabled ? "Deploy" : "",
      allowedActions.has("rollback") && !rollbackEnabled ? "Rollback" : "",
    ].filter(Boolean).join(" and ");
    showNotice(`Server controls enabled: ${Array.from(allowedActions).join(", ")}. ${disabled} disabled.`);
  } else {
    hideNotice();
  }
}

function getTotalPlayersOnline(summary, routes) {
  const mainPlayers = Number(summary.players_online);
  const routePlayers = routes.reduce((sum, route) => {
    const players = Number(route.players_online);
    return sum + (Number.isFinite(players) ? Math.max(0, players) : 0);
  }, 0);
  return (Number.isFinite(mainPlayers) ? Math.max(0, mainPlayers) : 0) + routePlayers;
}

function getTotalWorldsLoaded(summary, routes) {
  const mainWorlds = Number(summary.worlds_loaded);
  const routeWorlds = routes.reduce((sum, route) => {
    const worlds = Number(route.worlds_loaded);
    return sum + (Number.isFinite(worlds) ? Math.max(0, worlds) : 0);
  }, 0);
  return (Number.isFinite(mainWorlds) ? Math.max(0, mainWorlds) : 0) + routeWorlds;
}

function getOnlineWorlds(summary, routes) {
  const worldsByName = new Map();
  addWorldRows(worldsByName, "main", summary.sample_worlds || []);
  for (const route of routes) {
    addWorldRows(worldsByName, route.label || route.pm2_app || "route", route.sample_worlds || []);
  }
  return Array.from(worldsByName.values()).sort((left, right) => {
    const playerCompare = Number(right.players || 0) - Number(left.players || 0);
    if (playerCompare !== 0) return playerCompare;
    return String(left.world || "").localeCompare(String(right.world || ""));
  });
}

function addWorldRows(worldsByName, source, worlds) {
  if (!Array.isArray(worlds)) return;
  for (const world of worlds) {
    const worldName = String(world && world.world ? world.world : "unknown").trim() || "unknown";
    const players = Number(world && world.players);
    const cleanPlayers = Number.isFinite(players) ? Math.max(0, players) : 0;
    const existing = worldsByName.get(worldName) || {
      world: worldName,
      players: 0,
      sources: new Set(),
    };
    existing.players += cleanPlayers;
    existing.sources.add(source);
    worldsByName.set(worldName, existing);
  }
}

function getActionConfirmation(action) {
  const phrase = confirmationRequiredActions.has(action) ? action.toUpperCase() : "";
  return openActionConfirmation(action, phrase);
}

function openActionConfirmation(action, phrase) {
  if (pendingConfirmation) {
    closeActionConfirmation(null);
  }

  elements.confirmTitle.textContent = `Run ${action}?`;
  elements.confirmText.textContent = phrase
    ? `Type ${phrase} to confirm ${action}.`
    : `Confirm that you want to run ${action}.`;
  elements.confirmInput.value = "";
  elements.confirmError.textContent = "";
  elements.confirmSubmit.textContent = `Run ${action}`;
  elements.confirmSubmit.classList.toggle("danger", action === "stop" || action === "deploy" || action === "rollback");

  if (phrase) {
    elements.confirmInputWrap.classList.remove("hidden");
    elements.confirmInputLabel.textContent = `Type ${phrase}`;
  } else {
    elements.confirmInputWrap.classList.add("hidden");
    elements.confirmInputLabel.textContent = "";
  }

  elements.confirmDialog.classList.remove("hidden");
  window.setTimeout(() => {
    if (phrase) {
      elements.confirmInput.focus();
    } else {
      elements.confirmSubmit.focus();
    }
  }, 0);

  return new Promise((resolve) => {
    pendingConfirmation = {
      action,
      phrase,
      resolve,
    };
  });
}

function resolveActionConfirmation() {
  if (!pendingConfirmation) return;
  const phrase = pendingConfirmation.phrase;
  const typed = elements.confirmInput.value.trim();
  if (phrase && typed !== phrase) {
    elements.confirmError.textContent = `Type ${phrase} exactly to continue.`;
    elements.confirmInput.focus();
    return;
  }
  closeActionConfirmation(phrase ? typed : "");
}

function closeActionConfirmation(value) {
  if (!pendingConfirmation) {
    elements.confirmDialog.classList.add("hidden");
    return;
  }
  const pending = pendingConfirmation;
  pendingConfirmation = null;
  elements.confirmDialog.classList.add("hidden");
  elements.confirmError.textContent = "";
  pending.resolve(value);
}

function renderOffline() {
  elements.statusPill.classList.add("offline");
  elements.statusLabel.textContent = "offline";
}

function renderWorlds(worlds) {
  const rows = [
    '<div class="table-row table-head"><span>World</span><span>Players</span></div>',
  ];
  if (!worlds.length) {
    rows.push('<div class="table-row muted"><span>no worlds online</span><span></span></div>');
  } else {
    for (const world of worlds) {
      const sources = Array.from(world.sources || []).filter(Boolean).join(" + ");
      const sourceLabel = sources ? `<small>${escapeHtml(sources)}</small>` : "";
      rows.push(`
        <div class="table-row">
          <span class="world-cell">${escapeHtml(world.world || "unknown")}${sourceLabel}</span>
          <span>${formatNumber(world.players)}</span>
        </div>
      `);
    }
  }
  elements.worldsTable.innerHTML = rows.join("");
}

function renderRoutes(routes) {
  if (!routes.length) {
    elements.routesGrid.innerHTML = '<article class="route-card muted">No route targets configured.</article>';
    return;
  }

  elements.routesGrid.innerHTML = routes.map((route) => {
    const ok = Boolean(route.ok);
    const classes = ok ? "route-card" : "route-card offline";
    return `
      <article class="${classes}">
        <div class="route-top">
          <strong>${escapeHtml(route.label || route.pm2_app || "route")}</strong>
          <span>${ok ? "online" : "offline"}</span>
        </div>
        <p>${escapeHtml(route.ws_url || "")}</p>
        <dl>
          <div><dt>PM2</dt><dd>${escapeHtml(route.pm2_status || "unknown")}</dd></div>
          <div><dt>Health</dt><dd>${route.health_ok ? "ok" : "fail"}</dd></div>
          <div><dt>Players</dt><dd>${formatNumber(route.players_online)}</dd></div>
          <div><dt>Worlds</dt><dd>${formatNumber(route.worlds_loaded)}</dd></div>
          <div><dt>Postgres</dt><dd>${route.postgres_ready ? "ready" : "off"}</dd></div>
          <div><dt>Redis</dt><dd>${route.redis_ready ? "ready" : "off"}</dd></div>
        </dl>
      </article>
    `;
  }).join("");
}

function renderRouteTests(data) {
  const results = data.results || [];
  elements.routeTestState.textContent = data.all_ready ? "ok" : "issues";
  elements.routeTestState.className = data.all_ready ? "status-ok" : "status-warn";
  if (!results.length) {
    elements.routeTestGrid.innerHTML = '<article class="route-test-card muted">No route targets configured.</article>';
    return;
  }
  elements.routeTestGrid.innerHTML = results.map((result) => {
    const ok = Boolean(result.ok);
    const ws = result.websocket || {};
    const health = result.health || {};
    return `
      <article class="${ok ? "route-test-card" : "route-test-card offline"}">
        <div class="route-top">
          <strong>${escapeHtml(result.label || result.pm2_app || "route")}</strong>
          <span>${ok ? "ok" : "fail"}</span>
        </div>
        <p>${escapeHtml(result.ws_url || "")}</p>
        <dl>
          <div><dt>WebSocket</dt><dd>${escapeHtml(ws.status || "--")}</dd></div>
          <div><dt>WS latency</dt><dd>${formatMilliseconds(ws.latency_ms)}</dd></div>
          <div><dt>Health</dt><dd>${health.ok ? "ok" : "fail"}</dd></div>
          <div><dt>HTTP latency</dt><dd>${formatMilliseconds(health.latency_ms)}</dd></div>
        </dl>
        ${ws.error || health.error ? `<p class="status-danger">${escapeHtml(ws.error || health.error)}</p>` : ""}
      </article>
    `;
  }).join("");
}

function renderDatabaseHealth(data) {
  const checks = data.checks || [];
  elements.databaseHealthState.textContent = data.all_ready ? "ready" : "issues";
  elements.databaseHealthState.className = data.all_ready ? "status-ok" : "status-warn";
  if (!checks.length) {
    elements.databaseHealthGrid.innerHTML = '<article class="database-health-card muted">No database checks configured.</article>';
    return;
  }
  elements.databaseHealthGrid.innerHTML = checks.map((check) => {
    const ready = Boolean(check.health_ok && check.postgres_ready && check.redis_ready);
    const redisCounts = check.redis_key_counts || {};
    const countText = Object.entries(redisCounts)
      .map(([key, value]) => `${key}:${formatNumber(value)}`)
      .join(" · ");
    return `
      <article class="${ready ? "database-health-card" : "database-health-card offline"}">
        <div class="route-top">
          <strong>${escapeHtml(check.label || check.pm2_app || "server")}</strong>
          <span>${ready ? "ready" : "check"}</span>
        </div>
        <dl>
          <div><dt>Health</dt><dd>${check.health_ok ? "ok" : "fail"}</dd></div>
          <div><dt>Latency</dt><dd>${formatMilliseconds(check.health_latency_ms)}</dd></div>
          <div><dt>Postgres</dt><dd>${check.postgres_ready ? "ready" : "off"}</dd></div>
          <div><dt>Authority</dt><dd>${check.postgres_authoritative ? "yes" : "no"}</dd></div>
          <div><dt>Redis</dt><dd>${check.redis_ready ? "ready" : "off"}</dd></div>
          <div><dt>Players</dt><dd>${formatNumber(check.indexed_player_count)}</dd></div>
          <div><dt>Worlds</dt><dd>${formatNumber(check.active_world_count)}</dd></div>
          <div><dt>Pending writes</dt><dd>${formatNumber(check.pending_persistence_writes)}</dd></div>
          <div><dt>TPS</dt><dd>${formatNumber(check.tps)}</dd></div>
          <div><dt>Lag</dt><dd>${formatMilliseconds(check.event_loop_lag_ms)}</dd></div>
        </dl>
        <p>${escapeHtml(countText || check.health_error || "redis keys clear")}</p>
      </article>
    `;
  }).join("");
}

function renderDatabaseHealthError(message) {
  elements.databaseHealthState.textContent = "unavailable";
  elements.databaseHealthState.className = "status-danger";
  elements.databaseHealthGrid.innerHTML = `<article class="database-health-card muted">${escapeHtml(message)}</article>`;
}

function renderErrorSummary(data) {
  const issueCount = countRenderedIssueLines(data.text || "");
  elements.errorSummaryState.textContent = issueCount ? `${issueCount} issue lines` : "clear";
  elements.errorSummaryState.className = issueCount ? "status-warn" : "status-ok";
  elements.errorSummaryOutput.textContent = data.text || "No recent errors/warnings.";
}

function renderResources(data) {
  const host = data.host || {};
  const disk = host.disk || {};
  const cpuPercent = Number(host.cpu_percent_estimate);
  const ramPercent = Number(host.memory_percent);
  const diskPercent = Number(disk.used_percent);
  elements.resourcesState.textContent = data.generated_at ? `updated ${formatTimestamp(data.generated_at)}` : "live";
  elements.resourcesState.className = "status-ok";

  elements.resourceCpu.textContent = Number.isFinite(cpuPercent) ? `${cpuPercent.toFixed(0)}%` : "--";
  elements.resourceCpuDetail.textContent = `${formatNumber(host.load_average_1m)} load · ${formatNumber(host.cpu_count)} cores`;
  elements.resourceRam.textContent = Number.isFinite(ramPercent) ? `${ramPercent.toFixed(0)}%` : "--";
  elements.resourceRamDetail.textContent = `${formatBytes(host.memory_used_bytes)} / ${formatBytes(host.memory_total_bytes)}`;
  elements.resourceDisk.textContent = disk.ok && Number.isFinite(diskPercent) ? `${diskPercent.toFixed(0)}%` : "--";
  elements.resourceDiskDetail.textContent = disk.ok
    ? `${formatBytes(disk.used_bytes)} / ${formatBytes(disk.size_bytes)} · ${escapeText(disk.mount || "")}`
    : disk.error || "Disk check unavailable.";
  elements.resourceUptime.textContent = formatDuration(Number(host.uptime_seconds || 0) * 1000);
  elements.resourceHost.textContent = `${host.hostname || "host"} · ${host.platform || "platform"} ${host.arch || ""}`.trim();

  renderProcesses(data.processes || []);
}

function renderResourcesError(message) {
  elements.resourcesState.textContent = "unavailable";
  elements.resourcesState.className = "status-danger";
  elements.resourceCpu.textContent = "--";
  elements.resourceCpuDetail.textContent = message;
  elements.resourceRam.textContent = "--";
  elements.resourceRamDetail.textContent = "--";
  elements.resourceDisk.textContent = "--";
  elements.resourceDiskDetail.textContent = "--";
  elements.resourceUptime.textContent = "--";
  elements.resourceHost.textContent = "--";
  elements.processGrid.innerHTML = `<article class="process-card muted">${escapeHtml(message)}</article>`;
}

function renderProcesses(processes) {
  if (!processes.length) {
    elements.processGrid.innerHTML = '<article class="process-card muted">No PM2 process data.</article>';
    return;
  }
  elements.processGrid.innerHTML = processes.map((processInfo) => {
    const online = processInfo.status === "online";
    return `
      <article class="${online ? "process-card" : "process-card offline"}">
        <div class="process-top">
          <strong>${escapeHtml(processInfo.label || processInfo.pm2_app || "process")}</strong>
          <span>${escapeHtml(processInfo.status || "missing")}</span>
        </div>
        <p>${escapeHtml(processInfo.pm2_app || "")}</p>
        <dl>
          <div><dt>Memory</dt><dd>${formatBytes(processInfo.memory_bytes)}</dd></div>
          <div><dt>CPU</dt><dd>${formatPercent(processInfo.cpu_percent)}</dd></div>
          <div><dt>Restarts</dt><dd>${formatNumber(processInfo.restarts)}</dd></div>
          <div><dt>Uptime</dt><dd>${formatDuration(processInfo.uptime_ms)}</dd></div>
        </dl>
      </article>
    `;
  }).join("");
}

function renderAccount(data) {
  const account = data.account || {};
  const session = data.session || {};
  const mail = data.mail || {};
  const verified = Boolean(account.email_verified);
  elements.accountState.textContent = "live";
  elements.accountState.className = verified ? "status-ok" : "status-warn";
  elements.accountEmail.textContent = account.email || "--";
  elements.accountPendingEmail.textContent = account.pending_email ? `pending: ${account.pending_email}` : "No pending email change.";
  elements.accountVerified.textContent = verified ? "verified" : "unverified";
  elements.accountVerified.className = verified ? "status-ok" : "status-warn";
  elements.accountVerificationDetail.textContent = verified
    ? `verified ${formatTimestamp(account.email_verified_at)}`
    : account.has_pending_verification
      ? `link expires ${formatTimestamp(account.verification_expires_at)}`
      : "Send a verification email.";
  elements.accountSessions.textContent = formatNumber(session.active_sessions);
  elements.accountSessionDetail.textContent = session.expires_at ? `this session expires ${formatTimestamp(session.expires_at)}` : session.auth_mode || "--";
  elements.accountMail.textContent = mail.configured ? "configured" : "logs only";
  elements.accountMail.className = mail.configured ? "status-ok" : "status-warn";
  elements.accountMailDetail.textContent = mail.configured ? mail.from || "SMTP ready" : "SMTP is not set; links go to PM2 logs.";
  const loginCode = data.login_code || {};
  elements.accountLoginCode.textContent = loginCode.enabled ? "enabled" : "off";
  elements.accountLoginCode.className = loginCode.enabled ? "status-ok" : "status-warn";
  elements.accountLoginCodeDetail.textContent = loginCode.enabled
    ? `expires in ${formatNumber(loginCode.ttl_minutes)}m`
    : "password session only";
}

function renderAccountError(message) {
  elements.accountState.textContent = "unavailable";
  elements.accountState.className = "status-danger";
  elements.accountEmail.textContent = "--";
  elements.accountPendingEmail.textContent = message;
  elements.accountVerified.textContent = "--";
  elements.accountVerificationDetail.textContent = "--";
  elements.accountSessions.textContent = "--";
  elements.accountSessionDetail.textContent = "--";
  elements.accountMail.textContent = "--";
  elements.accountMailDetail.textContent = "--";
  elements.accountLoginCode.textContent = "--";
  elements.accountLoginCodeDetail.textContent = "--";
}

function setAccountMessage(message) {
  elements.accountMessage.textContent = message;
}

function renderDeployStatus(data) {
  const git = data.git || {};
  const safety = data.safety || {};
  const health = data.health || {};
  const dirtyText = getDirtySummaryText(git);
  const versionState = getVersionStateText(git);
  elements.deployVersionState.textContent = `${versionState}${dirtyText}`;
  elements.deployVersionState.className = getVersionStateClass(git, safety);

  elements.deployCurrentCommit.textContent = git.current_short || "--";
  elements.deployCurrentSubject.textContent = git.current_subject || git.error || "--";
  elements.deployRemoteCommit.textContent = git.remote_short || "--";
  elements.deployRemoteSubject.textContent = git.remote_subject || (git.ok ? "--" : git.error || "remote unavailable");
  elements.rollbackTargetCommit.textContent = git.rollback_short || "--";
  elements.rollbackTargetSubject.textContent = git.rollback_subject || git.rollback_error || "No previous commit available.";

  const playerCount = Number(safety.players_online || 0);
  if (!safety.deploy_enabled && !safety.rollback_enabled) {
    elements.deployGuardState.textContent = "disabled";
    elements.deployGuardDetail.textContent = "Deploy and rollback are not configured.";
  } else if (safety.blocked_by_players || safety.rollback_blocked_by_players) {
    elements.deployGuardState.textContent = "locked";
    elements.deployGuardDetail.textContent = `${formatNumber(playerCount)} player${playerCount === 1 ? "" : "s"} online.`;
  } else {
    const guards = [
      safety.deploy_enabled && safety.deploy_guard_enabled ? "deploy" : "",
      safety.rollback_enabled && safety.rollback_guard_enabled ? "rollback" : "",
    ].filter(Boolean);
    elements.deployGuardState.textContent = guards.length ? "clear" : "unguarded";
    elements.deployGuardDetail.textContent = guards.length ? "No players online." : "Player guards are off.";
  }

  renderDeployAction(safety.last_deploy, elements.deployLastState, elements.deployLastDetail, "No deploy actions yet.");
  renderDeployAction(safety.last_rollback, elements.rollbackLastState, elements.rollbackLastDetail, "No rollback actions yet.");
  renderDeployHealth(health.checks || []);
  renderDeployDirtyList(git);
}

function renderDeployStatusError(message) {
  elements.deployVersionState.textContent = "unavailable";
  elements.deployVersionState.className = "status-danger";
  elements.deployCurrentCommit.textContent = "--";
  elements.deployCurrentSubject.textContent = message;
  elements.deployRemoteCommit.textContent = "--";
  elements.deployRemoteSubject.textContent = "--";
  elements.rollbackTargetCommit.textContent = "--";
  elements.rollbackTargetSubject.textContent = "--";
  elements.deployGuardState.textContent = "--";
  elements.deployGuardDetail.textContent = "--";
  elements.deployLastState.textContent = "--";
  elements.deployLastDetail.textContent = "--";
  elements.rollbackLastState.textContent = "--";
  elements.rollbackLastDetail.textContent = "--";
  elements.deployHealthList.innerHTML = `<div class="health-row muted"><span>${escapeHtml(message)}</span><span></span></div>`;
  elements.deployDirtyList.classList.add("hidden");
  elements.deployDirtyList.innerHTML = "";
}

function getVersionStateText(git) {
  if (!git.ok) return "git check failed";
  if (git.up_to_date) return "up to date";
  if (Number(git.behind) > 0 && Number(git.ahead) > 0) return `${formatNumber(git.behind)} behind, ${formatNumber(git.ahead)} ahead`;
  if (Number(git.behind) > 0) return `${formatNumber(git.behind)} behind`;
  if (Number(git.ahead) > 0) return `${formatNumber(git.ahead)} ahead`;
  return "different commit";
}

function getVersionStateClass(git, safety) {
  if (!git.ok || git.deploy_blocking_dirty || safety.blocked_by_players || safety.rollback_blocked_by_players) return "status-danger";
  if (!git.up_to_date || git.dirty) return "status-warn";
  return "status-ok";
}

function getDirtySummaryText(git) {
  const tracked = Number(git.tracked_dirty_count || 0);
  const untracked = Number(git.untracked_count || 0);
  if (tracked <= 0 && untracked <= 0) return "";
  const parts = [];
  if (tracked > 0) parts.push(`${formatNumber(tracked)} tracked`);
  if (untracked > 0) parts.push(`${formatNumber(untracked)} untracked`);
  return ` · dirty (${parts.join(", ")})`;
}

function renderDeployAction(action, stateElement, detailElement, emptyMessage) {
  if (!action) {
    stateElement.textContent = "none";
    detailElement.textContent = emptyMessage;
    return;
  }
  stateElement.textContent = action.status || "unknown";
  const when = action.finished_at || action.started_at || "";
  const code = action.code === null || action.code === undefined ? "" : ` · exit ${action.code}`;
  detailElement.textContent = `${when || "time unknown"}${code}`;
}

function renderDeployHealth(checks) {
  if (!checks.length) {
    elements.deployHealthList.innerHTML = '<div class="health-row muted"><span>no health checks</span><span></span></div>';
    return;
  }
  elements.deployHealthList.innerHTML = checks.map((check) => `
    <div class="health-row">
      <span>${escapeHtml(check.label || "check")}</span>
      <span class="${check.ok ? "status-ok" : "status-danger"}">${check.ok ? "ok" : "fail"}</span>
      <small>${escapeHtml(check.detail || "")}</small>
    </div>
  `).join("");
}

function renderDeployDirtyList(git) {
  const tracked = git.tracked_dirty_files || [];
  const untracked = git.untracked_files || [];
  if (!tracked.length && !untracked.length) {
    elements.deployDirtyList.classList.add("hidden");
    elements.deployDirtyList.innerHTML = "";
    return;
  }

  const trackedCount = Number(git.tracked_dirty_count || tracked.length);
  const untrackedCount = Number(git.untracked_count || untracked.length);
  const trackedRows = tracked.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
  const untrackedRows = untracked.map((file) => `<li>${escapeHtml(file)}</li>`).join("");
  elements.deployDirtyList.classList.remove("hidden");
  elements.deployDirtyList.innerHTML = `
    ${tracked.length ? `
      <div>
        <strong class="status-danger">Tracked changes (${formatNumber(trackedCount)})</strong>
        <ul>${trackedRows}</ul>
      </div>
    ` : ""}
    ${untracked.length ? `
      <div>
        <strong class="status-warn">Untracked files (${formatNumber(untrackedCount)})</strong>
        <ul>${untrackedRows}</ul>
      </div>
    ` : ""}
  `;
}

function renderAuditLog(data) {
  const entries = data.entries || [];
  elements.auditState.textContent = entries.length ? `${entries.length} recent` : "empty";
  const rows = [
    '<div class="audit-row audit-head"><span>Action</span><span>Status</span><span>Started</span><span>Remote</span></div>',
  ];
  if (!entries.length) {
    rows.push('<div class="audit-row muted"><span>no audit entries</span><span></span><span></span><span></span></div>');
  } else {
    for (const entry of entries) {
      const statusClass = entry.status === "succeeded" ? "status-ok" : entry.status === "running" ? "status-warn" : "status-danger";
      const exitCode = entry.code === null || entry.code === undefined ? "" : ` · exit ${entry.code}`;
      const timedOut = entry.timed_out ? " · timed out" : "";
      rows.push(`
        <div class="audit-row">
          <span>${escapeHtml(entry.action || "action")}</span>
          <span class="${statusClass}">${escapeHtml(entry.status || "unknown")}${escapeHtml(exitCode)}${escapeHtml(timedOut)}</span>
          <span>${escapeHtml(formatTimestamp(entry.started_at || entry.updated_at))}</span>
          <span>${escapeHtml(entry.remote || "--")}</span>
        </div>
      `);
    }
  }
  elements.auditTable.innerHTML = rows.join("");
}

function renderAuditLogError(message) {
  elements.auditState.textContent = "unavailable";
  elements.auditTable.innerHTML = `<div class="audit-row muted"><span>${escapeHtml(message)}</span><span></span><span></span><span></span></div>`;
}

function renderAction(current, last) {
  const action = current || last;
  if (!action) {
    elements.actionState.textContent = "idle";
    elements.actionOutput.textContent = "No actions yet.";
    return;
  }
  elements.actionState.textContent = current ? "running" : action.status || "done";
  const lines = [
    `${action.label || action.action} - ${action.status}`,
    action.started_at ? `started: ${action.started_at}` : "",
    action.finished_at ? `finished: ${action.finished_at}` : "",
    action.stdout ? `\nstdout:\n${action.stdout}` : "",
    action.stderr ? `\nstderr:\n${action.stderr}` : "",
  ].filter(Boolean);
  elements.actionOutput.textContent = lines.join("\n");
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !String(path || "").startsWith("/api/login")) {
    lock();
  }
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.classList.remove("hidden");
}

function hideNotice() {
  elements.notice.classList.add("hidden");
}

function formatPlayers(players, maxPerWorld) {
  const cleanPlayers = players === null || players === undefined ? "--" : formatNumber(players);
  if (maxPerWorld === null || maxPerWorld === undefined) return cleanPlayers;
  return `${cleanPlayers} / ${formatNumber(maxPerWorld)}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat().format(number);
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(number >= 10 ? 0 : 1)}%`;
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let current = number;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current >= 10 ? current.toFixed(0) : current.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMilliseconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (number >= 1000) return `${(number / 1000).toFixed(1)}s`;
  return `${Math.max(0, Math.round(number))}ms`;
}

function formatTimestamp(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function countRenderedIssueLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("==") && !/^no recent errors\/warnings$/i.test(line))
    .length;
}

function escapeText(value) {
  return String(value || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
