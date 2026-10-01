# P0-h Ephemeral Media Sessions + Perfect Negotiation

Status: **candidate one-to-one media-session rung**

Wire schema: `p0-h.1`  
Storage schema metadata: `p0-h.1`

P0-h makes the call itself an explicit ephemeral object before Commonline attempts multi-party media.

## Governing separation

```text
IDENTITY
    ≠
ROOM AUTHORITY
    ≠
MEDIA SESSION
    ≠
MEDIA CONNECTIVITY
```

A media session identifies one live call attempt. It does not become durable undertaking state.

## Media session

The server creates an ephemeral session containing:

- `callId`
- `generation`
- participant pair
- initiating participant
- creation time

The server sends each endpoint its peer id plus a deterministic `polite` flag for perfect negotiation.

The session is not written to SQLite and does not increment the room version.

## Why generation exists

A participant pair may call repeatedly.

```text
call A
  callId = call-1
  generation = 1
  ↓
ended

call B
  callId = call-2
  generation = 2
```

Every offer, answer, ICE candidate, and hangup binds to both `callId` and `generation`.

Late signaling from generation 1 cannot contaminate generation 2.

## Server arbitration

The server keeps at most one active media session per participant.

Simultaneous open requests between the same pair are **coalesced** onto one session rather than creating two calls.

A request involving a participant already in another media session is rejected as `MEDIA_BUSY`.

Signals for ended or mismatched sessions are rejected as `MEDIA_SESSION_STALE`.

## Perfect negotiation

Simultaneous SDP offers are resolved with the WebRTC perfect-negotiation pattern.

For each participant pair one side is deterministically **polite** and the other **impolite**.

When offers collide:

- the impolite peer ignores the colliding remote offer
- the polite peer accepts the remote offer and lets WebRTC roll negotiation forward
- answers and later candidates remain bound to the exact call generation

This prevents glare from turning two simultaneous Call clicks into competing media realities.

## Human consent remains explicit

Opening a media session does not automatically open the recipient microphone.

- caller clicking **Call** is local consent to activate microphone after the server allocates the session
- recipient sees an incoming session
- recipient microphone opens only after **Answer**
- **Decline** sends an exact-session hangup

If both humans independently click Call at nearly the same time, both have supplied local microphone consent and perfect negotiation resolves the offer collision.

## Exact-call cleanup

Hangup targets one exact `callId + generation`.

The media session ends when:

- either participant hangs up
- recipient declines
- setup fails
- the peer leaves the room
- the transport/media failure path sends a failure hangup

When a participant leaves the room, the server closes that participant's exact active media session and informs the remaining peer with `peer-left`.

## Persistence boundary

P0-h changes storage metadata so old databases explicitly migrate from `p0-g.1` to `p0-h.1`.

There is intentionally **no media-session table**.

Not persisted:

- call ids
- call generations
- SDP
- ICE candidates
- TURN credentials
- selected candidate pairs
- WebRTC stats
- microphone tracks
- perfect-negotiation state

A process restart terminates all live calls while preserving the durable undertaking.

## Proof suite

P0-h tests:

1. simultaneous opens for the same pair coalesce to one call
2. a participant cannot occupy two active calls
3. ended call signaling becomes stale
4. a new call increments generation
5. participant departure ends the exact active session
6. exactly one peer is deterministic polite
7. glare detection follows perfect-negotiation rules
8. impolite peer ignores a colliding offer
9. polite peer does not ignore that collision
10. session equality binds both call id and generation
11. P0-g storage metadata migrates to P0-h

## Next media rung

With one-to-one calls now explicitly identified and collision-safe, a future SFU can route named media sessions instead of inferring relationships from anonymous SDP traffic.
