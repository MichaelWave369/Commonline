# P0-n Local Agent Voice Renderer

Status: candidate local voice capability rung

Wire schema: `p0-n.1`  
Storage schema metadata: `p0-n.1`

P0-n activates the first real renderer capability behind the durable P0-m agent-voice authority firewall.

The governing law remains:

```text
TTS OUTPUT
   ≠
VOICE AUTHORITY
```

A renderer may turn agent-authored text into audio. It cannot create its own voice grant, choose a different agent identity, bypass the source policy, or force listeners to subscribe.

## Runtime chain

```text
active AgentVoiceGrantReceipt
        +
matching agentParticipantId
        +
matching voiceId
        +
MANAGE_AGENT_VOICE request authority
        +
active group media session
        +
available local renderer
        ↓
agent-authored bounded utterance
        ↓
local PCM audio
        ↓
8 kHz PCMU RTP packetization
        ↓
mediasoup DirectTransport Producer
        ↓
agent-voice GroupMediaSource
        ↓
explicit RECEIVE_MEDIA subscription
        ↓
mediasoup Consumer
```

## Renderer modes

P0-n provides three explicit local modes.

### disabled

Default.

```text
COMMONLINE_TTS_ENGINE=disabled
```

Voice authority may exist, but no agent-voice source is exposed and no synthesis occurs.

This is the default so installing Commonline never silently enables synthetic speech.

### piper

Local Piper CLI adapter.

Required configuration:

```text
COMMONLINE_TTS_ENGINE=piper
COMMONLINE_PIPER_COMMAND=piper
COMMONLINE_PIPER_MODEL=/absolute/path/to/local-voice.onnx
```

Optional:

```text
COMMONLINE_PIPER_SPEAKER=
COMMONLINE_PIPER_CUDA=false
COMMONLINE_PIPER_TIMEOUT_MS=30000
```

The model must already exist locally. Commonline does not download a voice model and does not persist synthesized output.

Piper writes a temporary WAV file. Commonline accepts PCM16 WAV, converts it to mono when needed, resamples to 8 kHz, encodes G.711 PCMU, and deletes the temporary renderer directory after decoding.

### tone

```text
COMMONLINE_TTS_ENGINE=tone
```

This is a deterministic non-speech CI/development renderer.

It exists only to prove the authority, source, server-side RTP injection, subscription, and revocation path without downloading a voice model in CI.

The UI and health surface label it as non-speech.

## Voice identity

The first voice remains:

```text
agent   = agent-vessie
voiceId = vessie-local-v1
```

The renderer must advertise the same voice ID as the active grant.

A configured renderer with a different voice identity cannot activate the Vessie source.

## Utterance scope

P0-n deliberately exposes one bounded utterance kind:

```text
authority-proof
```

The human voice manager does not submit arbitrary text to be spoken as Vessie.

The request authorizes the agent runtime to compose its own fixed proof statement, then asks the renderer to synthesize that agent-authored content.

This avoids turning MANAGE_AGENT_VOICE into an arbitrary impersonation endpoint.

A future rung can introduce richer agent-authored conversational speech with its own attention/turn semantics.

## Request authority

The P0-n utterance request requires:

- authenticated human session
- exact active MANAGE_AGENT_VOICE grant
- exact active AgentVoiceGrantReceipt
- matching agent ID
- matching voice ID
- current group media session
- available local renderer

The utterance request is ephemeral.

It does not increment room version and does not create a durable speech-content record.

## Agent-owned source

When all prerequisites are true, the runtime publishes one trusted source:

```text
kind     = agent-voice
owner    = agent-vessie
policy   = source-policy/agent-voice/p0-n.1
label    = Vessie voice
```

Vessie is not added to the human group-media participant list.

The source exists because an active agent voice grant meets an available renderer capability.

If either disappears, the source is removed.

## Server-side RTP injection

P0-n adds PCMU to the mediasoup Router alongside Opus.

A mediasoup DirectTransport carries the server-local agent source.

The local renderer returns PCM16 audio. Commonline:

1. decodes PCM16 WAV when using Piper
2. downmixes to mono
3. resamples to 8 kHz
4. encodes PCMU
5. packetizes 20 ms RTP frames
6. injects packets through the DirectTransport Producer

The DirectTransport Producer remains alive between utterances while the grant and source remain active, allowing listeners to subscribe before the next utterance.

RTP timestamp continuity accounts for idle gaps between utterances.

## Revocation behavior

Revocation is operational, not cosmetic.

When the active voice grant is revoked:

```text
voice grant becomes inactive
        ↓
agent-voice source removed
        ↓
source subscriptions removed
        ↓
DirectTransport Producer closes
        ↓
subscriber Consumers close
```

If revocation occurs while an utterance is being injected, the Producer closes and the injection loop stops.

The agent participant itself remains in the room.

## Status plane

P0-n broadcasts content-free ephemeral utterance status:

- queued
- rendering
- speaking
- completed
- failed

Status includes the agent ID, voice ID, utterance ID, and source ID when available.

It does not include hidden reasoning or durable speech content.

## Persistence boundary

P0-n adds no durable audio tables.

Durable P0-m authority remains:

- voice_authority_bootstraps
- agent_voice_grants
- agent_voice_revocations

Ephemeral P0-n capability state includes:

- renderer process
- temporary WAV
- PCM buffers
- PCMU frames
- RTP packets
- DirectTransport
- Producer
- Consumers
- utterance status

Storage metadata advances to p0-n.1 because the wire now includes an utterance request/status contract.

## CI proof

The live browser acceptance job uses the deterministic `tone` renderer.

It proves:

1. Alice bootstraps voice management authority
2. Alice grants `vessie-local-v1`
3. an agent-owned source appears
4. Bob subscribes to Vessie's voice
5. Charlie does not
6. Alice requests the bounded authority-proof utterance
7. Bob receives non-zero inbound RTP packet/byte evidence
8. Charlie has no agent-voice Consumer
9. Alice revokes the voice grant
10. the source and Bob's Consumer disappear

The tone renderer is not evidence of Piper speech quality. It is evidence that the same governed renderer-to-RTP path functions end-to-end.

## Next rung

P0-o can expand from the single authority-proof utterance into governed conversational turn-taking.

That work should introduce attention/turn semantics instead of letting any human continuously trigger agent speech merely because a voice grant exists.
