# P0 Browser Room

Commonline P0 is being built in evidence-preserving rungs instead of jumping directly from a design study to telephony.

## P0-a — local semantics scaffold

P0-a established:

```text
Create Room
→ Send Bounded Silent-Agent Task
→ Receive Proposed Artifact
→ Explicitly Accept Artifact
→ Leave
→ Resume Durable Room State
```

It intentionally used browser-local state and a mock worker so the project could test the semantics before introducing networking and model variability.

## P0-b — server-authoritative synchronized room

P0-b moves mutation authority out of the browser.

Two browser sessions now converge through:

```text
CLIENT INTENT
    ↓
ROOM SERVICE
    ↓
version + authority validation
    ↓
accepted room event
    ↓
new authoritative room version
    ↓
broadcast to connected clients
```

### Implemented in this rung

- Node WebSocket room service
- in-memory authoritative room store
- monotonically increasing room versions
- per-browser temporary principal IDs
- join / leave presence events
- synchronized bounded work items
- server-owned silent mock worker
- synchronized artifact proposals
- explicit `ACCEPT_OUTCOME` authority
- stale-version rejection and reconciliation
- room event log in server memory
- missed-event resume delta
- worker failure isolated from room transport
- health endpoint at `/health`
- tests for stale writes, steward authority, and resume delta

### Governance boundary

The first human principal to create a room becomes the room steward and receives `ACCEPT_OUTCOME`.

Other human participants receive `SUBMIT_WORK` but not automatic acceptance authority.

The silent worker has:

- `READ_SELECTED_CONTEXT` ✓
- `WRITE_DRAFT_ARTIFACT` ✓
- `SPEAK` ✕
- `EXECUTE_EXTERNAL_EFFECT` ✕

A browser never directly mutates durable room state. It sends a version-bound intent and receives either an accepted event or a rejection.

### Persistence boundary

The server store and event log are intentionally in memory.

A service restart resets the room. This rung proves synchronization and authority semantics, not durable infrastructure.

### Identity boundary

Client principal IDs are temporary browser-session identifiers. They are not authenticated identities.

No claim of person verification, agent attestation, or account recovery is made yet.

## Local development

```bash
npm install
npm run dev
```

This starts:

- room service: `http://localhost:8787`
- browser app: Vite development server

Open two browser tabs or windows, join with different display names, and watch room state synchronize.

Because session identity is tab-scoped, separate tabs can represent separate P0 participants.

## Still not implemented

- WebRTC human audio
- durable database storage
- authenticated principals
- consent negotiation for live machine listening
- encrypted media routing
- real model/provider adapter
- external tool execution
- durable effect receipts
- SIP/PSTN gateway
- federation

## P0-c — one-to-one human WebRTC audio

P0-c puts actual live voice into the Commonline episode while keeping media separate from durable coordination.

```text
Browser A microphone
        │
        ├──── WebRTC media ────┐
        │                      │
        │                 Browser B speaker
        │
        └── ephemeral signaling ── Room Service
                                   │
                                   └── durable room state remains separate
```

### Implemented in this rung

- one-to-one human WebRTC audio
- explicit Call / Answer / Decline / Hang up flow
- microphone acquisition only after a human places or answers a call
- mute / unmute
- WebRTC offer, answer, ICE-candidate, and hangup signaling through the existing WebSocket connection
- signaling relayed only between online participants in the same room
- `SPEAK` and `RECEIVE_MEDIA` grants checked before relay
- silent worker explicitly denied `RECEIVE_MEDIA` and `SPEAK`
- signaling messages excluded from room versions, event history, and resume deltas
- optional STUN configuration
- tests confirming media signaling authorization does not mutate durable room state

### Deliberate privacy boundary

The silent worker does **not** receive microphone audio in P0-c.

The browser may send selected text work to the agent, but live media is human-to-human only.

This rung does not record audio, transcribe speech, persist SDP/ICE signaling, persist audio frames, summarize speech, or feed live media to an agent.

A future machine-listening feature requires its own visible consent and media-recipient model rather than silently inheriting permission from room membership.

### Media versus coordination

Durable actions remain version-bound (`submit_work`, `accept_artifact`). WebRTC signaling (`offer`, `answer`, `ice`, `hangup`) is deliberately ephemeral. Those messages are validated against live membership and media grants, then forwarded directly to the intended peer. They do not create Commonline room events.

