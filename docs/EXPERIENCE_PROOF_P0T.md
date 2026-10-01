# P0-t — End-to-end experience proof

Status: **candidate acceptance rung**

P0-t does not introduce a new CommonLine authority or storage primitive.

It proves that the P0 pieces already implemented can operate as one coherent experience:

```text
two humans
   ↓
live governed media
   +
participant-owned cue
   +
bounded silent work
   ↓
room-visible proposal
   ↓
separate explicit acceptance authority
   ↓
durable accepted outcome
   ↓
everyone leaves
   ↓
stable identity reconnects
   ↓
selective resumption brief
```

## What this rung proves

The Playwright acceptance harness uses two independent browser contexts.

### 1. Live human media exists first

Alice and Bob join group media.

Alice explicitly publishes her microphone.

Bob explicitly subscribes to Alice's microphone and receives non-zero RTP evidence.

### 2. One participant-owned cue uses the governed source path

Alice explicitly publishes a `sound-effect` source.

Bob explicitly subscribes.

Alice triggers the cue and Bob receives RTP packets from that identified source.

The cue is not hidden inside the microphone stream.

### 3. Bounded agent work happens while human audio continues

Bob submits one bounded work item.

The mock silent agent processes that work and produces the existing room-visible comparison artifact.

The test records Bob's inbound Alice-microphone RTP packet count before the work starts and after the proposal arrives.

The packet count must increase while the bounded work completes.

This proves the technical concurrency claim for the current prototype:

> optional agent work does not require stopping the live human media path.

It does **not** establish human-perceived quality, usefulness, distraction, or task fit.

### 4. Submission authority is not acceptance authority

Bob may submit work.

Bob does not hold `ACCEPT_OUTCOME`.

The proposal remains `proposed` and Bob's acceptance control is disabled.

Alice holds the active acceptance authority and performs the explicit durable transition.

Only after that action does the artifact become `accepted`.

### 5. Durable outcome survives the live episode

Alice leaves.

Bob leaves afterward.

The accepted artifact remains durable room state.

### 6. Stable identity resumes without reconstructed speech

Alice reconnects with the same local participant identity.

The P0-r selective resumption brief must show:

- the accepted comparison artifact
- zero unresolved work for this scenario
- the deterministic next action for an empty work queue
- Bob's missed durable leave event

The compact accepted-work portion of the brief must not duplicate the artifact body.

No live speech or transcript reconstruction is used.

P0-s continues to restrict the durable event delta to Alice's membership history.

## Evidence artifact

CI writes:

```text
test-results/p0t-experience-proof.json
```

The receipt records:

- human participants
- microphone packet counts before and after bounded work
- participant-owned cue delivery evidence
- submit-vs-accept authority split
- accepted artifact title
- resumption result
- transcript/body non-reconstruction boundary

Playwright traces, screenshots, and video remain available on failure.

## What this rung does not prove

P0-t is **technical acceptance evidence**, not the P0 human-value pilot.

It does not establish:

- that participants find the result useful
- that participants actually use the artifact in real work
- that resumption requires less mental reconstruction than voice + notes
- that CommonLine is preferred over a shared document
- usability, accessibility, product-market fit, or production readiness

Those require human trials using the registered comparison baseline from the design study.

## Wire and storage

No wire or storage migration.

The current wire remains:

```text
p0-q.1
```

P0-t is deliberately an acceptance rung over existing P0-a through P0-s behavior.
