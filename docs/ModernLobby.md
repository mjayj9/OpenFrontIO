# Modern country private rooms

Open **Create room**, enable **Modern country room (private)**, and share the
existing room invite. The preset uses the same checked-in 198-controller,
2000×1000 Modern World scenario as single-player. Choose difficulty, balance,
victory condition, target, time limit, protection, alliances and nuclear weapons.
Enhanced AI settings reuse the existing setup component. The normal classic room
settings are available again when the modern preset is disabled.

Each playing participant previews a country through the actual ownership raster,
search or list and presses **Reserve this country**. Flags, capital, neighbors,
starting grants and enlarged microstate representations are shown. Reservations
are confirmed by the server and visible to the whole room. Spectators do not hold
a country. The host can start once at least two playing participants selected
different countries; unreserved countries are AI nations.

`countryId` is separate from client ID and the stable simulation player ID.
`PlayerSchema` and lobby client records include the server-owned ISO3 selection.
The optional field also enters the existing start payload, snapshots and game
records. Country-sorted controller creation makes results independent of join
order. `modernMode.countryId` remains the backward-compatible single-player
selection fallback; private rooms require every player to provide a reservation.

The binary protocol appends `select_country` and `modern_lobby_status` variants.
Rejections are nonfatal and show retry instructions. As with the existing zbin
wire policy, clients and server must run the same build. No external account,
shop or statistics API implementation was added. Room creation and invitations
reuse the existing repository pathways.

Server reservations and readiness checks are synchronous. Duplicate, unknown,
spectator and post-start requests cannot mutate a reservation. Start rechecks
the live roster after prestart, so a late unselected participant cancels the
countdown without freezing a broken controller list. Leaving for spectator mode
releases the reservation. A returning authenticated nonhost lobby participant
retains a country if it is still free; an occupied country must be selected again.
The existing policy closes a room when its host disconnects before prestart;
this behavior is retained. After match start the existing roster/rejoin pathway
preserves the frozen player-to-country mapping.

`tests/server/ModernLobby.test.ts` drives actual binary websocket frames through
the real server and covers duplicate reservations, incomplete start, late joins,
spectator release, reconnect, invalid rules, public-mode rejection and classic
mode switching. `ModernWorld.test.ts` covers two-human KOR/JPN initialization,
all other AI controllers, actual territory/capital/facilities, country-order
mapping and deterministic snapshot continuation. A browser playtest is separate
from these simulation and server tests.
