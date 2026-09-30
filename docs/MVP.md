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

## Next rung: P0-c

Add the first human-to-human WebRTC media path while keeping media timing separate from authoritative room state.

The target vertical slice becomes:

```text
Browser A ──voice──┐
                   ├── Commonline episode
Browser B ──voice──┘
          │
          └── synchronized governed room state
```

Signaling may travel through the room service, but audio frames must not enter the durable room event log.
