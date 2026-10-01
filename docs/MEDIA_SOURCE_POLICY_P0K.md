# P0-k Governed Media Source Policy

Status: candidate media-source policy rung

Wire schema: p0-k.1  
Storage schema metadata: p0-k.1

P0-k inserts an explicit policy layer between Commonline room authority and the P0-j mediasoup SFU.

The important distinction is:

```text
SPEAK
  ≠
ANY AUDIO SOURCE MAY EXIST

SOURCE EXISTS
  ≠
ANYONE MAY RECEIVE IT
```

P0-k keeps the existing SPEAK grant as the authority prerequisite for human-published audio, but source policy now additionally constrains principal kind, executable status, per-publisher limits, retention, recording default, and audience mode.

This rung intentionally does not mint a new durable capability class. That avoids silently changing authority for rooms migrated from earlier schemas.

## Source catalog

P0-k defines five source kinds:

| Source kind | Publisher kind | P0-k status |
|---|---|---|
| human-microphone | human | executable |
| sound-effect | human | executable |
| shared-music | human | reserved |
| agent-voice | agent | reserved |
| system-tone | service | reserved |

All P0-k source policies declare:

- required capability: SPEAK
- audience mode: explicit-subscription
- retention: ephemeral
- recording default: not-authorized
- maximum active instances per publisher: 1

The policy catalog is included in ephemeral group-media state so the browser can display what is executable and what remains reserved.

## Microphone source

A human microphone is no longer represented by a generic `microphone` string.

It is an explicit governed source:

```text
kind     = human-microphone
owner    = authenticated human participant
policy   = source-policy/human-microphone/p0-k.1
```

Publishing still requires:

1. current group membership
2. human principal kind
3. active SPEAK grant
4. executable source policy
5. per-publisher source limit

The resulting source is then bound to a mediasoup Producer exactly as in P0-j.

## Sound-effect source

P0-k proves that Commonline can route something other than a human microphone without weakening the source model.

A human may explicitly publish:

```text
kind   = sound-effect
label  = Governed sound effects
policy = source-policy/sound-effect/p0-k.1
```

The browser creates a local Web Audio MediaStream destination and publishes that track through the same governed SFU Producer path.

A built-in demo cue is synthesized locally with Web Audio. It is not a bundled media asset and it is not persisted.

The cue reaches only participants who explicitly subscribed to the sound-effect source.

## Reserved source kinds

### shared-music

The policy exists so future music routing does not need to invent a new source model, but P0-k refuses to execute it.

No music file upload, playlist, streaming provider, or synchronization semantics are introduced in this rung.

### agent-voice

The policy is reserved for agent principals.

Humans cannot publish a source that claims to be `agent-voice`.

Vessie still has no SPEAK grant and no live media subscription, so P0-k does not introduce agent listening or speech.

### system-tone

The policy is reserved for service principals.

A human browser cannot impersonate a Commonline service tone.

## Policy before SFU

Producer creation re-checks the current source policy.

A browser cannot register one source kind and then ask the SFU to produce it under a different or stale policy ID.

The server verifies:

```text
current group generation
      +
source exists
      +
source owner = authenticated participant
      +
source.policyId = current policy.policyId
      +
policy is executable
      +
publisher principal kind allowed
      +
required SPEAK grant active
      ↓
Producer may exist
```

## Subscription boundary

Every source kind still uses explicit directed subscriptions.

```text
publisher creates source
        ≠
subscriber receives source
```

RECEIVE_MEDIA remains necessary for subscription, and mediasoup Consumer creation still requires the exact source subscription.

A sound effect therefore cannot become an accidental room-wide broadcast merely because the publisher triggered it.

## Recording and retention

`recordingDefault = not-authorized` is policy metadata, not a recording implementation.

P0-k records no audio.

All source policy state, source instances, SFU Producers, SFU Consumers, Web Audio nodes, and media packets remain ephemeral.

## Persistence boundary

P0-k advances metadata from p0-j.1 to p0-k.1 but creates no new media tables.

There are still no durable tables for:

- media source policies
- media source instances
- source subscriptions
- SFU transports
- Producers
- Consumers
- Web Audio nodes
- audio packets

## Proof suite

P0-k adds tests that prove:

1. human-microphone requires SPEAK
2. sound-effect is executable and explicit-subscription only
3. reserved source kinds remain visible but non-executable
4. agent-voice policy is restricted to agent principals
5. one source per kind is idempotent while distinct source kinds can coexist
6. policy catalog appears in group state
7. dependent subscriptions disappear when an owner's sources disappear
8. SFU production is policy-bound at runtime
9. P0-j metadata migrates explicitly to p0-k.1
10. no media-source policy state becomes durable SQLite truth

## Next rung

P0-k creates the source taxonomy needed for later work.

A future rung can add one reserved source class at a time, for example:

- shared-music with file or stream lifecycle
- agent-voice with an explicit speaking grant and stable voice identity
- service system tones
- richer soundboard cues

Those features should extend the source catalog rather than bypass it.
