# P0-f Identity + Authority Handoff

Status: **candidate authenticated local identity rung**

Wire schema: `p0-f.1`  
Storage schema: `p0-f.1`

P0-f answers the next question created by durable rooms:

> The room remembers. How does it know who came back?

The answer is deliberately split in two:

```text
IDENTITY PROOF
proves who controls a participant identity

        ≠

AUTHORITY GRANT
proves what that participant may do
```

## Local cryptographic identity

Each browser participant has a P-256 ECDSA key pair.

The private key is stored in browser IndexedDB and is re-imported as non-exportable before storage.

The server persists:

- participant id
- public key
- recovery-code hash
- enrollment time
- optional key-rotation time

The server does **not** persist the private key or the raw recovery code.

## Challenge-response

Before a WebSocket session may join a room as a participant:

```text
client -> identity_begin
server -> random challenge
client -> ECDSA signature
server -> verify public key
server -> identity_authenticated
client -> join_room
```

The signed payload binds:

- protocol domain
- challenge id
- participant id
- session id
- random nonce

Challenges expire and are single-use.

## Enrollment model: TOFU

P0-f uses **trust on first use** for initial enrollment.

If a participant id has no identity claim yet, the first client that proves possession of the public key it supplied enrolls that participant identity and receives a one-time recovery code.

This preserves continuity for pre-P0-f local participant ids after the P0-e -> P0-f migration, but it is **not a public-internet account-registration model**.

Before exposing Commonline publicly, first enrollment needs an invitation/bootstrap policy or another authenticated enrollment boundary.

## Recovery

Initial enrollment returns a high-entropy recovery code once.

The server stores only:

```text
SHA-256(participantId || NUL || recoveryCode)
```

Recovery:

1. verifies the recovery code in constant time
2. rotates to a new P-256 public key
3. rotates the recovery code
4. preserves the participant id

A recovered participant is the same logical participant, not a replacement room member.

Remote recovery must use localhost or WSS. A raw recovery secret must never cross an unencrypted internet WebSocket.

## Identity is not authority

Successful authentication does not grant room capabilities.

Authority still comes from room-scoped grant receipts.

```text
AUTHENTICATED
      ≠
ACCEPT_OUTCOME
      ≠
SPEAK
      ≠
EXECUTE_EXTERNAL_EFFECT
```

## ACCEPT_OUTCOME handoff

P0-f adds an explicit authority-transfer transition.

The current `ACCEPT_OUTCOME` holder may transfer that capability to another non-observer human participant.

The transition atomically creates:

- immutable grant-revocation receipt for the old grant
- new `ACCEPT_OUTCOME` grant receipt
- authority-transfer receipt
- descriptive steward-role handoff
- one durable room event
- one room-version increment

The role label follows the authority for UI clarity, but the role itself is not authorization.

## Idempotent transfer

The client supplies a stable `transferId`.

If SQLite commits the transfer but the reply is lost, retrying the same `transferId` returns the original authority-transfer receipt.

No second grant or revocation is created.

## Storage migration

Opening a P0-e database with:

```text
storage = p0-e.1
wire    = p0-d.1
```

runs an explicit local migration to:

```text
storage = p0-f.1
wire    = p0-f.1
```

The migration creates identity, grant-revocation, and authority-transfer tables and marks existing room rows with the new wire version.

No legacy participant is silently considered authenticated. Identity enrollment still occurs when that participant next connects.

## Still not solved

P0-f is not a production identity platform. It does not yet provide:

- email/phone/account recovery
- invitations
- organization identity
- hardware-backed passkeys
- multi-device key policy
- public enrollment protection beyond TOFU
- admin override
- general-purpose capability delegation UI
- acceptance supersession/retraction

Those remain separate rungs rather than excuses to turn identity into an enterprise swamp before two people can finish a call.
