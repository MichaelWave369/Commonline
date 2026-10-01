# P0-q Explicit Hear-to-Reply Binding

Status: candidate governed conversational exchange rung

Wire schema: `p0-q.1`  
Storage schema metadata: `p0-q.1`

P0-q connects bounded listening and bounded speaking without treating one as authority for the other.

The governing law is:

```text
HEARD SHARED CONTEXT
      ≠
MAY RESPOND
```

A delivered P0-p listening share creates one ephemeral conversation exchange. That exchange may produce at most one spoken reply, and only after the same human explicitly grants a separate one-turn attention lease.

## Exchange object

A public exchange view contains:

```text
exchangeId
roomId
humanParticipantId
agentParticipantId
listeningShareId
state
createdAt
expiresAt
```

States:

- heard
- responded
- expired

The transcript is not part of the public exchange view.

The server keeps the transcript only in the private in-memory exchange record for the short lifetime of the exchange.

## Creation

After a listening share is:

1. validated
2. transcribed locally
3. delivered to the target agent as selected context

Commonline creates:

```text
state = heard
default TTL = 120 seconds
maximum TTL = 300 seconds
```

Creating a newer heard exchange for the same human/agent pair expires the older unheard reply opportunity.

This keeps the reply target unambiguous.

## No automatic response

Creating an exchange performs no TTS and injects no RTP.

The system stops at:

```text
bounded audio
   ↓
local STT
   ↓
agent selected context
   ↓
HEARD
```

That state alone is intentionally inert.

## Reply request

A reply request binds:

```text
exchangeId
attentionLeaseId
agentParticipantId
```

The request does not include new reply text.

The agent composes its own reply from the private transcript associated with the exact exchange.

## Reply preconditions

Before speech can begin, Commonline verifies:

1. room exists
2. requester is the human who owns the exchange
3. requester remains in live group media
4. target agent matches the exchange
5. target has an active durable voice grant
6. local renderer is available
7. no other agent utterance is already active
8. exchange exists and is still heard
9. exchange has not expired
10. exchange is not already being answered
11. exact attention lease belongs to the same human
12. attention lease matches the target agent
13. attention lease is active and unused

Only after the exchange is claimed does Commonline consume the attention lease.

If the attention lease fails validation, the exchange claim is released.

## Response path

```text
heard exchange
      +
fresh attention lease
      +
active voice grant
      +
renderer capability
      ↓
agent composes reply from exact transcript
      ↓
local TTS
      ↓
agent-voice Producer
      ↓
existing explicit listener subscriptions
      ↓
RTP
```

The exchange becomes `responded` only after successful RTP injection.

A responded exchange cannot authorize another reply.

## Failed response attempts

If rendering or RTP injection fails after attention was consumed:

- the attention lease remains consumed
- the exchange returns to `heard`
- a retry requires a newly granted attention lease

This avoids silently restoring floor authority after an attempted turn while still allowing the human to retry the same heard context.

## Transparency

P0-q emits content-free `exchange_response_status` messages:

- thinking
- rendering
- speaking
- completed
- failed

Status includes identifiers, voice/source metadata, and public exchange state.

It does not include the transcript or generated reply text.

## Disconnect behavior

Conversation exchanges are non-resumable.

They are removed when the owning human:

- leaves group media
- loses the current authenticated room session

An older superseded browser connection cannot remove the current session's exchange because cleanup occurs only after the server confirms the closing socket was current.

## Persistence boundary

P0-q creates no SQLite tables for:

- conversation exchanges
- exchange transcripts
- exchange response status
- generated reply text
- rendered exchange audio

The wire/storage metadata advances to `p0-q.1` because the protocol gains exchange binding and response messages.

## Acceptance proof

The browser acceptance harness proves:

1. Alice shares one bounded microphone clip
2. Vessie receives it as selected context
3. the exchange becomes `heard`
4. Bob's existing Vessie Consumer receives no new RTP merely because Vessie heard the clip
5. Alice cannot authorize the exchange reply before a new attention lease exists
6. Alice explicitly grants a fresh one-turn attention lease
7. Alice explicitly authorizes a reply to the exact exchange ID
8. the attention lease becomes consumed
9. Vessie injects new RTP to Bob
10. Charlie still has no Vessie Consumer
11. the exchange becomes `responded`
12. that exchange cannot authorize another reply

This is the first Commonline proof of a complete governed conversational exchange:

```text
LISTEN ONCE
      ≠
REPLY

LISTEN ONCE
      +
ATTENTION ONCE
      +
VOICE AUTHORITY
      +
AUDIENCE SUBSCRIPTION
      =
ONE GOVERNED SPOKEN RESPONSE
```

## Next rung

P0-r can introduce floor arbitration and interruption semantics between humans and agents.

A useful next law is:

```text
AUTHORIZED TO RESPOND
      ≠
AUTHORIZED TO INTERRUPT
```