### Network boundary

By default P0-c uses no external ICE server. Same-host and some local-network tests can succeed with direct candidates. An optional `VITE_COMMONLINE_STUN_URL` may be configured for ICE discovery. STUN is not a relay; restrictive NAT/firewall combinations will require TURN in a later rung.

### Known P0-c limitations

- one-to-one audio only
- no call queue
- simultaneous cross-calling is not resolved with a perfect-negotiation algorithm
- no TURN relay
- no authenticated human identity
- no durable server persistence
- no call history
- no recording or transcription
- no agent audio
- no SIP/PSTN

## Local development

```bash
npm install
npm run dev
```

This starts the room service on `http://localhost:8787` and the Vite browser app. Open two browser sessions with distinct session storage, join the same room, and press **Call** from one participant. The other participant must explicitly press **Answer** before its microphone opens.

For cross-device testing, serve the web client from a secure context where required by browser microphone policy.

## Governance retained

The room still separates presence from media permission, `SPEAK` from `RECEIVE_MEDIA`, agent task permission from media access, proposed artifacts from accepted artifacts, accepted outcomes from external execution authority, and durable events from ephemeral media signaling.

## P0-d — identity, authority and scratch wire freeze

P0-d freezes the coordination wire **before** persistence.

The governing chain is now:

```text
Work item
   ↓
Scratch        ephemeral / private / non-event
   ↓
Proposal       room-visible / not canonical
   ↓
Acceptance     single-writer / idempotent / receipt-backed
   ↓
External effect (future, separately authorized)
```

### Frozen P0-d invariants

- participant identity is distinct from browser/session transport
- same-participant reconnects coalesce onto one current session
- reconnect uses exponential backoff with jitter
- the silent worker is a real `Participant`, not UI-only decoration
- observers are human participants with read-only grants
- authority is represented by immutable grant receipts
- `ACCEPT_OUTCOME` binds to work item + artifact + grant receipt
- accept IDs are client-stable and idempotent
- one work item has at most one canonical accepted outcome in P0
- competing acceptance returns the canonical acceptance receipt
- scratch is application-level temporary workspace, not model chain-of-thought
- scratch never enters room snapshots, room events, resume deltas, or acceptance receipts
- humans see work status without seeing scratch content
- WebRTC signaling remains ephemeral
- wire schema advertises `p0-d.1`

### Persistence boundary

P0-d still uses server memory. That is intentional.

SQLite/file persistence comes **after** these shapes survive the proof suite. Persisting P0-c first would fossilize browser-session identity and role accidents into storage.

### Known hole: accepted does not mean eternal truth

P0-d has no supersede/retract transition yet.

An accepted outcome is the room's current canonical outcome for that work item, not an assertion of permanent truth. Supersession is deliberately deferred one rung and must preserve prior receipts.

## P0-e — local SQLite persistence

P0-e persists the durable side of the frozen `p0-d.1` wire without persisting the ephemeral side.

```text
RoomService
   ↓
SQLite transaction
   ├── room
   ├── participants
   ├── grants
   ├── work items
   ├── proposals
   ├── acceptance receipts
   └── room events

Never stored:
   scratch / status / sessions / signaling / audio
```

### Implemented in this rung

- local SQLite database using Node's built-in SQLite API
- storage schema marker `p0-e.1`
- wire/storage compatibility checks
- lazy room + event recovery from disk
- human presence normalized offline after restart
- atomic room-snapshot + event transitions
- optimistic persisted-version check before every commit
- durable idempotent acceptance receipts
- canonical acceptance uniqueness in SQLite
- WAL + full synchronous mode for file-backed databases
- graceful SQLite close on process termination
- restart-recovery proof
- transaction rollback proof
- scratch poison-string durability proof

See [PERSISTENCE_P0E.md](PERSISTENCE_P0E.md).

### Still deliberately absent

- authenticated identity
- grant-transfer UI
- acceptance supersession / retraction
- TURN relay
- multi-party media
- agent audio
- external-effect execution
- SIP / PSTN

## Next rung

After P0-e is proven, the next architecture decision should be between identity/authority hardening and real-internet media hardening. Neither requires weakening the persistence boundary.


