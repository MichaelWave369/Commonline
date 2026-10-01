# P0-e Local Persistence

Status: **candidate local durable store**

Storage schema: `p0-e.1`  
Wire schema: `p0-d.1`

P0-e makes the Commonline room survive process restarts without broadening what counts as durable.

## Durable tables

SQLite stores:

- rooms
- participants
- grant receipts
- work items
- proposal artifacts
- acceptance receipts
- room events
- schema metadata

The database is local by default:

```text
./data/commonline.db
```

Override with `COMMONLINE_DB_PATH`.

## Explicitly non-durable

The store has no table for:

- scratch content
- agent work-status pulses
- browser sessions
- WebSocket connections
- WebRTC signaling
- audio frames

That absence is deliberate architecture, not an unfinished migration.

## Runtime presence after restart

Participant identity is durable. Presence is not.

When the server restarts:

- human participants load as `offline`
- the room loads with `episodeActive = false`
- the built-in silent agent loads as available
- a human reconnect creates a new live join transition

A database row never resurrects a dead browser socket.

## Atomic transition rule

Every durable room transition is written under:

```text
BEGIN IMMEDIATE
  verify persisted previous room version
  write next room snapshot tables
  append exactly one room event
COMMIT
```

Memory is mutated only **after** SQLite commits.

If event insertion or any snapshot write fails, SQLite rolls the entire transition back.

## Optimistic version protection

The store compares the database room version to the expected previous version before replacing snapshot tables.

This prevents a stale writer from erasing a newer canonical acceptance.

## Crash-safe idempotent acceptance

Acceptance IDs were made stable in P0-d. P0-e makes the receipt survive restart.

If the sequence is:

```text
accept request
  ↓
SQLite COMMIT
  ↓
process / network dies before reply
  ↓
restart
  ↓
same acceptId retried
```

the server reloads the original acceptance receipt and returns it instead of creating another acceptance.

## Schema metadata

`schema_meta` records:

- `storage_version = p0-e.1`
- `wire_schema_version = p0-d.1`
- creation time

The store refuses to open a database whose storage or wire version does not match the runtime. P0-e intentionally has no automatic migration magic yet. Silent reinterpretation would be worse than a loud refusal.

## Proof suite

P0-e tests:

1. accepted room state survives store close / reopen
2. participant identity and grants survive
3. human runtime presence does not survive
4. room event history survives
5. same acceptance ID returns its original receipt after restart
6. a failed event append rolls back the snapshot mutation
7. scratch poison text cannot appear in durable tables
8. incompatible schema metadata is rejected

## Next storage work

Future rungs can add explicit migrations, backups, compaction, encrypted-at-rest options, and multi-process coordination. None of those are required to prove the P0-e local durability boundary.
