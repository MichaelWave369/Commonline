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