## P0-f — cryptographic identity + ACCEPT_OUTCOME handoff

P0-f separates proving a participant identity from granting that participant authority.

```text
P-256 identity proof
       ↓
authenticated session
       ↓
room join
       ↓
independent room-scoped grants
```

### Implemented in this rung

- browser P-256 key pair stored in IndexedDB
- non-exportable stored private signing key
- server challenge-response before room join
- one-time challenge expiry / replay prevention
- first-use identity enrollment
- recovery code shown only after enrollment / recovery
- server stores recovery hash, never raw recovery secret
- recovery rotates key + recovery code while preserving participant id
- identity claim persisted in local SQLite
- explicit P0-e -> P0-f storage migration
- immutable grant-revocation receipts
- atomic `ACCEPT_OUTCOME` handoff
- idempotent authority-transfer ids and receipts
- descriptive steward role follows the grant, but does not create authority
- authority-transfer history survives restart

See [IDENTITY_AUTHORITY_P0F.md](IDENTITY_AUTHORITY_P0F.md).

### Important boundary

Initial enrollment is trust-on-first-use for the local prototype. It preserves pre-P0-f participant continuity but is not sufficient for anonymous public internet enrollment.

### Next rung

P0-g should harden real internet calling: TURN relay, ICE/connectivity diagnostics, peer/network failure cleanup, and secure deployment defaults. Identity and room authority no longer need to be redesigned just to make that call traverse ugly NATs.


## P0-g — real internet media hardening

P0-g hardens the one-to-one human WebRTC path without changing room authority.

```text
authenticated room session
        ↓
authenticated ICE config
        ↓
direct ICE path when possible
        ↓
TURN relay when required
        ↓
local runtime diagnostics
```

### Implemented in this rung

- server-delivered authenticated ICE configuration
- STUN URL configuration
- TURN URL configuration
- coturn REST-style ephemeral TURN credentials
- static TURN credentials as an explicit demo fallback
- automatic refresh before ephemeral TURN credentials expire
- optional relay-only ICE policy for TURN verification
- HTTPS/WSS deployment guardrails
- call setup timeout
- unanswered-call timeout
- disconnect grace cleanup
- ICE/peer failure cleanup
- local microphone-ended cleanup
- selected candidate-pair diagnostics
- direct versus relay route classification
- RTT, jitter, packet-loss and byte counters
- ICE error visibility
- local diagnostics remain outside durable room history
- P0-f -> P0-g storage/wire metadata migration

See [MEDIA_P0G.md](MEDIA_P0G.md).

### Next rung

After P0-g, the first one-to-one call has enough networking structure to justify choosing between multi-party media/SFU work and the separate Voice Kit / governed agent-speech track.


## P0-h — ephemeral media session identity + perfect negotiation

P0-h makes each one-to-one call an exact ephemeral object.

```text
rtc_call_open
      ↓
server media-session arbitration
      ↓
callId + generation
      ↓
perfect negotiation
      ↓
offer / answer / ICE bound to exact call
```

### Implemented in this rung

- server-issued ephemeral call ids
- monotonic generations per participant pair
- one active call per participant
- simultaneous opens for the same pair coalesce
- deterministic polite / impolite peers
- WebRTC perfect-negotiation glare handling
- offer / answer / ICE / hangup bound to call id + generation
- stale-generation rejection
- exact-session hangup
- peer-left server cleanup
- recipient microphone still requires explicit Answer
- no media-session persistence
- P0-g -> P0-h storage/wire metadata migration

See [MEDIA_SESSION_P0H.md](MEDIA_SESSION_P0H.md).

### Next rung

P0-h gives a future SFU a clean object to route. Multi-party media can now be designed around explicit ephemeral sessions without weakening durable room semantics or human media consent.


## P0-i — three-human multiparty media boundary

P0-i adds a real three-human audio proof without prematurely locking Commonline to an SFU implementation.

The executable transport is `mesh-p0`, but its control model is already expressed as:

```text
participant
   ↓
identified source
   ↓
directed subscription
   ↓
required peer transport
```

### Implemented in this rung

