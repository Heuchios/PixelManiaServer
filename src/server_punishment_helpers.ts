"use strict";

type PacketRecord = Record<string, unknown>;
type PunishmentRow = PacketRecord;

interface PunishmentCacheEntry {
  expiresAt: number;
  rows: PunishmentRow[];
}

interface PunishmentDurationParseResult {
  ok: boolean;
  consumed: boolean;
  durationMinutes: number;
  label: string;
}

interface PublicPunishmentPayload {
  punishment_id: number;
  punishment_type: string;
  scope: string;
  world: string;
  reason: string;
  starts_at: string;
  ends_at: string;
  issued_by: string;
}

interface PunishmentLookupOptions extends PacketRecord {
  punishment_type?: unknown;
  type?: unknown;
  scope?: unknown;
  world?: unknown;
  world_name?: unknown;
}

interface PlayerLike {
  world?: unknown;
}

interface ServerPunishmentHelpersConfig {
  punishmentTypes: Iterable<string>;
  scopeGlobal: string;
  scopeWorld: string;
  maxDurationMinutes: number;
  cacheTtlMs: number;
  punishmentCache: Map<string, PunishmentCacheEntry>;
  accountKey(value: unknown): string;
  cleanAccountName(value: unknown): string;
  cleanWorld(value: unknown): string;
  cleanPunishmentReason(value: unknown, limit: number): string;
  isPostgresAuthoritativeReady(): boolean;
  getActivePunishments(username: string, options: { punishment_type: string; scope: string; world: string }): Promise<PunishmentRow[]>;
}

function isRecord(value: unknown): value is PacketRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): PacketRecord {
  return isRecord(value) ? value : {};
}

