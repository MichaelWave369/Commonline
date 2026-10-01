# Commonline Roadmap

Status: **Candidate staged plan**

The project should prove its distinctive value before expanding into the glorious communications hydra it could eventually become.

## P0 — Experience proof

**Goal:** prove concurrent work and trustworthy resumption.

Scope:
- two humans
- one browser room
- one silent agent
- one bounded artifact task
- explicit processing controls
- selected durable outcomes
- one participant-owned sound cue
- room resumption

Exit evidence:
- useful agent result arrives while humans continue talking
- participants actually use it
- resumption requires less reconstruction than a voice + notes baseline
- no critical false approval
- ungranted speaking/history/delegation/effects are blocked

## P1 — Bounded collaboration

Add:
- multiple agent roles
- attention leases
- agent backchannel work
- context-limited delegation
- visible agent work state
- interruption budgets

## P2 — Continuity + adapters

Add:
- multi-episode room history
- work branches
- state-delta resumption
- source expiry and derivative review
- native clients
- selected external tools
- exact execution grants and receipts

## P3 — Telephone access

Add:
- disclosed SIP/PSTN gateway
- reduced no-app caller experience
- audio notices and keypad controls
- mix-minus handling
- telecom / recording review

## P4 — Interoperability

Add:
- open room profile
- independently operated agents
- room federation
- portable state
- conformance tests
- revocation and abuse recovery exercises

## P5 — Broader ecology

Explore:
- persistent social rooms and modern party lines
- public research salons
- maintained knowledge rooms
- organization-to-organization boundary rooms
- Moltbook-style callable agents
- expressive audio spaces
- devices and sensors as non-human participants

## Explicitly deferred from P0

- public agent discovery
- outbound automated telephony
- arbitrary device control
- paid transactions
- large music catalogs
- public federation
- emergency-service use
- absent-person simulation

## First implementation target

The first build should answer one question:

> Does a persistent room with one silent governed agent let two people produce useful work during a conversation and resume later with less reconstruction?

If the answer is no, the correct response is to learn from that result, not attach seventeen more agents and an airhorn.


## Current P0 implementation ladder

The executable prototype has advanced through these internal rungs:

- P0-a governed browser room
- P0-b server-authoritative synchronization
- P0-c one-to-one human WebRTC audio
- P0-d frozen governance/scratch wire
- P0-e durable SQLite room state
- P0-f cryptographic participant identity and authority handoff
- P0-g STUN/TURN internet hardening
- P0-h exact call sessions and perfect negotiation
- P0-i multiparty source/subscription boundary
- P0-j real governed mediasoup SFU
- P0-k governed media source policy with executable microphone + sound-effect classes

The source taxonomy is intentionally ahead of feature execution: shared music, agent voice, and system tones are declared but reserved rather than being smuggled through the human microphone path.

- P0-l three-browser live media acceptance with per-source RTP evidence

- P0-m durable agent voice authority, voice identity, and explicit revocation

- P0-n local agent voice renderer with Piper adapter, direct PCMU RTP, and revocation-tested delivery

- P0-o ephemeral one-turn attention leases and directed agent turn-taking

- P0-p bounded push-to-share listening with local STT and no ambient agent microphone access

- P0-q explicit heard-context exchange binding with separate attention-authorized reply

- P0-r deterministic selective resumption brief from durable state + resume delta