- ephemeral room-level group media session
- maximum three human participants
- explicit group join / leave
- explicit microphone publication
- source identity bound to owner participant
- explicit directed subscriptions
- SPEAK required to publish
- RECEIVE_MEDIA required to subscribe
- pair signaling rejected when no subscription requires transport
- pairwise WebRTC mesh proof using existing STUN/TURN config
- perfect negotiation retained per participant pair
- sources remain independently controllable
- participant leave removes sources/subscriptions
- no agent listening
- no group media persistence
- P0-h -> P0-i storage/wire metadata migration

See [MULTIPARTY_P0I.md](MULTIPARTY_P0I.md).

### Important limitation

The server authorizes subscriptions and signaling, but `mesh-p0` cannot enforce per-track SRTP routing against a malicious modified browser. A real SFU is the next enforcement boundary.

## Next rung: P0-j

Implement an SFU adapter behind the existing participant/source/subscription model, without replacing Commonline's room identity, grants, or durable undertaking semantics with an SFU vendor's room model.

## P0-j — governed mediasoup SFU

P0-j replaces the P0-i cooperative three-browser mesh with a real mediasoup SFU while preserving the participant/source/subscription control model.

Implemented in this rung:

- real mediasoup Worker and Opus Router
- mediasoup-client browser Device
- shared WebRTC server listener
- per-participant send/receive transports
- Commonline source ID to Producer binding
- Commonline subscription to Consumer binding
- SPEAK rechecked at Producer creation
- RECEIVE_MEDIA plus explicit subscription rechecked at Consumer creation
- paused-then-resumed Consumers
- live SFU reconciliation when sources/subscriptions disappear
- P0-i peer-to-peer group signaling disabled
- one-to-one P0-h path left separate
- SFU internals remain non-durable
- explicit P0-i to P0-j metadata migration

See SFU_P0J.md for the enforcement boundary and live acceptance test.

## P0-k — governed media source policy

P0-k inserts a source-policy gate above the P0-j SFU.

```text
SPEAK grant
    +
principal kind
    +
source policy
    +
explicit source registration
    ↓
mediasoup Producer
    ↓
explicit subscriber + RECEIVE_MEDIA
    ↓
mediasoup Consumer
```

### Implemented in this rung

- typed media source catalog
- executable human-microphone source
- executable human sound-effect source
- reserved shared-music source class
- reserved agent-voice source class
- reserved system-tone source class
- source policy IDs carried into SFU production
- principal-kind checks before publishing
- per-kind source limits
- explicit-subscription audience policy
- ephemeral retention declaration
- recording default remains not-authorized
- Web Audio generated sound-effect proof routed through mediasoup
- P0-j -> P0-k storage/wire metadata migration

See [MEDIA_SOURCE_POLICY_P0K.md](MEDIA_SOURCE_POLICY_P0K.md).


## P0-l — live media acceptance harness

P0-l is an acceptance rung rather than a wire/storage change. It keeps `p0-k.1` and proves the current source/subscription/SFU contract in three independent Chromium contexts.

### Acceptance matrix

- Alice publishes human-microphone + sound-effect
- Bob subscribes microphone only
- Charlie subscribes sound-effect only
- subscribed paths must create Consumers with non-zero inbound RTP packets/bytes
- unsubscribed paths must have no Consumer
- subscriptions are then changed live and the exact Consumer set must follow

The CI run retains a JSON evidence artifact plus Playwright failure traces/screenshots/video when applicable.

See [MEDIA_ACCEPTANCE_P0L.md](MEDIA_ACCEPTANCE_P0L.md).


## P0-m — agent voice authority

P0-m makes agent speech permission explicit before any TTS renderer is activated.

Implemented:

- MANAGE_AGENT_VOICE capability
- one-time explicit bootstrap from current ACCEPT_OUTCOME authority
- durable bootstrap receipt
- voice-ID-bound agent voice grant receipt
- explicit-subscription audience binding
- optional voice grant expiry
- durable manual revocation receipt
- restart persistence
- agent voice source policy now requires AGENT_VOICE_GRANT
- Vessie voice profile `vessie-local-v1`
- renderer remains explicitly not wired
- P0-k -> P0-m schema migration

See [AGENT_VOICE_AUTHORITY_P0M.md](AGENT_VOICE_AUTHORITY_P0M.md).


## P0-n — local agent voice renderer

P0-n activates the first renderer capability behind P0-m voice authority.

