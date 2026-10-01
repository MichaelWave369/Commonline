# P0-s — Pre-membership history isolation

Status: **candidate implementation**

P0-s separates current room membership from access to the room's earlier durable event history.

P0-r made CommonLine's resumption surface useful enough to expose an older authority gap: the server previously calculated a reconnect delta only from the client-supplied acknowledged version. A first-time participant joining an existing room with version `0` could therefore receive durable events created before that identity ever belonged to the room.

P0-s closes that gap.

## Core law

```text
ROOM MEMBERSHIP != RETROSPECTIVE HISTORY ACCESS

FIRST JOIN
   ↓
CURRENT ROOM STATE
   +
NO PRE-MEMBERSHIP EVENT DELTA

KNOWN PARTICIPANT RECONNECT
   ↓
max(client acknowledgement, membership floor)
   ↓
AUTHORIZED RESUME DELTA
```

## Membership floor

The server derives an identity's history floor from the earliest durable `participant_joined` event for that participant in the room.

A resume request may acknowledge a version newer than that floor, but it may not rewind below it.

This means a reconnecting client cannot request `acknowledgedVersion: 0` to recover events that occurred before its membership began.

## First-time join

For an identity not already represented in the room:

- the normal current authoritative `RoomSnapshot` is returned
- `resumeDelta` is empty
- the participant's join becomes a durable room event
- future reconnects may resume events beginning at that membership boundary

P0-s does not attempt to hide the room's current canonical state from a participant who has `READ_ROOM_STATE`. It isolates **historical room-event replay** from first-time membership.

## Fail-closed provenance behavior

If a participant is present in durable room state but no matching durable first-join event can be found, P0-s does not guess an earlier history floor. The effective floor becomes the current room boundary, withholding older event history.

## Deliberately not implemented

P0-s does not yet add retrospective-history sharing.

There is no action that lets a steward grant a newly joined participant access to older event history. That must be designed as a separate explicit authority path rather than smuggled through join, role, or current-state access.

## Wire and storage

No wire shape or SQLite table changes are required.

The existing `p0-q.1` wire already carries:

- participant identity
- client acknowledged room version
- durable room events
- resume delta

P0-s tightens server-side authorization semantics over those existing fields.

## Acceptance claims

P0-s is successful when:

- a first-time participant in an existing room receives zero pre-membership resume events
- a known participant still receives missed post-membership durable events
- supplying an artificially old acknowledged version cannot rewind before the membership floor
- missing membership provenance fails closed
- current authoritative room state remains unaffected
- ephemeral media, transcripts, scratch, sessions, and signaling remain outside durable history

## Relationship to P0-r

P0-r derives a selective resume brief from `RoomSnapshot + resumeDelta`.

P0-s makes the `resumeDelta` half safe for membership boundaries before CommonLine relies on that brief as an experience primitive.
