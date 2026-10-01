# P0-m Agent Voice Authority

Status: candidate durable agent-voice authority rung

Wire schema: `p0-m.1`  
Storage schema: `p0-m.1`

P0-m introduces durable authority for an agent to speak under a specific voice identity.

It deliberately does **not** activate a TTS renderer.

The core law is:

```text
AGENT EXISTS
    ≠
AGENT MAY SPEAK

AGENT MAY SPEAK
    ≠
A RENDERER MAY SPEAK AS THAT AGENT

VOICE GRANT
    ≠
AUDIENCE SUBSCRIPTION
```

The later renderer must prove all three layers independently.

## Why this is separate

Before P0-m, Vessie is a real Commonline agent participant but only holds:

- READ_SELECTED_CONTEXT
- WRITE_DRAFT_ARTIFACT

Vessie does not hold SPEAK.

P0-m does not silently add SPEAK to the agent and does not reinterpret the human SPEAK capability as permission to synthesize agent audio.

Instead it introduces a dedicated management capability:

```text
MANAGE_AGENT_VOICE
```

and specialized voice receipts.

## One-time authority bootstrap

Existing Commonline rooms predate agent voice management, so they do not contain a MANAGE_AGENT_VOICE holder.

P0-m uses one explicit compatibility bridge:

```text
active ACCEPT_OUTCOME holder
        ↓ explicit bootstrap intent
MANAGE_AGENT_VOICE grant
        ↓
VoiceAuthorityBootstrapReceipt
```

This is a one-time room bootstrap, not a general grant-management API.

The bootstrap requires the actor's exact active ACCEPT_OUTCOME grant and records:

- stable bootstrap ID
- actor participant ID
- ACCEPT_OUTCOME grant ID used for bootstrap
- newly issued MANAGE_AGENT_VOICE grant ID
- committed room version
- timestamp

Retrying the same bootstrap ID returns the original receipt.

A different bootstrap attempt after the room is already bootstrapped is rejected.

## Agent voice grant

After bootstrap, ACCEPT_OUTCOME alone is not enough to grant or revoke agent voice.

The actor must present the exact active MANAGE_AGENT_VOICE grant.

An agent voice grant binds:

```text
agentParticipantId
voiceId
audienceMode = explicit-subscription
issuer participant
MANAGE_AGENT_VOICE grant
issued time
optional expiry
committed room version
```

P0-m permits one active voice grant per agent at a time.

The first catalog entry is:

```text
agent   = agent-vessie
voiceId = vessie-local-v1
```

The catalog describes the renderer boundary as `local-tts-adapter`, but its renderer state remains `not-wired`.

A voice ID is identity metadata, not executable audio.

## Revocation

Revocation requires the current actor's exact active MANAGE_AGENT_VOICE grant.

The revocation is immutable and records:

- stable revoke request ID
- exact voice grant ID
- revoking participant
- authority grant ID
- reason
- committed version
- timestamp

Revocation removes active voice authority without removing Vessie from the room and without altering Vessie's silent-worker capabilities.

## Source policy integration

P0-m corrects the media-source authority vocabulary.

Human microphone and sound-effect sources require:

```text
requiredAuthority = SPEAK
```

The reserved agent voice source now declares:

```text
requiredAuthority = AGENT_VOICE_GRANT
allowedPublisherKinds = agent
executionState = reserved
```

System tones declare `SERVICE_POLICY`.

This prevents future agent voice work from pretending that generic human SPEAK is the right authority.

## Renderer firewall

The P0-m UI may show an active Vessie voice grant, but it also shows:

```text
RENDERER NOT WIRED
LIVE AGENT AUDIO ✕
```

That is intentional.

A future renderer must verify:

1. current room generation/context
2. active agent voice grant
3. matching agent participant ID
4. matching voice ID
5. current agent-voice source policy
6. explicit recipient subscriptions downstream

before any `agent-voice` Producer becomes executable.

P0-m therefore proves **authority before capability**.

## Persistence

P0-m makes authority durable, not audio.

Durable SQLite tables:

- voice_authority_bootstraps
- agent_voice_grants
- agent_voice_revocations

Still not durable:

- synthesized audio
- TTS model state
- PCM/WAV buffers
- agent voice media sources
- SFU Producers/Consumers
- RTP packets

A restart preserves permission provenance but ends all live media.

## Migration

P0-k databases migrate explicitly to p0-m.1.

Migration creates the new receipt tables but does not automatically grant MANAGE_AGENT_VOICE to anyone.

That authority appears only after the explicit bootstrap action.

## Proof suite

P0-m tests prove:

1. Vessie has no voice authority by default
2. bootstrap requires the exact active ACCEPT_OUTCOME grant
3. bootstrap creates a separate MANAGE_AGENT_VOICE grant
4. bootstrap is idempotent by stable ID
5. issuing voice requires MANAGE_AGENT_VOICE
6. voice grant binds agent ID + voice ID + explicit-subscription audience
7. one active voice grant exists per agent
8. revocation removes active voice without removing the agent
9. voice profile is bound to Vessie
10. renderer remains explicitly not wired
11. bootstrap/grant/revocation survive SQLite restart
12. P0-k metadata migrates to P0-m

## Next rung

P0-n can implement the local voice renderer.

Its job will be narrow:

```text
text
  ↓
local TTS adapter
  ↓
voiceId match
  ↓
active AgentVoiceGrantReceipt
  ↓
agent-voice source
  ↓
mediasoup Producer
  ↓
explicit subscriptions
```

Piper or another local engine can live behind the adapter without becoming the authority source.