Implemented:

- optional local Piper CLI renderer
- no automatic model download
- deterministic non-speech CI renderer
- agent-authored bounded authority-proof utterance
- executable `agent-voice` source policy
- trusted agent-owned group-media source
- mediasoup DirectTransport
- 8 kHz PCMU RTP injection
- content-free utterance status plane
- exact MANAGE_AGENT_VOICE request authorization
- exact active voice-grant revalidation
- explicit subscriber-only delivery
- revocation tears down source, Producer, subscriptions, and Consumers
- P0-m -> P0-n wire/storage metadata migration
- three-browser live agent voice RTP acceptance

See [LOCAL_AGENT_VOICE_P0N.md](LOCAL_AGENT_VOICE_P0N.md).


## P0-o — ephemeral attention lease + agent turn-taking

P0-o separates permission to use Vessie's voice from permission to take one conversational turn.

Implemented:

- memory-only one-turn AttentionLease
- 120-second default TTL
- lease ownership bound to granting human
- one active lease per human/agent pair
- exact once-only consumption
- explicit human revocation
- automatic expiry
- lease cleanup on live-media leave/session loss
- bounded directed prompt
- agent-authored bounded response
- content-free thinking/rendering/speaking/completed/failed status
- voice-grant revalidation
- existing subscriber-only RTP delivery
- no STT or ambient listening
- no durable prompts/replies
- P0-n -> P0-o wire/storage metadata migration
- live three-browser lease/RTP acceptance

See [ATTENTION_LEASE_P0O.md](ATTENTION_LEASE_P0O.md).


## P0-p — governed push-to-share listening

Implemented:

- one-use human-owned listening-share lease
- 60-second default lease TTL
- five-second maximum captured clip
- explicit browser microphone capture
- Web Audio PCM collection
- browser resampling to 16 kHz PCM16
- optional local whisper.cpp recognizer
- no automatic STT model download
- deterministic CI recognizer
- target-agent `READ_SELECTED_CONTEXT` check
- content-free room-wide listening status
- transcript returned only to sharing human
- no agent SFU microphone Consumer
- no ambient listening
- no durable audio or transcript
- P0-o -> P0-p wire/storage metadata migration
- three-browser privacy acceptance

See [GOVERNED_LISTENING_P0P.md](GOVERNED_LISTENING_P0P.md).


## P0-q — explicit hear-to-reply exchange binding

Implemented:

- ephemeral ConversationExchange
- private short-lived transcript binding
- public exchange view without transcript content
- heard/responded/expired states
- 120-second default exchange TTL
- newer heard exchange supersedes older unheard reply opportunity
- no automatic reply after listening
- exact human ownership check
- exact target-agent check
- exact attention lease binding
- active voice-grant revalidation
- agent-authored reply from exact heard transcript
- successful RTP required before exchange becomes responded
- failed response releases exchange but does not restore attention
- transcript/reply remain non-durable
- P0-p -> P0-q wire/storage metadata migration
- three-browser no-RTP-before-attention acceptance

See [EXPLICIT_EXCHANGE_P0Q.md](EXPLICIT_EXCHANGE_P0Q.md).


## P0-r — selective resumption brief

P0-r returns to the original CommonLine P0 thesis: useful continuity without transcript-as-truth.

Implemented:

- deterministic client-side resume brief
- inputs limited to durable `RoomSnapshot` + durable `resumeDelta`
- accepted-work list by durable artifact title and identifiers
- unresolved bounded work from offered/working/proposed/failed states
- deterministic next-action selection
- exact missed durable room events retained for inspection
- accepted artifact bodies are not duplicated into the compact brief
- no audio, STT transcript, conversation-exchange transcript, spoken reply, attention lease, scratch, session, signaling, key, or recovery-secret input
- no model-generated summary
- no wire/storage migration; schema remains `p0-q.1`
- unit proof for accepted work, unresolved work, next-action priority, and durable-delta fidelity

See [RESUMPTION_P0R.md](RESUMPTION_P0R.md).

### P0-r boundary

The brief summarizes **state shape**, not conversation meaning.

It may say that a proposal is waiting for review because that is an authoritative durable status. It may not infer that participants agreed, disagreed, promised something, or reached a conclusion unless that conclusion already exists as selected durable room state.
