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

## P0-k media source policy profile

Wire schema: `p0-k.1`.

`group_media_publish_microphone` is replaced by the generic:

```text
group_media_publish_source
  kind
  label
```

Group media state now includes `sourcePolicies[]` and each source binds `kind + label + policyId`.

Executable P0-k kinds are `human-microphone` and `sound-effect`. `shared-music`, `agent-voice`, and `system-tone` are declared but reserved.

All source policies currently require SPEAK, use explicit subscriptions, remain ephemeral, and default recording to not-authorized. Principal-kind restrictions still apply independently of SPEAK.

SFU Producer creation revalidates the current source policy and policy ID. Consumer creation remains bound to RECEIVE_MEDIA plus the exact source subscription.


## P0-m agent voice authority profile

Wire schema: `p0-m.1`.

P0-m adds the generic capability `MANAGE_AGENT_VOICE` plus specialized durable receipts for voice-authority bootstrap, agent voice grant, and agent voice revocation.

New intents:

```text
bootstrap_agent_voice_authority
grant_agent_voice
revoke_agent_voice
```

The one-time bootstrap requires the exact active ACCEPT_OUTCOME grant and issues a separate MANAGE_AGENT_VOICE grant. Subsequent grant/revoke operations require MANAGE_AGENT_VOICE rather than ACCEPT_OUTCOME.

Agent voice grants bind agent participant ID, voice ID, explicit-subscription audience, issuer, management authority grant, optional expiry, and committed room version.

The `agent-voice` media-source policy remains reserved in P0-m. Its required authority is now `AGENT_VOICE_GRANT`, not generic SPEAK.


## P0-n local agent voice renderer profile

Wire schema: `p0-n.1`.

P0-n adds the ephemeral client intent `request_agent_voice_utterance`, binding agent participant ID, exact voice grant ID, exact management authority grant ID, and the bounded `authority-proof` utterance kind.

The request requires the exact active `MANAGE_AGENT_VOICE` grant and exact active agent voice grant. It is rejected when group media is absent, the renderer is unavailable, the grant is stale, or another utterance for that room/agent is already active.

The server broadcasts content-free `agent_voice_utterance_status` messages with queued, rendering, speaking, completed, or failed state.

Agent voice becomes an executable media-source class in P0-n, but the source may only be instantiated by the trusted server-side agent voice runtime after the active voice grant and renderer identity are revalidated. Human `group_media_publish_source` remains unable to publish an agent-owned source.

The live source uses mediasoup DirectTransport and PCMU RTP injection. Listener Consumers still require the ordinary exact source subscription plus `RECEIVE_MEDIA`.


## P0-o attention lease and directed-turn profile

Wire schema: `p0-o.1`.

P0-o adds three ephemeral client intents:

```text
grant_attention_lease
revoke_attention_lease
request_agent_turn
```

The first lease mode is `one-turn`. A lease is scoped to one room, one target agent, and the human participant who granted it. It has a short TTL, is not durable, and may be consumed exactly once.

`request_agent_turn` binds a stable turn request ID, the exact attention lease ID, the target agent, and a bounded prompt. The server refuses the turn if the lease is missing, owned by somebody else, expired, revoked, or already consumed.

Successful lease state changes are returned through `attention_lease_state`. Directed turn progress uses the content-free `agent_turn_status` message with thinking, rendering, speaking, completed, or failed state.

P0-o does not add prompts or responses to room history. Voice authority and listener subscriptions remain separate requirements.
