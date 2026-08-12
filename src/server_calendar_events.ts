"use strict";

// General reusable calendar-event framework.
//
// Registers named events with cron-style start/end windows (standard 5-field crontab syntax:
// minute hour day-of-month month day-of-week, evaluated in UTC) and fires onWindowStart/
// onWindowEnd exactly once per transition. Polled on a fixed interval (default 60s), same
// setInterval-tick shape as the existing Snow Storm random world-event scheduler in server.ts
// (see startWorldEventRandomScheduler). No external cron package is used on purpose: adding one
// as an optional/lazily-required dependency (the pattern used for Stripe/Google Play in
// server_iap_routes.ts) would mean this scheduler silently does nothing until someone runs
// `npm install`, which is exactly the failure shape documented in project memory
// (snow_storm_event_never_triggers.md) -- an enable flag that was correct in code but never
// actually wired into ecosystem.config.js, so the feature never fired in any real environment.
// A small self-contained cron evaluator means there is no install step that can be missed.
//
// A "calendar event" registered here is orthogonal to a "world event" (Snow Storm): world
// events are random-chance, per-world weather/gameplay effects; calendar events are scheduled,
// server-wide feature windows (e.g. the Landfill race event's monthly join window) that other
// systems register against and query via isEventActive(key).

type CronField = { type: "any" } | { type: "values"; values: Set<number> };

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface CalendarEventDefinition {
  key: string;
  label: string;
  enabled: boolean;
  // Standard 5-field crontab expressions ("minute hour day-of-month month day-of-week"),
  // evaluated in UTC. The event is considered "active" from the first minute cronStart matches
  // up until (not including) the first later minute cronEnd matches.
  cronStart: string;
  cronEnd: string;
  onWindowStart: () => void | Promise<void>;
  onWindowEnd: () => void | Promise<void>;
}

interface CalendarEventState {
  definition: CalendarEventDefinition;
  parsedStart: ParsedCron | null;
  parsedEnd: ParsedCron | null;
  active: boolean;
}

interface CalendarEventsDeps extends Record<string, any> {
  logger?: { log: (...args: any[]) => void; warn: (...args: any[]) => void };
  tickIntervalMs?: number;
}

function parseCronField(rawField: string, min: number, max: number): CronField {
  const field = String(rawField || "").trim();
  if (field === "" || field === "*") return { type: "any" };

  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPartRaw] = part.includes("/") ? part.split("/") : [part, ""];
    const step = stepPartRaw ? Math.max(1, parseInt(stepPartRaw, 10) || 1) : 1;

    let rangeStart = min;
    let rangeEnd = max;
    if (rangePart !== "*" && rangePart !== "") {
      if (rangePart.includes("-")) {
        const [startText, endText] = rangePart.split("-");
        rangeStart = parseInt(startText, 10);
        rangeEnd = parseInt(endText, 10);
      } else {
        rangeStart = parseInt(rangePart, 10);
        rangeEnd = rangeStart;
      }
    }
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) continue;
    for (let value = rangeStart; value <= rangeEnd; value += step) {
      if (value >= min && value <= max) values.add(value);
    }
  }
  return values.size > 0 ? { type: "values", values } : { type: "any" };
}

function parseCronExpression(expression: string): ParsedCron | null {
  const fields = String(expression || "").trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, domField, monthField, dowField] = fields;
  return {
    minute: parseCronField(minuteField, 0, 59),
    hour: parseCronField(hourField, 0, 23),
    dayOfMonth: parseCronField(domField, 1, 31),
    month: parseCronField(monthField, 1, 12),
    dayOfWeek: parseCronField(dowField, 0, 6),
  };
}

function cronFieldMatches(field: CronField, value: number): boolean {
  return field.type === "any" || field.values.has(value);
}

function cronMatchesUtcDate(cron: ParsedCron, date: Date): boolean {
  return (
    cronFieldMatches(cron.minute, date.getUTCMinutes()) &&
    cronFieldMatches(cron.hour, date.getUTCHours()) &&
    cronFieldMatches(cron.dayOfMonth, date.getUTCDate()) &&
    cronFieldMatches(cron.month, date.getUTCMonth() + 1) &&
    cronFieldMatches(cron.dayOfWeek, date.getUTCDay())
  );
}

