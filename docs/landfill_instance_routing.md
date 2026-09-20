# Landfill instance routing

New entries are accepted only while an instance is waiting for players or counting
down. Racing and finished instances reject all entries, including former racers.
An event-assigned player whose race starts during loading receives a
`landfill_instance_redirect` and a new normal world-entry snapshot. The client
matches the redirect to its active request before switching worlds.

Actual world-index arrival/removal updates event membership immediately. Leaving
or disconnecting forfeits re-entry to that instance. A used waiting room becomes
abandoned as soon as its final participant leaves; matchmaking skips it immediately
and the next cleanup tick destroys it. An empty world whose provisional admissions
expire is also retired instead of having its slots cleared for reuse.

Allocation is serialized through world initialization. Repeated requests while
loading the same waiting room remain idempotent. Other players can share an open
waiting room, but nobody is routed back to an instance they departed. New instances
reset world state and receive a different world name/terrain seed. Cross-world doors
cannot bypass event matchmaking.

Validation: `check:server-landfill-event`,
`check:server-phase8-player-session-routes`, `check:types`, server-entry build,
and the Godot `tests/landfill_redirect_test.gd` test. These checks use fixtures;
they do not deploy or exercise live multiplayer accounts.

Ship the server changes with the client redirect handler. Older clients do not
recognize the new redirect message used when an assigned race starts during loading.
