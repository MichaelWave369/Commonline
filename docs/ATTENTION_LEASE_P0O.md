# P0-o Ephemeral Attention Leases and Agent Turn-Taking

Status: candidate governed conversational-turn rung

Wire schema: `p0-o.1`  
Storage schema metadata: `p0-o.1`

P0-o adds an ephemeral attention plane above P0-n agent voice capability.

The core separation is:

```text
AGENT MAY SPEAK
      ≠
AGENT MAY TAKE THE FLOOR
```

P0-m established durable voice authority. P0-n established local renderer capability. P0-o establishes when a human explicitly permits one conversational agent turn.

## Scope

P0-o intentionally does not add:

- speech recognition
- agent microphone ingestion
- ambient listening
- wake words
- interruption detection
- autonomous floor-taking
- persistent conversation transcripts
- durable prompt storage
- open-ended multi-turn leases

The first lease mode is deliberately narrow:

```text
mode = one-turn
maxTurns = 1
default TTL = 120 seconds
maximum TTL = 300 seconds
```

## AttentionLease

An attention lease contains:

```text
leaseId
roomId
agentParticipantId
grantedByParticipantId
mode
state
issuedAt
expiresAt
maxTurns
turnsConsumed
```

States:

- active
- consumed
- revoked
- expired

The lease is owned by the human who granted it.

Another participant cannot spend or revoke that lease.

## Grant conditions

A human may grant Vessie one turn only while:

1. the human has an authenticated room session
2. the human is currently attached to the live group-media session
3. the target is a real agent participant
4. the target has an active durable agent voice grant

The attention lease does not create voice authority.

If the voice grant does not exist, the lease is refused.

## Consumption

A directed turn request binds:

```text
turnRequestId
attentionLeaseId
agentParticipantId
prompt
```

The prompt is limited to 240 characters.

The voice runtime validates, in order:

1. room exists
2. requester is a human room participant
3. requester is still in live group media
4. target has an active voice grant
5. local renderer is available
6. prompt is valid
7. agent is not already busy in the room
8. attention lease belongs to this requester
9. attention lease matches this room and agent
10. attention lease is active and unexpired

Only then is the lease consumed.

A consumed lease can never be used for a second turn.

## Agent-authored response

P0-o does not let a human submit arbitrary speech text to be spoken verbatim as Vessie.

The human supplies a directed prompt.

The agent runtime composes a bounded response. The current mock runtime reports that it received the directed request and that exactly one attention lease was consumed.

This is intentionally modest. The rung proves turn authority and media behavior, not general conversational intelligence.

## Voice path

After lease consumption:

```text
directed human prompt
        ↓
agent composes one response
        ↓
local renderer
        ↓
PCM / PCMU RTP
        ↓
agent-voice Producer
        ↓
existing explicit subscriptions
        ↓
authorized listeners only
```

The durable voice grant and ephemeral attention lease are both necessary.

Downstream listener subscriptions remain independently necessary.

## Status plane

P0-o broadcasts content-free ephemeral turn status:

- thinking
- rendering
- speaking
- completed
- failed

The status includes:

- turn request ID
- attention lease ID
- agent participant ID
- voice ID
- source ID when available
- error code on failure

It does not contain the prompt or generated response.

## Lease lifecycle

### Successful use

```text
active
  ↓ request accepted
consumed
```

### Human revocation

```text
active
  ↓ grant owner revokes
revoked
```

### Timeout

```text
active
  ↓ TTL elapses
expired
```

### Regrant

Granting another lease for the same human/agent pair revokes any older active lease and issues a new lease ID.

This avoids multiple simultaneously spendable turns.

## Disconnect and media leave

Attention leases are tied to live human attention.

When the granting human leaves group media or loses the current room session, Commonline removes that participant's attention leases.

They are not resumed after reconnect.

## Persistence boundary

P0-o attention state is intentionally non-durable.

There are no SQLite tables for:

- attention leases
- directed prompts
- agent turn replies
- turn status
- rendered audio

The wire/storage metadata advances to p0-o.1 because the protocol gained attention and directed-turn messages, but the underlying lease state remains memory-only.

Durable P0-m voice authority remains unchanged.

## Acceptance proof

The P0-o browser acceptance run extends the existing Alice/Bob/Charlie test.

After Vessie voice authority and subscription are established:

1. Alice grants Vessie one attention lease
2. Commonline reports the lease active
3. Alice submits one directed prompt
4. Vessie renders one response
5. Bob, who subscribes to Vessie's source, receives additional RTP
6. Charlie, who does not subscribe, still has no Consumer
7. Alice's lease becomes consumed
8. the UI exposes no second-turn control for that consumed lease
9. Alice grants a new lease
10. the new lease ID differs from the first
11. a second directed turn succeeds
12. Bob receives additional RTP again

The unit suite separately proves a consumed lease rejects a second spend and that another human cannot spend or revoke somebody else's lease.

## Governance laws after P0-o

```text
CAN WORK ≠ CAN SPEAK

CAN SPEAK ≠ MAY TAKE THE FLOOR

VOICE GRANT ≠ ATTENTION LEASE

ATTENTION LEASE ≠ AUDIENCE SUBSCRIPTION

ONE-TURN LEASE ≠ CONTINUOUS PRESENCE

STATUS ≠ CONTENT
```

## Next rung

P0-p can introduce governed listening without collapsing these boundaries.

A reasonable next scope would be explicit push-to-share speech transcription, where a human deliberately sends a bounded audio segment to the agent rather than granting ambient microphone access.

That should preserve:

```text
AGENT PARTICIPANT
      ≠
AGENT MAY LISTEN
```
