# Multiplayer interaction fixes — 2026-09-28

Area-lock player checks now return the same public-profile response as world-lock checks. Clients send only the edited lock; the authoritative server validates ownership, preserves other locks, and uses the existing PostgreSQL world commit and object journal. Public or named area access applies within that lock's coverage even when the surrounding world is private. It does not grant world-wide access or permission to manage the lock.

Movement snapshots carry bounded jump and punch visual counters. They advance only through accepted movement, participate in presence deduplication, and survive normal packet coalescing. Observers baseline counters on entry, ignore duplicate snapshots, restart repeated wing/weapon animations, and return to locomotion when a swing expires. Wings follow locomotion during body action overlays. Intermediate block hits also show the observer's attack animation. These counters do not authorize damage, movement or rewards.

World transitions clear popup/focus state at both ends. Input is consumed while joining, warping or revealing the world and for 200 ms afterward to drain the completion event. Shop and chat entry points also honor the guard. UI opening remains available after the transition.

Validation: the Godot multiplayer_interaction_regression_test exercises lock patches, private-world coverage, action-counter baselines/duplicates, real wing and weapon animation restarts, action expiry and shop guards. Backend route tests verify public lookups and accepted/rejected movement counters; area-lock tests cover scoped updates, ownership and public/named access. The normal staging release runs the full security and build checks.
