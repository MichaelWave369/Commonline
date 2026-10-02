# P0-v — Governance closure matrix

Status: **candidate P0 governance closure rung**

P0-v turns the roadmap's four negative-control claims into one executable matrix:

```text
UNGRANTED SPEAKING
UNGRANTED HISTORY
UNGRANTED DELEGATION
UNGRANTED EXTERNAL EFFECTS
        ↓
      BLOCKED
```

The rung does not add real multi-agent collaboration or real external integrations.

It adds only enough bounded proof surfaces to verify that authority boundaries fail closed.

## 1. Speaking

A first-time observer receives only room-state read authority.

The observer holds neither:

- `SPEAK`
- `RECEIVE_MEDIA`

Therefore governed group-media admission is unavailable.

P0-v's browser acceptance flow verifies that the observer cannot enter the group-media path.

Existing server media policy continues to require explicit media authority before publishing or receiving sources.

## 2. History

The same observer joins only after durable room activity already exists.

P0-s remains authoritative:

- current room state may be visible under `READ_ROOM_STATE`
- pre-membership durable event replay is not inherited
- `resumeDelta` is empty on first membership

The P0-v browser receipt records zero missed durable events for that late observer.

## 3. Context delegation

P0-v adds one bounded delegation probe:

```text
accepted-artifact-summary
  ->
local-delegation-proof-sink
```

The proof sink is process-local. It does not contact another agent, network service, model provider, person, room, or external system.

The request binds:

- room id
- current authoritative room version
- accepted artifact id
- stable delegation request id
- fixed target
- fixed purpose
- exact authority grant id

The executor runs only with an active `DELEGATE_CONTEXT` grant belonging to the requester.

P0 issues **no `DELEGATE_CONTEXT` grants**.

Normal P0-v behavior is therefore:

```text
context_delegation_status = blocked
error = NOT_AUTHORIZED
```

Unit tests fabricate one delegation grant only to prove that the executor cannot be reached with the wrong grant and can be reached with the exact test grant.

There is no product path for issuing delegation authority.

## 4. External effects

P0-u remains unchanged:

- accepted work is not execution authority
- P0 issues no `EXECUTE_EXTERNAL_EFFECT` grants
- the only effect target is the harmless local proof sink
- unauthorized effect requests are blocked before the executor runs

P0-v includes that existing negative control in the same browser governance run.

## Machine-readable receipt

CI writes:

```text
test-results/p0v-governance-closure.json
```

The receipt records the four probes:

- speaking
- history
- delegation
- external effects

It is uploaded by the existing `p0-governance-probes` CI job, now labeled as the P0-v governance closure matrix.

## Wire and storage

P0-v adds a context-delegation request and status message, so the wire advances to:

```text
p0-v.1
```

The physical SQLite layout remains:

```text
p0-q.1
```

Existing P0-u wire metadata on the P0-q storage layout migrates in place to P0-v.

## What P0-v does not claim

P0-v does not prove the human-value portion of P0.

It does not establish:

- that participants find the agent result useful
- that they use it in real work
- that resumption requires less reconstruction than voice + notes
- that CommonLine should advance to P1

Those remain pilot questions.

P0-v closes the **technical governance** half of the P0 exit criteria.
