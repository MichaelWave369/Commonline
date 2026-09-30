# P0-d Wire Freeze

Status: **candidate frozen wire for the pre-persistence prototype**

Wire schema: `p0-d.1`

## Governing laws

```text
CAPABILITY ≠ AUTHORITY
PRESENCE ≠ MEDIA CONSENT
SCRATCH ≠ PROPOSAL
PROPOSAL ≠ ACCEPTANCE
ACCEPTANCE ≠ EXECUTION
STATUS ≠ CONTENT
OBSERVABLE ≠ DURABLE
```

## Identity

A participant is a logical room principal. A session is an ephemeral browser/runtime attachment to that participant.

```text
Participant
  └── current Session
        └── WebSocket connection
```

Reconnect replaces the connection/session binding without creating another logical participant or fake leave/join churn.

P0 identities are still locally generated and unauthenticated. Stable does not mean verified.

## Participant kinds and P0 roles

| Kind | Role | P0 behavior |
|---|---|---|
| human | steward | normal participant plus the single active `ACCEPT_OUTCOME` grant |
| human | participant | may submit work and use explicitly granted human media |
| human | observer | read-only room stub; no submit, speak, receive-media, or accept grant |
| agent | silent-worker | selected text context + draft proposal capability only |

Roles are descriptive. Authority comes from grant receipts.

## Grant receipt

An active capability is represented by a grant receipt containing:

- grant id
- room id
- subject participant id
- capability
- issuer id
- issue time
- optional expiry
- optional revocation

Acceptance records the exact `ACCEPT_OUTCOME` grant used.

## Work lifecycle

```text
work item
  ↓
scratch
  ↓
proposal
  ↓
acceptance receipt
```

### Scratch

Scratch is explicit **application-level** temporary working material such as candidate drafts, temporary calculations, or transient tool outputs.

It is not model chain-of-thought.

Scratch is held in a separate ephemeral work plane, uses TTL/explicit cleanup, and is excluded from every durable room representation.

Humans may see content-free status such as `working` or `failed`. Status does not expose scratch content.

### Proposal

A proposal is visible room material tied to a work-item id. It is not canonical merely because an agent produced it.

### Acceptance

The acceptance intent contains:

- client-stable `acceptId`
- room id
- base room version
- work-item id
- artifact id
- authority grant id

The server checks that the grant belongs to the accepting participant and authorizes `ACCEPT_OUTCOME`.

The first valid acceptance for a work item wins in P0. A second competing acceptance is rejected with the canonical acceptance receipt.

Retrying the same `acceptId` returns the original receipt without another event or room-version increment.

## Session coalescing

The server keeps at most one current live transport binding per `roomId + participantId`.

A newer connection supersedes the older one before the old connection's close handler can mark the participant offline.

The browser reconnect policy uses exponential backoff plus jitter. A server `session superseded` close disables automatic reconnect for the replaced tab so two tabs do not fight forever like tiny distributed-systems goblins.

## Ephemeral surfaces

The following are explicitly non-durable in P0-d:

- scratch content
- agent work status pulses
- WebRTC offer/answer/ICE/hangup signaling
- audio frames
- browser sessions
- WebSocket connections

## Works today / does not

| Area | Works today | Does not yet |
|---|---|---|
| identity | stable local participant id separate from tab session | authenticated identity, account recovery, attestation |
| reconnect | backoff + jitter, one current connection per participant | multi-device policy, handoff UI |
| roles | steward, participant, observer, silent-worker | role transfer/admin UI |
| authority | grant receipts, one steward accept grant | general grant delegation/revocation UX |
| work | work ids, proposals, status plane | multiple concurrent agent workers |
| scratch | private ephemeral app scratch + leak test | durable/private scratch by design |
| acceptance | work-bound, grant-bound, idempotent, single-writer | supersede/retract accepted outcome |
| audio | one-to-one human WebRTC | TURN hardening, group media, agent audio |
| persistence | none intentionally | SQLite/file store |
| telephony | none | SIP/PSTN |

## Vocabulary mapping

For P0:

| Concept language | Code/runtime |
|---|---|
| Undertaking | Room |
| Episode | live human presence/session interval |
| Work item | `WorkItem` |
| Proposal | `Artifact(status=proposed)` |
| Accepted outcome | `AcceptanceReceipt` + accepted artifact/work state |

The mapping is intentionally thin. P0 does not create an additional Undertaking service merely to make nouns feel employed.
