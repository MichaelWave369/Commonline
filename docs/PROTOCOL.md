# Commonline Protocol Notes

Status: **Exploratory protocol proposal**

Commonline does not initially need a new media codec. The protocol work belongs around coordination semantics: admission, context, attention, authority, persistence, and resumption.

## Candidate primitives

| Primitive | Purpose |
|---|---|
| `offer_interaction` | Request a bounded exchange with purpose, modalities, context offer, expiry, and limits |
| `admit_participant` | Approve participation in an episode without automatically granting room history |
| `grant_context` | Disclose specific material to a specific recipient for a specific purpose |
| `request_floor` | Ask to occupy a shared attention surface |
| `lease_floor` | Grant a bounded speaking/attention interval |
| `offer_work` | Establish a bounded task with context, budget, deadline, and expected result |
| `propose_outcome` | Return an artifact, decision proposal, or external-effect proposal |
| `accept_outcome` | Add reviewed work to durable room state |
| `authorize_effect` | Permit one exact external effect |
| `revoke_grant` | Stop future use and report in-flight limitations |
| `resume_view` | Retrieve currently authorized changes since an acknowledged room version |
| `receipt` | Record an observed lifecycle transition |

## Important separations

```text
CAN WORK      ≠ CAN SPEAK
CAN SPEAK     ≠ CAN RECEIVE MEDIA
CAN RECEIVE MEDIA ≠ CAN RECORD
CAN SPEAK     ≠ CAN CONTACT
CAN CONTACT   ≠ CAN DELEGATE
CAN PROPOSE   ≠ CAN ACCEPT
CAN ACCEPT    ≠ CAN EXECUTE
CAN EXECUTE   ≠ AUTHORITY OVER EVERYTHING
```

## Attention lease

Task authority does not grant interruption authority. An agent can return a silent result card, request a private cue, or ask for a speaking lease. A deterministic controller should enforce duration, audience, and cancellation.

## Ephemeral media signaling

P0-c adds implementation-level WebRTC signaling messages for `offer`, `answer`, `ice`, and `hangup`.

These are **not durable room events** and are not candidates for resumption history. The room service checks that sender and recipient are online in the same room, that the sender has `SPEAK`, and that the target has `RECEIVE_MEDIA`, then relays the signaling payload directly.

The signaling path does not imply recording, transcription, agent listening, or retention of media. Media permissions and durable coordination permissions remain independent.

## Agent-to-agent interaction

Structured asynchronous exchange should be the default. Live exchange is useful when clarification, negotiation, demonstration, or human judgment requires synchronous attention.

A receiver may accept, decline, defer, declare busy, request less context, or request a live episode.

## Execution grants

An execution grant should bind at least:

- actor
- issuer
- tool audience
- operation
- exact resource
- immutable payload digest
- expiry
- limits
- delegation policy

The executor re-evaluates the grant immediately before dispatch.

## Receipts

Receipts should distinguish:

- received
- accepted
- dispatched
- completed
- failed
- outcome unknown

A signed receipt can support attribution. It does not make the underlying claim true.

## Federation

Federation is deferred until the local semantics are proven. A future interoperability test should require two independently implemented systems to correctly handle refusal, revocation, stale context, withdrawal, and uncertain outcomes.


## P0-d frozen wire profile

Wire schema marker: `p0-d.1`.

### Identity fields

A join request carries both:

- `participantId` — logical room principal
- `sessionId` — ephemeral browser/runtime attachment

The server binds one current live session per room + participant and may supersede an older connection.

### Grant receipts

Capabilities are represented by grant receipts instead of role-derived booleans. A grant receipt binds subject, capability, issuer, issue time, and optional expiry/revocation.

Roles remain useful UI/context labels but are not the authority source.

### Acceptance intent

`accept_outcome` binds:

- `acceptId`
- `workItemId`
- `artifactId`
- `authorityGrantId`
- `baseVersion`

The same `acceptId` is idempotent across reconnect/retry. P0 has one canonical accepted outcome per work item.

### Non-event channel

Agent scratch and content-free work status are separate from the durable room event plane.

```text
scratch       -> private ephemeral
status        -> visible ephemeral
proposal      -> visible durable room event
acceptance    -> durable receipt
```

Scratch must never be reconstructed from or copied into a durable receipt merely for audit convenience.


## P0-f identity profile

Wire schema: `p0-f.1`.

Before `join_room`, a human connection must complete one of:

