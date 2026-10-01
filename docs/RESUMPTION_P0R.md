# P0-r — Selective Resumption Brief

Status: **candidate implementation**

P0-r closes CommonLine's first continuity loop.

The prototype already persists room state, accepted outcomes, authority receipts, and durable room events. It also deliberately keeps media, listening transcripts, generated replies, scratch, attention leases, signaling, and session state ephemeral.

P0-r asks a narrower question:

> Can a returning participant understand what was accepted, what remains unresolved, and what to do next without replaying or summarizing the conversation?

## Core law

```text
DURABLE ROOM STATE != TRANSCRIPT

RESUMPTION != CONVERSATION RECONSTRUCTION

SELECTED OUTCOMES + OPEN WORK + DURABLE DELTA
                     ↓
              RESUME BRIEF
```

The brief is deterministic. No model is invoked to infer what participants "really meant."

## Inputs

The P0-r brief receives only:

- `RoomSnapshot`
- durable `RoomEvent[]` resume delta

Those inputs may contain:

- accepted artifact identifiers and titles
- bounded work prompts and statuses
- durable acceptance receipts
- durable room-event summaries

They do not contain:

- microphone audio
- WebRTC/SFU media
- listening-share PCM
- STT transcript content
- conversation-exchange transcript content
- generated spoken replies
- attention leases
- agent scratch
- authentication challenges
- private keys or recovery secrets
- ephemeral sessions or signaling

Because the derivation function never receives those objects, P0-r cannot accidentally summarize them into durable continuity.

## Output

The client derives:

### Accepted work

Accepted artifacts are listed by durable title and identifiers.

Artifact bodies remain in the authoritative room state and are not copied into the compact brief. The participant can inspect the actual accepted artifact separately.

### Unresolved work

Work remains unresolved when its durable status is:

- `offered`
- `working`
- `proposed`
- `failed`

Accepted and canceled work do not appear in the unresolved set.

### Next action

The next action is deterministic and status-driven:

1. review a pending proposal
2. revisit failed work
3. continue or inspect active/offered work
4. otherwise submit the next concrete bounded work item

The brief does not invent semantic priorities from conversation content.

### Missed durable events

The existing server-provided `resumeDelta` remains visible as the exact durable changes missed since the participant's last acknowledged room version.

## Wire and storage

P0-r intentionally introduces **no wire or storage migration**.

The wire remains:

```text
p0-q.1
```

This is an acceptance and experience rung over already-frozen durable state.

## Acceptance claims

P0-r is successful when:

- accepted work is visible after resumption
- unresolved work is visible after resumption
- one deterministic next action is visible
- missed durable events remain inspectable
- private/ephemeral conversation material is not an input to the brief
- no model-generated summary is required for continuity

## Why this matters

CommonLine's original P0 thesis is not merely "AI can join a call."

It is:

> A persistent governed room should let people do useful work during a conversation and later resume the undertaking with less reconstruction than a disposable call plus notes.

P0-r finally exposes that thesis directly in the executable UI.
