# P0-i Multiparty Media Boundary

Status: **candidate three-human executable routing proof**

Wire schema: `p0-i.1`  
Storage schema metadata: `p0-i.1`

P0-i proves the control semantics required for multiparty media before Commonline commits to a production SFU implementation.

The executable transport in this rung is deliberately:

```text
routerMode = mesh-p0
```

Three browsers can exchange audio through pairwise WebRTC connections, but the control model is expressed in SFU-shaped primitives: participants, identified media sources, and directed subscriptions.

## Governing separations

```text
JOIN GROUP MEDIA
      ≠
PUBLISH MICROPHONE

PUBLISH SOURCE
      ≠
ANYONE SUBSCRIBES

RECEIVE_MEDIA
      ≠
SPEAK

MEDIA ROUTER
      ≠
ROOM AUTHORITY

AGENT PARTICIPANT
      ≠
AGENT MAY LISTEN
```

No agent media capability is added in P0-i.

## Group media session

The first joining human creates one ephemeral group media session for the room.

It contains:

- `mediaSessionId`
- generation
- router mode
- maximum participant count
- ephemeral participant membership
- published sources
- directed subscriptions

P0-i is intentionally capped at **three humans**.

When the final participant leaves, the session disappears. A later session gets a new id and higher generation.

## Identified sources

A participant with an active `SPEAK` grant may explicitly publish one microphone source:

```text
GroupMediaSource
  sourceId
  ownerParticipantId
  kind = microphone
  publishedAt
```

Joining group media does not open the microphone.

Publishing requires a separate user action and browser microphone permission.

## Directed subscriptions

A participant with an active `RECEIVE_MEDIA` grant may explicitly subscribe to another participant's published source.

```text
subscriber participant
        ↓
sourceId
        ↓
owner participant
```

Subscriptions are directional.

Alice subscribing to Bob does not imply Bob subscribes to Alice.

A browser creates a peer transport only when at least one active subscription requires media between the pair.

## Mesh executable proof

P0-i uses pairwise WebRTC links to prove the semantics without introducing an SFU dependency yet.

For every participant pair:

- if neither side subscribes to the other, no peer connection is required
- if A subscribes to B, B publishes its local track onto that pair connection
- if both subscribe, both microphone tracks may share the pair connection
- perfect-negotiation rules remain active per peer pair
- STUN/TURN configuration from P0-g is reused

This supports a real three-human audio proof while keeping sources individually identified in control state.

## Important enforcement limitation

The server authoritatively controls:

- who may join group media
- who may publish a source
- who may create a subscription
- whether signaling is allowed for a participant pair

However, `mesh-p0` is peer-to-peer encrypted media. The Commonline server cannot inspect SRTP packets and therefore cannot technically prevent a malicious modified browser from placing an unauthorized track onto an already-authorized peer connection.

The supported Commonline client obeys the source/subscription plan.

A future SFU adapter is required for **server-enforced per-source packet routing** against an untrusted client.

That limitation is why this rung is named the multiparty **boundary**, not "production SFU complete."

## Signaling

Group WebRTC signaling binds:

- room id
- group media session id
- generation
- target participant
- SDP / ICE payload

The server rejects signaling when:

- the group session is stale
- either participant is not in the group
- there is no active subscription relationship requiring transport between the pair

Group signaling is ephemeral and never enters room history.

## Leave and cleanup

When a participant leaves group media or disconnects:

- its membership is removed
- its microphone source is removed
- subscriptions to that source are removed
- subscriptions owned by that participant are removed
- remaining browsers receive a new group state
- pair connections with no remaining route are closed

Human room membership and durable undertaking state remain untouched.

## Persistence boundary

There are intentionally no SQLite tables for:

- group media sessions
- media sources
- media subscriptions
- peer connections
- SDP
- ICE
- audio frames

P0-i advances schema metadata only so old runtime versions cannot silently reinterpret the new wire.

## Proof suite

P0-i tests:

1. no more than three humans may join the group proof
2. microphone publication is idempotent
3. signaling is rejected until a directed subscription exists
4. leaving removes owned sources and dependent subscriptions
5. a fully ended group increments generation on recreation
6. no peer route exists without a subscription
7. one-way subscription creates one-way source intent
8. group-media/source/subscription tables remain absent from SQLite
9. P0-h metadata migrates explicitly to P0-i

## Next rung

P0-j can implement a real SFU adapter behind this control model.

The important requirement is that an SFU should consume the existing identities:

```text
participant
source
subscription
media session
generation
```

rather than forcing Commonline to redefine governance around an SFU vendor's room abstraction.
