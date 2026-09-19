// Generated from src/server_quest_engine.ts. Do not edit by hand.
"use strict";
// Pure state machine. Only the PostgreSQL adapter may persist it or grant rewards.
// No client state, amounts, clock, content or success flags are trusted.
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const contentPath = path.join(__dirname, "data", "quests", "dispatch.json");
const CATALOGUE = JSON.parse(fs.readFileSync(contentPath, "utf8")).quests;
const BY_ID = new Map(CATALOGUE.map(q => [q.id, q]));
const DAY = 86400000;
const TIERS = ["favor", "trip", "story"];
const REWARDS = {
    favor: { gems: 10, stamps: 3 }, trip: { gems: 25, stamps: 5 }, story: { gems: 15, stamps: 4 },
};
// Account cosmetics are usable inside the Dispatch; no inventory items are minted.
const COSMETICS = [
    { id: "envelope_sticker", name: "Hanging Envelope", price: 12, kind: "scrapbook sticker", color: "#f7cc85" },
    { id: "postmark_frame", name: "Postmark Frame", price: 24, kind: "Dispatch frame", color: "#b3f2dd" },
    { id: "paper_moth_pin", name: "Paper Moth Emblem", price: 36, kind: "Dispatch emblem", color: "#d7b8ff" },
    { id: "courier_satchel", name: "Courier's Collection", price: 60, kind: "scrapbook cover", color: "#dfa775" },
    { id: "reed_lantern", name: "Reed Lantern", price: 72, kind: "Dispatch decoration", color: "#ffe286" },
    { id: "seed_label_set", name: "Seed Keeper's Labels", price: 72, kind: "scrapbook trim", color: "#b7e89d" },
    { id: "moonpost_board", name: "Moonpost", price: 96, kind: "Dispatch skin", color: "#a8c8ff" },
    { id: "paper_moth_pet", name: "Paper Moth", price: 144, kind: "Dispatch companion", color: "#e4bcff" },
    { id: "threadlight_set", name: "Threadlight", price: 240, kind: "Dispatch theme", color: "#ffd9ad" },
];
function dayId(now) { return Math.floor((now - 4 * 3600000) / DAY); }
function weekId(day) { return Math.floor((day + 3) / 7); }
function hash(input) { return crypto.createHash("sha256").update(input).digest().readUInt32BE(0); }
function fail(message) { throw new Error(message); }
function fresh() { return { version: 1, revision: 0, stamps: 0, days: {}, active: {}, history: [], story_next: 1, chapters: {}, flags: {}, cosmetics: [], equipped: "", weeks: {} }; }
function normalize(raw) {
    const s = JSON.parse(JSON.stringify(raw && raw.version === 1 ? raw : fresh()));
    for (const key of ["days", "active", "chapters", "flags", "weeks"])
        if (!s[key] || Array.isArray(s[key]) || typeof s[key] !== "object")
            fail("Invalid saved quest state.");
    return s;
}
function assigned(s, day, account) {
    if (s.days[String(day)])
        return s.days[String(day)];
    const recent = new Set(s.history.filter((h) => h.day >= day - 3).flatMap((h) => h.ids));
    const used = [];
    const offers = { favor: [], trip: [] };
    for (const tier of ["favor", "trip"]) {
        for (let i = 0; i < 2; i++) {
            let pool = CATALOGUE.filter(q => q.tier === tier && !recent.has(q.id) && !used.includes(q.id));
            // Explicit degraded mode is returned if operators reduce the enabled pool.
            if (!pool.length)
                pool = CATALOGUE.filter(q => q.tier === tier && !used.includes(q.id));
            const familyHere = new Set(offers[tier].map(id => BY_ID.get(id).family));
            const familyToday = new Set(used.map(id => BY_ID.get(id).family));
            const score = (q) => (familyHere.has(q.family) ? 100 : 0) + (familyToday.has(q.family) ? 10 : 0) + hash(`${account}:${day}:${q.id}`) / 0xffffffff;
            pool.sort((a, b) => score(a) - score(b));
            offers[tier].push(pool[0].id);
            used.push(pool[0].id);
        }
    }
    const board = { offers, done: {}, refresh: { favor: 0, trip: 0 } };
    s.days[String(day)] = board;
    s.history.push({ day, ids: used });
    s.history = s.history.filter((h) => h.day >= day - 30);
    // Active story instances carry their original entitlement even across long absences.
    const activeDays = new Set(Object.values(s.active).map((a) => String(a.day)));
    for (const key of Object.keys(s.days))
        if (Number(key) < day - 30 && !activeDays.has(key))
            delete s.days[key];
    return board;
}
function availableStory(s, day, account) {
    if (s.story_next <= 24)
        return `S${String(s.story_next).padStart(2, "0")}`;
    const board = s.days[String(day)];
    const used = [...board.offers.favor, ...board.offers.trip];
    const pool = CATALOGUE.filter(q => q.tier !== "story" && !used.includes(q.id));
    return pool[hash(`${account}:${day}:encore`) % pool.length].id;
}
function callback(q, flags) {
    const memories = [
        ["a_seal", 2, "Pip kept your note about the seal"],
        ["a_light", 4, "Rue remembers the shelter's light"],
        ["b_message", 9, "Nell still carries your river message"],
        ["c_empty_planter", 13, "Tansy kept a little space in the garden"],
        ["d_memory", 17, "Bolt pinned your picnic note above the workbench"],
        ["e_chair", 21, "Rue has kept your place at the table"],
        ["f_keepsake", 24, "Morrow brings back the keepsake you chose"],
    ];
    const memory = memories.filter(([key, chapter]) => flags[key] && Number(q.chapter_order) >= chapter).at(-1);
    return memory ? `${memory[2]}: “${flags[memory[0]]}.”` : "";
}
function publicQuest(q, flags = {}) {
    const { variants, ...safe } = q;
    return { ...safe, callback: q.callback || callback(q, flags) };
}
function publicInstance(instance) {
    const { solution, ...puzzle } = instance.puzzle;
    return { ...instance, puzzle, quest: publicQuest(instance.quest) };
}
function view(s, day, now, account) {
    const board = s.days[String(day)];
    return { version: 1, revision: s.revision, server_time: now, day, reset_at: (day + 1) * DAY + 4 * 3600000,
        stamps: s.stamps, offers: Object.fromEntries(["favor", "trip"].map(t => [t, board.offers[t].map((id) => publicQuest(BY_ID.get(id)))])),
        done: board.done, refresh: board.refresh, active: Object.fromEntries(Object.entries(s.active).map(([k, v]) => [k, publicInstance(v)])),
        story: publicQuest(BY_ID.get(availableStory(s, day, account)), s.flags), story_next: s.story_next, encore: s.story_next > 24,
        chapters: s.chapters, flags: s.flags, cosmetics: COSMETICS.map(c => ({ ...c, owned: s.cosmetics.includes(c.id) })), equipped: s.equipped,
        week_days: (s.weeks[String(weekId(day))]?.days || []).length, weekly_reward: 8 };
}
function transition(raw, action, payload, now, account) {
    const s = normalize(raw), day = dayId(now);
    const board = assigned(s, day, account);
    for (const tier of ["favor", "trip"])
        if (s.active[tier] && s.active[tier].expires_at <= now)
            delete s.active[tier];
    let message = "Your story waits for you.", gemDelta = 0;
    const receipts = [];
    if (action !== "quest_board_get" && payload.revision !== s.revision)
        fail("Your board changed. Refresh it and try again.");
    if (action === "quest_accept") {
        const tier = String(payload.tier || "");
        if (!TIERS.includes(tier))
            fail("Unknown quest tier.");
        if (s.active[tier])
            fail("Finish or put away your current letter first.");
        if (board.done[tier])
            fail("You have already finished this daily slot.");
        const id = String(payload.quest_id || "");
        if (tier === "story" ? id !== availableStory(s, day, account) : !board.offers[tier].includes(id))
            fail("That letter is not on today's board.");
        const q = BY_ID.get(id);
        const variant = hash(`${account}:${day}:${id}`) % q.variants.length;
        s.active[tier] = { id: `${day}:${tier}`, tier, day, quest: JSON.parse(JSON.stringify(q)), variant, puzzle: JSON.parse(JSON.stringify(q.variants[variant])),
            inspected: [], solved: false, hint: false, accepted_at: now, expires_at: tier === "story" ? null : (day + 2) * DAY + 4 * 3600000, reward: REWARDS[tier] };
        s.active[tier].quest.callback = callback(q, s.flags);
        message = "Letter accepted. Inspect the clues to begin.";
    }
    else if (action === "quest_refresh") {
        const tier = String(payload.tier || "");
        if (!["favor", "trip"].includes(tier))
            fail("Story letters do not need refreshing.");
        if (s.active[tier] || board.done[tier] || board.refresh[tier])
            fail("No refresh is available for this slot.");
        const excluded = new Set(s.history.filter((h) => h.day >= day - 3).flatMap((h) => h.ids));
        const pool = CATALOGUE.filter(q => q.tier === tier && !excluded.has(q.id));
        if (!pool.length)
            fail("All fresh letters are already on your board today.");
        const q = pool[hash(`${account}:${day}:${tier}:refresh`) % pool.length];
        board.offers[tier][1] = q.id;
        board.refresh[tier] = 1;
        s.history.find((h) => h.day === day).ids.push(q.id);
        message = "A fresh letter has arrived.";
    }
    else if (["quest_inspect", "quest_hint", "quest_solve", "quest_choose", "quest_abandon"].includes(action)) {
        const tier = String(payload.tier || "");
        if (!TIERS.includes(tier))
            fail("Unknown quest tier.");
        const a = s.active[tier];
        if (!a || a.id !== payload.instance_id)
            fail("That letter is no longer active.");
        if (action === "quest_abandon") {
            delete s.active[tier];
            message = "Letter put away. Your own items are unchanged.";
        }
        if (action === "quest_inspect") {
            const index = payload.clue;
            if (!Number.isInteger(index) || index < 0 || index >= a.puzzle.clues.length)
                fail("Unknown clue.");
            if (!a.inspected.includes(index))
                a.inspected.push(index);
            message = a.puzzle.clues[index];
        }
        if (action === "quest_hint") {
            a.hint = true;
            message = a.puzzle.hint;
        }
        if (action === "quest_solve") {
            if (a.inspected.length !== a.puzzle.clues.length)
                fail("Read each clue before submitting the puzzle.");
            const answer = payload.answer;
            if (!Array.isArray(answer) || answer.length > 25 || answer.some(v => !Number.isInteger(v)))
                fail("Invalid puzzle answer.");
            const expected = [...a.puzzle.solution], submitted = [...answer];
            if (a.puzzle.kind === "build") {
                expected.sort((x, y) => x - y);
                submitted.sort((x, y) => x - y);
            }
            a.solved = JSON.stringify(expected) === JSON.stringify(submitted);
            message = a.solved ? "That fits! Choose how this letter ends." : "Not quite. Read the clues or ask for a hint — your reward stays the same.";
        }
        if (action === "quest_choose") {
            if (!a.solved)
                fail("Finish the puzzle before choosing its ending.");
            const choice = a.quest.choices.find((c) => c.id === payload.choice);
            if (!choice)
                fail("Unknown ending.");
            const original = assigned(s, a.day, account);
            if (original.done[tier])
                fail("This reward has already been delivered.");
            original.done[tier] = true;
            s.stamps += a.reward.stamps;
            gemDelta += a.reward.gems;
            const receipt = { id: a.id, quest_id: a.quest.id, day: a.day, tier, gems: a.reward.gems, stamps: a.reward.stamps, choice: choice.id, reply: choice.reply, at: now };
            receipts.push(receipt);
            if (tier === "story" && a.quest.chapter_order) {
                if (a.quest.chapter_order !== s.story_next)
                    fail("This story chapter has already been completed.");
                s.chapters[a.quest.id] = { choice: choice.id, label: choice.label, reply: choice.reply, title: a.quest.title, npc: a.quest.npc, postcard: a.quest.postcard, arc_reward: a.quest.arc_reward, at: now };
                if (a.quest.flag)
                    s.flags[a.quest.flag] = choice.label;
                s.story_next++;
            }
            const week = String(weekId(day));
            s.weeks[week] ||= { days: [], rewarded: false };
            if (!s.weeks[week].days.includes(day))
                s.weeks[week].days.push(day);
            if (s.weeks[week].days.length >= 5 && !s.weeks[week].rewarded) {
                s.weeks[week].rewarded = true;
                s.stamps += 8;
                receipts.push({ id: `week:${week}`, gems: 0, stamps: 8, at: now, quest_id: "weekly", tier: "weekly" });
            }
            delete s.active[tier];
            message = choice.reply;
        }
    }
    else if (action === "quest_redeem") {
        const cosmetic = COSMETICS.find(c => c.id === payload.cosmetic_id);
        if (!cosmetic)
            fail("Unknown reward.");
        if (s.cosmetics.includes(cosmetic.id))
            fail("You already own this reward.");
        if (s.stamps < cosmetic.price)
            fail("You need more Dispatch Stamps.");
        s.stamps -= cosmetic.price;
        s.cosmetics.push(cosmetic.id);
        s.equipped = cosmetic.id;
        receipts.push({ id: `cosmetic:${cosmetic.id}`, quest_id: cosmetic.id, gems: 0, stamps: -cosmetic.price, tier: "cosmetic", at: now });
        message = `${cosmetic.name} added to your Dispatch collection.`;
    }
    else if (action === "quest_equip") {
        if (payload.cosmetic_id !== "" && !s.cosmetics.includes(payload.cosmetic_id))
            fail("You do not own that decoration.");
        s.equipped = payload.cosmetic_id;
        message = "Dispatch appearance updated.";
    }
    else if (action !== "quest_board_get")
        fail("Unknown quest action.");
    if (action !== "quest_board_get")
        s.revision++;
    return { state: s, board: view(s, day, now, account), gemDelta, receipts, message };
}
module.exports = { transition, dayId, weekId, fresh, CATALOGUE, COSMETICS };
