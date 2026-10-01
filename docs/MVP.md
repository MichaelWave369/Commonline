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
