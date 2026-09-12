# Connection-loss simulation tests (group session)

## Status
Implemented + passing (`tests/reconnect.test.js`, 3/3 green; wired into
`backend/package.json` `npm test`).

## What it verifies (PRD §8.4 reconnect/rejoin)
`tests/reconnect.test.js` boots a real server (ephemeral port + temp SQLite
file, same harness as `realtime.test.js`) and simulates network drops with
real Socket.io clients — no mocks:

1. **Guest transport drop** — guest socket `disconnect()`s abruptly with NO
   `session:leave` (WiFi cut / phone lock). While offline the host keeps
   editing (v1 → v2); the offline client receives nothing. A NEW socket with
   the same `userId` re-emits `session:join` (the client rejoin path from
   `socket-reconnect-rejoin.md`): the ack replays the FULL cart (pre-drop
   lines + lines added while offline) at the current version, `cart:sync` +
   `participants:sync` re-fire as live events, and presence stays single
   (exactly one participant row per user — no duplicate on rejoin).
2. **Stale-mutation heal** — a mutation flushed with a stale `baseVersion`
   (like one buffered while offline) is rejected with `VERSION_CONFLICT` +
   `currentState`, then a single retry against `currentVersion` succeeds
   (PRD §10.4).
3. **Host connection loss** — abrupt host drop transfers host to the oldest
   connected participant (`host:changed` received by the guest); when the old
   host rejoins on a new transport, the join ack reports the NEW `hostId` and
   a single `isHost` participant row, so the client recomputes checkout
   rights instead of assuming it is still host.

## How to run
```bash
cd backend
node --test ../tests/reconnect.test.js   # just these
npm test                                  # full suite (includes reconnect)
```

## Files
| Path | Role |
|------|------|
| `tests/reconnect.test.js` | The three drop/rejoin scenarios above |
| `backend/package.json` | `npm test` now includes `../tests/reconnect.test.js` |
| `context/architecture/socket-reconnect-rejoin.md` | Client-side rejoin design this proves |
