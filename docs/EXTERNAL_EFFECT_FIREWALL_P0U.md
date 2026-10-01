# P0-u — External-effect authority firewall

Status: **candidate governance rung**

P0-u makes one previously declarative P0 boundary executable:

> Accepting an artifact does not authorize an external effect.

The design study names this as a normative requirement. P0-u adds the smallest possible effect path so CommonLine can prove the firewall under realistic request flow without introducing a real network, payment, messaging, device, or deployment integration.

## Core law

```text
ACCEPT_OUTCOME != EXECUTE_EXTERNAL_EFFECT

accepted artifact
      +
current room version
      +
exact active EXECUTE_EXTERNAL_EFFECT grant
      ↓
external-effect executor
```

All conditions are required independently.

## Safe proof adapter

The only P0-u effect kind is:

```text
demo-marker -> local-proof-sink
```

The local proof sink:

- performs no network request
- writes no external file
- sends no message
- changes no device
- makes no payment
- deploys nothing
- records only an in-memory invocation marker

It exists so the executor boundary can be tested rather than merely described.

## Request binding

A `request_external_effect` intent is bound to:

- room id
- current authoritative room version
- stable effect request id
- exact accepted artifact id
- exact authority grant id
- fixed effect kind
- fixed local proof target

The server rejects stale room state before execution.

## Authority check

The executor runs only when the supplied grant:

- exists in the room
- belongs to the requesting participant
- has capability `EXECUTE_EXTERNAL_EFFECT`
- is not revoked
- is not expired
- matches the exact grant id supplied by the caller

An `ACCEPT_OUTCOME` grant is not accepted as a substitute.

## Accepted-artifact check

Even a valid execution grant is insufficient unless the requested artifact already has a durable acceptance receipt.

This preserves the intended ordering:

```text
proposal
  ↓
explicit acceptance
  ↓
separate execution authority
  ↓
effect
```

## P0 default

P0 issues **no `EXECUTE_EXTERNAL_EFFECT` grants**.

Therefore the normal executable proof is negative:

1. submit bounded work
2. receive proposal
3. explicitly accept artifact
4. request local proof effect
5. receive `external_effect_status = blocked`
6. receive `NOT_AUTHORIZED`
7. executor remains uninvoked

Unit tests also fabricate one execution grant in-memory to prove that the local proof sink can run only under the exact authority check. That fabricated grant is test setup, not a product grant path.

## Wire and storage

P0-u adds one client intent and one server status message, so the wire advances to:

```text
p0-u.1
```

The physical SQLite layout does not change and remains:

```text
p0-q.1
```

Existing `p0-q.1 / p0-q.1` databases receive an in-place wire-metadata migration to `p0-u.1`.

No effect receipts or effect payloads are written to durable room state in P0-u because the production path cannot become authorized yet.

## Acceptance evidence

P0-u adds:

```text
npm run test:p0-governance
```

The browser acceptance probe proves:

- artifact acceptance succeeds first
- the effect probe is then attempted
- effect state becomes `blocked`
- error code is `NOT_AUTHORIZED`
- the request is bound to `demo-marker -> local-proof-sink`

Server unit tests prove:

- acceptance alone does not invoke the executor
- wrong execution grant id does not invoke the executor
- accepted-artifact binding is mandatory
- an exact active execution grant permits only the harmless local proof sink

## What P0-u does not implement

P0-u does not create:

- a UI for issuing execution grants
- network adapters
- payment adapters
- email or messaging adapters
- deployment adapters
- device-control adapters
- arbitrary tool execution
- durable effect receipts
- retries or reconciliation of ambiguous external outcomes

Those belong to later effectful phases after P0 governance and human-value evidence are complete.