function createServerPunishmentHelpers(config: ServerPunishmentHelpersConfig) {
  const punishmentTypes = new Set(Array.from(config.punishmentTypes || []).map((value) => String(value || "")));
  const scopeWorld = String(config.scopeWorld || "world");
  const maxDurationMinutes = Math.max(1, Math.trunc(Number(config.maxDurationMinutes) || 1));
  const cacheTtlMs = Math.max(0, Math.trunc(Number(config.cacheTtlMs) || 0));

  function normalizeServerPunishmentType(value: unknown): string {
    const clean = String(value || "").trim().toLowerCase().replace(/-/g, "_");
    if (clean === "tradeban") return "trade_ban";
    if (clean === "worldban") return "world_ban";
    return punishmentTypes.has(clean) ? clean : "";
  }

  function getPunishmentTypeLabel(type: unknown): string {
    switch (normalizeServerPunishmentType(type)) {
      case "trade_ban":
        return "trade ban";
      case "world_ban":
        return "world ban";
      case "lockout":
        return "security lockout";
      case "mute":
        return "mute";
      case "ban":
        return "ban";
      default:
        return "punishment";
    }
  }

  function cleanWorldNameForPunishment(worldName: unknown = ""): string {
    return config.cleanWorld(worldName || "");
  }

  function cleanPunishmentReason(value: unknown = ""): string {
    return config.cleanPunishmentReason(value, 500);
  }

  function getPunishmentCacheKey(username: unknown, type: unknown = "", scope: unknown = "", worldName: unknown = ""): string {
    const key = config.accountKey(username);
    const cleanType = normalizeServerPunishmentType(type);
    const cleanScope = String(scope || "").trim().toLowerCase();
    const cleanWorld = cleanScope === scopeWorld ? cleanWorldNameForPunishment(worldName) : "";
    return `${key}:${cleanType}:${cleanScope}:${cleanWorld}`;
  }

  function clearPunishmentCache(username: unknown = ""): void {
    const key = config.accountKey(username);
    if (key === "") {
      config.punishmentCache.clear();
      return;
    }

    for (const cacheKey of Array.from(config.punishmentCache.keys())) {
      if (String(cacheKey).startsWith(`${key}:`)) {
        config.punishmentCache.delete(cacheKey);
      }
    }
  }

  function parsePunishmentDurationToken(rawToken: unknown = ""): PunishmentDurationParseResult {
    const token = String(rawToken || "").trim().toLowerCase();
    if (token === "") {
      return { ok: false, consumed: false, durationMinutes: 0, label: "permanent" };
    }

    if (["perm", "permanent", "forever", "never", "0"].includes(token)) {
      return { ok: true, consumed: true, durationMinutes: 0, label: "permanent" };
    }

    const match = token.match(/^(\d+)(m|h|d|w|mo|y)?$/);
    if (!match) {
      return { ok: false, consumed: false, durationMinutes: 0, label: "permanent" };
    }

    const amount = Math.max(0, Math.trunc(Number(match[1]) || 0));
    const unit = match[2] || "m";
    const multipliers: Record<string, number> = {
      m: 1,
      h: 60,
      d: 24 * 60,
      w: 7 * 24 * 60,
      mo: 30 * 24 * 60,
      y: 365 * 24 * 60,
    };
    const durationMinutes = Math.min(maxDurationMinutes, amount * (multipliers[unit] || 1));
    if (durationMinutes <= 0) {
      return { ok: true, consumed: true, durationMinutes: 0, label: "permanent" };
    }

    return {
      ok: true,
      consumed: true,
      durationMinutes,
      label: token,
    };
  }

  function formatPunishmentExpires(punishment: unknown): string {
    const raw = toRecord(punishment);
    const rawEndsAt = String(raw.ends_at || "").trim();
    if (rawEndsAt === "") return "permanent";

    const date = new Date(rawEndsAt);
    if (!Number.isFinite(date.getTime())) return "until " + rawEndsAt;
    return "until " + date.toISOString();
  }

  function publicPunishmentPayload(punishment: unknown = {}): PublicPunishmentPayload {
    const raw = toRecord(punishment);
    const scope = String(raw.scope || "").trim().toLowerCase();
    return {
      punishment_id: Math.max(0, Math.trunc(Number(raw.punishment_id) || 0)),
      punishment_type: normalizeServerPunishmentType(raw.punishment_type || raw.type || ""),
      scope,
      world: scope === scopeWorld ? cleanWorldNameForPunishment(raw.world || "") : "",
      reason: cleanPunishmentReason(raw.reason || ""),
      starts_at: String(raw.starts_at || ""),
      ends_at: String(raw.ends_at || ""),
      issued_by: config.cleanAccountName(raw.issued_by || raw.issued_by_username || ""),
    };
  }

  function formatPunishmentBlockMessage(action: unknown, punishment: unknown = {}): string {
    const cleanAction = String(action || "");
    const payload = publicPunishmentPayload(punishment);
    const label = getPunishmentTypeLabel(payload.punishment_type);
    const expires = formatPunishmentExpires(payload);
    const reason = payload.reason ? ` Reason: ${payload.reason}` : "";
    if (cleanAction === "login") {
      return `This account has an active ${label} (${expires}).${reason}`;
    }
    if (cleanAction === "chat" || cleanAction === "broadcast") {
      return `You are muted (${expires}).${reason}`;
    }
    if (cleanAction === "trade") {
      return `You cannot trade right now (${expires}).${reason}`;
    }
    if (cleanAction === "world") {
      const worldText = payload.world ? ` in ${payload.world}` : "";
      return `You cannot enter or edit this world${worldText} (${expires}).${reason}`;
    }
    return `Action blocked by active ${label} (${expires}).${reason}`;
  }

  function buildPunishmentNoticePayload(player: PlayerLike | null | undefined, message: unknown, punishment: unknown = null): PacketRecord {
    return {
      type: "chat",
      player_id: "system",
      name: "System",
      message,
      world: player?.world || "",
      punishment: punishment ? publicPunishmentPayload(punishment) : undefined,
    };
  }

  async function getActivePunishmentsCached(username: unknown, options: PunishmentLookupOptions = {}): Promise<PunishmentRow[]> {
    const cleanUsername = config.cleanAccountName(username);
    if (cleanUsername === "" || !config.isPostgresAuthoritativeReady()) return [];

    const cleanType = normalizeServerPunishmentType(options.punishment_type || options.type || "");
    const cleanScope = options.scope === undefined ? "" : String(options.scope || "").trim().toLowerCase();
    const cleanWorld = cleanScope === scopeWorld ? cleanWorldNameForPunishment(options.world || options.world_name || "") : "";
    const cacheKey = getPunishmentCacheKey(cleanUsername, cleanType, cleanScope, cleanWorld);
    const cached = config.punishmentCache.get(cacheKey);
    if (cached && Number(cached.expiresAt || 0) > Date.now()) {
      return cached.rows;
    }

    const rows = await config.getActivePunishments(cleanUsername, {
      punishment_type: cleanType,
      scope: cleanScope,
      world: cleanWorld,
    });
    const safeRows = Array.isArray(rows) ? rows : [];
    config.punishmentCache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtlMs,
      rows: safeRows,
    });
    return safeRows;
  }

  async function getBlockingPunishment(username: unknown, types: unknown[] | unknown = [], options: PunishmentLookupOptions = {}): Promise<PunishmentRow | null> {
    const requestedTypes = Array.isArray(types) ? types : [types];
    const typeSet = new Set(requestedTypes.map(normalizeServerPunishmentType).filter(Boolean));
    if (typeSet.size === 0) return null;

    const rows = await getActivePunishmentsCached(username, options);
    return rows.find((row) => typeSet.has(normalizeServerPunishmentType(row.punishment_type))) || null;
  }

  return {
    buildPunishmentNoticePayload,
    cleanPunishmentReason,
    cleanWorldNameForPunishment,
    clearPunishmentCache,
    formatPunishmentBlockMessage,
    formatPunishmentExpires,
    getActivePunishmentsCached,
    getBlockingPunishment,
    getPunishmentCacheKey,
    getPunishmentTypeLabel,
    normalizeServerPunishmentType,
    parsePunishmentDurationToken,
    publicPunishmentPayload,
  };
}

export = {
  createServerPunishmentHelpers,
};
