# P0-p Governed Push-to-Share Listening

Status: candidate bounded listening rung

Wire schema: `p0-p.1`  
Storage schema metadata: `p0-p.1`

P0-p gives Commonline its first machine-listening path without granting Vessie ambient microphone access.

The governing law is:

```text
AGENT PARTICIPANT
      ≠
AGENT MAY LISTEN
```

and:

```text
ONE BOUNDED LISTENING SHARE
      ≠
LIVE MICROPHONE SUBSCRIPTION
```

## Scope

P0-p intentionally does not add:

- ambient listening
- continuous microphone access
- wake words
- agent SFU microphone Consumers
- durable audio recording
- durable transcript history
- automatic conversational response
- cloud speech recognition
- background transcription

The only listening path is a human-initiated, one-use push-to-share clip.

## ListeningShareLease

A human in live group media may grant one ephemeral listening-share lease to a target agent that already holds `READ_SELECTED_CONTEXT`.

The lease records:

```text
leaseId
roomId
humanParticipantId
agentParticipantId
state
issuedAt
expiresAt
maxDurationMs = 5000
```

States:

- active
- consumed
- revoked
- expired

The default lease lifetime is 60 seconds.

A lease belongs to the human who created it. Another participant cannot spend or revoke it.

Granting a new lease for the same human/agent pair revokes the older active lease.

## Capture boundary

The browser requests microphone access only after the human presses the explicit start control for an active listening lease.

The capture path:

```text
explicit human click
      ↓
temporary getUserMedia stream
      ↓
Web Audio PCM capture
      ↓
mono Float32 samples
      ↓
resample to 16 kHz
      ↓
PCM16
      ↓
base64 transport
      ↓
one submit_listening_share intent
```

The maximum accepted clip is 80,000 samples at 16 kHz, which is five seconds.

The microphone stream, AudioContext, and local sample buffers are closed after submission or cancellation.

## Listening is not SFU subscription

P0-p does not subscribe Vessie to the human microphone source.

The bounded clip is delivered through a separate selected-context path:

```text
human microphone clip
      ↓
one-use listening lease
      ↓
local STT
      ↓
ephemeral transcript
      ↓
Vessie selected context
```

Vessie therefore remains absent from the human group-media participant list and has no microphone Consumer.

## Local speech recognition

The default recognizer is disabled.

### disabled

```text
COMMONLINE_STT_ENGINE=disabled
```

No listening lease is granted when no local recognizer is ready.

### whisper.cpp

```text
COMMONLINE_STT_ENGINE=whispercpp
COMMONLINE_WHISPER_COMMAND=whisper-cli
COMMONLINE_WHISPER_MODEL=/absolute/path/to/model.bin
COMMONLINE_WHISPER_LANGUAGE=auto
COMMONLINE_WHISPER_TIMEOUT_MS=30000
```

Commonline requires an existing local model. It does not download a model.

For each bounded clip Commonline writes a temporary 16-bit mono WAV, invokes the local whisper.cpp CLI, reads the temporary text result, and deletes the temporary directory.

### deterministic

```text
COMMONLINE_STT_ENGINE=deterministic
```

This CI/development recognizer does not claim speech-recognition quality. It returns a deterministic statement containing the accepted sample count so the governance and transport path can be tested without downloading a model.

## Runtime validation

Before a bounded clip is accepted, the server validates:

1. authenticated human session
2. human remains in live group media
3. target participant is an agent
4. target has `READ_SELECTED_CONTEXT`
5. local recognizer is ready
6. audio is 16 kHz PCM16
7. sample count is between 1,600 and 80,000
8. encoded byte length exactly matches the declared sample count
9. no share is already processing for that human/agent pair
10. exact listening lease belongs to the submitting human
11. exact lease matches room and target agent
12. lease is active and unexpired

The lease is then consumed before transcription begins.

If STT fails after processing starts, the lease remains consumed because the audio has already entered the listening pipeline.

## Agent delivery

After local STT returns a bounded transcript, Commonline passes it to the agent runtime through the selected-context seam.

The current mock agent observes the transcript and returns only content-length metadata internally.

It does not persist the transcript.

## Transparency plane

Commonline broadcasts content-free listening status to room participants:

- received
- transcribing
- delivered
- failed

Status includes:

- share ID
- lease ID
- human participant ID
- target agent ID
- state
- error code on failure

It does not include audio or transcript text.

This lets other room participants see that a bounded listening event occurred without receiving the private transcript.

## Transcript result

The transcript result is sent only to the human who submitted the clip.

It includes:

- share ID
- lease ID
- target agent ID
- transcript
- recognizer engine
- sample count
- duration

Other participants do not receive this result message.

## Disconnect behavior

Listening-share leases are non-resumable.

They are removed when the granting human:

- leaves group media
- loses the current authenticated room session

The browser also clears local lease/result state on disconnect or media leave.

## Persistence boundary

P0-p introduces no durable listening tables.

There are no SQLite tables for:

- listening-share leases
- microphone clips
- listening transcripts
- STT temporary files
- listening status
- agent selected-context audio

The wire/storage metadata advances to `p0-p.1` because the protocol gains bounded listening messages.

## Acceptance proof

The three-browser acceptance harness now proves:

1. Alice is in live group media
2. Alice explicitly grants Vessie one listening-share lease
3. Alice starts a short microphone capture
4. Alice stops and submits the bounded PCM clip
5. deterministic local STT accepts a real captured sample buffer
6. the lease becomes consumed
7. Alice receives the ephemeral transcript result
8. Bob receives no transcript result
9. Charlie receives no transcript result
10. Bob and Charlie both observe content-free `delivered` status
11. Alice cannot capture again under the consumed lease
12. a new explicit listening lease would be required

Existing voice, attention, source-subscription, RTP, and revocation proofs continue to run in the same suite.

## Governance laws after P0-p

```text
CAN WORK ≠ CAN SPEAK

CAN SPEAK ≠ MAY TAKE THE FLOOR

AGENT PARTICIPANT ≠ AGENT MAY LISTEN

LISTEN ONCE ≠ AMBIENT MICROPHONE ACCESS

LISTENING SHARE ≠ SFU SUBSCRIPTION

STATUS ≠ CONTENT

OBSERVABLE ≠ DURABLE
```

## Next rung

P0-q can connect bounded listening and one-turn attention into an explicit conversational exchange.

A useful next constraint is:

```text
HEARD A SHARED CLIP
      ≠
AUTOMATICALLY MAY RESPOND
```

A response should still require a separate attention lease.