```text
identity_begin -> identity_challenge -> identity_prove
identity_recover -> identity_authenticated
```

The server binds the authenticated participant id and session id to that WebSocket. A subsequent `join_room` must match both.

Identity challenge/proof messages are transport authentication material, not room events.

## P0-f grant revocation

New revocations use separate immutable `GrantRevocationReceipt` objects.

The legacy optional `GrantReceipt.revokedAt` field remains readable for P0-d migration compatibility, but P0-f authority transitions do not mutate grant receipts.

## P0-f authority transfer

`transfer_accept_authority` binds:

- stable `transferId`
- room id
- base room version
- target participant id
- exact active `ACCEPT_OUTCOME` grant id

The result is an `AuthorityTransferReceipt` referencing the revoked grant, revocation receipt, and newly issued grant.

Transfer is idempotent across retry/restart.


## P0-g media configuration profile

Wire schema: `p0-g.1`.

After authentication and room admission, the browser may send:

```text
rtc_config_request
```

The server returns ephemeral:

```text
rtc_config
  iceServers
  iceTransportPolicy
  credentialMode
  expiresAt?
```

This message is not a room event and does not increment the room version.

TURN credentials prove permission to use relay infrastructure. They do not grant Commonline room capabilities.

### Secure signaling rule

Non-loopback deployments must use HTTPS + WSS. Plain `ws://` is accepted only for loopback development.

### Media diagnostics

WebRTC candidate selection, RTT, jitter, loss, byte counters, ICE errors, and connection-state changes remain client-local observations. They are not receipt claims and are not durable room truth.


## P0-h media-session profile

Wire schema: `p0-h.1`.

Before SDP signaling, a participant sends:

```text
rtc_call_open
  roomId
  targetParticipantId
```

The server responds to both endpoints with ephemeral:

```text
rtc_call_session
  callId
  generation
  peerParticipantId
  initiatorParticipantId
  polite
  createdAt
```

Every subsequent `rtc_signal` binds:

- room id
- call id
- generation
- target participant
- offer / answer / ICE / hangup payload

The server rejects a signal whose call id, generation, or participant pair does not match an active media session.

Media-session messages do not increment room version and do not enter resume history.

### Glare rule

The participant pair has exactly one deterministic polite peer.

A simultaneous offer collision is resolved by perfect negotiation rather than by creating competing durable state.

### Call lifetime

One participant may occupy at most one active P0-h media session. Simultaneous opens for the same pair coalesce; attempts to open a different call while busy are rejected.

Hangup ends exactly one call generation. Later signaling for that generation is stale.


## P0-i multiparty media profile

Wire schema: `p0-i.1`.

### Ephemeral group control

Client intents:

```text
group_media_join
group_media_leave
group_media_publish_microphone
group_media_unpublish
group_media_subscribe
group_media_unsubscribe
```

Server broadcasts:

```text
group_media_state
  mediaSessionId
  generation
  routerMode
  participants[]
  sources[]
  subscriptions[]
```

The P0-i router mode is `mesh-p0`.

### Source authority

Publishing a microphone requires the publisher's active `SPEAK` grant.

Subscribing to a source requires the subscriber's active `RECEIVE_MEDIA` grant.

Joining does not imply either action.

### Group signaling

`group_rtc_signal` binds:

- room id
- media session id
- generation
- target participant id
- SDP / ICE payload

The server relays group signaling only when the participants belong to the active group session and at least one directed subscription requires a transport between that pair.

These messages are ephemeral and never increment room version.

### SFU compatibility

The source/subscription objects are intended to survive a future transport swap from `mesh-p0` to an SFU adapter. No SFU is permitted to infer durable room authority merely from media routing state.

## P0-j mediasoup SFU profile

Wire schema: p0-j.1.

The existing group join, leave, publish, unpublish, subscribe, and unsubscribe intents remain authoritative. Router mode is now mediasoup-p0.

Authenticated SFU requests cover router capabilities, send/receive transport creation, DTLS connection, Producer creation, Consumer creation, and Consumer resume. Each operation binds to the current group mediaSessionId and generation.

Producer creation requires active SPEAK plus ownership of the published source. Consumer creation requires active RECEIVE_MEDIA plus an explicit directed subscription to the requested source.

Legacy group_rtc_signal is rejected in P0-j. Multiparty audio must traverse the governed SFU. SFU request/response traffic remains ephemeral and never increments room version.