// Is `date` inside the [cronStart, cronEnd) window? Scans backward minute-by-minute (bounded)
// from `date` for whichever of start/end matched most recently -- handles sparse expressions
// like "first week of the month" without needing full interval-set math. The scan is capped at
// 40 days, comfortably covering "once a month" gaps, and only runs once per tick per registered
// event, so it stays cheap even at 1-minute polling with a handful of events registered.
const MAX_BACKWARD_SCAN_MINUTES = 60 * 24 * 40;

function isDateInsideCronWindow(parsedStart: ParsedCron, parsedEnd: ParsedCron, date: Date): boolean {
  const cursor = new Date(date.getTime());
  cursor.setUTCSeconds(0, 0);
  for (let stepsBack = 0; stepsBack <= MAX_BACKWARD_SCAN_MINUTES; stepsBack += 1) {
    if (cronMatchesUtcDate(parsedEnd, cursor)) return false;
    if (cronMatchesUtcDate(parsedStart, cursor)) return true;
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 1);
  }
  return false;
}

function createCalendarEventScheduler(deps: CalendarEventsDeps = {}) {
  const logger = deps.logger || console;
  const tickIntervalMs = Math.max(1000, Number(deps.tickIntervalMs) || 60000);

  const events = new Map<string, CalendarEventState>();
  let timer: any = null;

  function registerEvent(definition: CalendarEventDefinition): void {
    if (!definition || !definition.key) {
      throw new Error("registerEvent requires a definition with a key");
    }
    const parsedStart = parseCronExpression(definition.cronStart);
    const parsedEnd = parseCronExpression(definition.cronEnd);
    if (!parsedStart || !parsedEnd) {
      logger.warn(`[calendar_events] "${definition.key}" has an invalid cron expression; it will never fire.`, {
        cronStart: definition.cronStart,
        cronEnd: definition.cronEnd,
      });
    }
    events.set(definition.key, {
      definition,
      parsedStart,
      parsedEnd,
      active: false,
    });
  }

  function isEventActive(key: string): boolean {
    return events.get(key)?.active === true;
  }

  function getRegisteredEventKeys(): string[] {
    return Array.from(events.keys());
  }

  async function evaluateEvent(state: CalendarEventState, now: Date): Promise<void> {
    const { definition, parsedStart, parsedEnd } = state;
    if (!definition.enabled || !parsedStart || !parsedEnd) return;

    const shouldBeActive = isDateInsideCronWindow(parsedStart, parsedEnd, now);
    if (shouldBeActive === state.active) return;

    state.active = shouldBeActive;
    try {
      if (shouldBeActive) {
        logger.log(`[calendar_events] "${definition.key}" window opened.`);
        await definition.onWindowStart();
      } else {
        logger.log(`[calendar_events] "${definition.key}" window closed.`);
        await definition.onWindowEnd();
      }
    } catch (error) {
      logger.warn(
        `[calendar_events] "${definition.key}" ${shouldBeActive ? "onWindowStart" : "onWindowEnd"} failed:`,
        (error as any)?.message || error,
      );
    }
  }

  async function tick(): Promise<void> {
    const now = new Date();
    for (const state of events.values()) {
      await evaluateEvent(state, now);
    }
  }

  function start(): void {
    if (timer) return;
    // Evaluate once immediately so a server restart mid-window recovers state right away,
    // instead of waiting up to a full tick interval.
    void tick();
    timer = setInterval(() => {
      void tick().catch((error) => {
        logger.warn("[calendar_events] tick failed:", (error as any)?.message || error);
      });
    }, tickIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    registerEvent,
    isEventActive,
    getRegisteredEventKeys,
    start,
    stop,
    tick,
  };
}

export = {
  createCalendarEventScheduler,
  parseCronExpression,
  cronMatchesUtcDate,
  isDateInsideCronWindow,
};
