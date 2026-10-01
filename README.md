# Commonline

**A governed conversation runtime for humans, agents, and shared undertakings.**

Commonline starts from a simple observation: live calling has barely evolved compared with text, collaboration, automation, and AI.

The project explores a different primitive:

> A conversation should not be treated as a disposable audio connection. It can be one live episode inside a durable, permissioned shared undertaking.

A Commonline room can preserve selected outcomes, unresolved questions, artifacts, responsibilities, and permissions without requiring every spoken word to become permanent history.

## Core model

Commonline separates four things that conventional calling tends to collapse:

- **Undertaking** — the purpose, unresolved dependencies, resources, and finish condition.
- **Room** — durable namespace, membership policy, retained state, and history permissions.
- **Episode** — a temporary interval of live participation with its own audience and processing consent.
- **Work item** — a bounded request or obligation that may outlive an episode under an explicit grant.

The governing principle is:

> **CAPABILITY ≠ AUTHORITY**

An agent may be capable of hearing, researching, drafting, speaking, contacting another agent, or using a tool. None of those capabilities automatically grants permission to do so.

## What Commonline is exploring

- Human-to-human, human-to-agent, and agent-to-agent live interaction.
- Persistent rooms and modern party-line style spaces.
- Silent agents that work while humans keep talking.
- Agent backchannels that surface only useful results.
- Selective memory instead of transcript-as-truth.
- Attention leases: permission to interrupt is distinct from permission to work.
- Soundboards, music, audio cues, and expressive calling.
- Resumption based on **what changed**, not merely a compressed transcript.
- Exact authorization for external effects, with receipts.
- Eventual SIP/PSTN participation for ordinary telephone callers.
- An open coordination protocol layered around existing media and agent-task transports.

## The smallest experiment

The first useful proof is intentionally small:

1. Two humans join one browser room.
2. One silent agent receives only explicitly permitted context.
3. A human sends one bounded task while conversation continues.
4. The agent returns an inspectable artifact.
5. Humans explicitly choose what enters durable room state.
6. Everyone leaves.
7. On return, the room presents accepted work, unresolved questions, and the next step.

If that does not improve concurrent work and resumption compared with an ordinary voice session plus shared notes, adding more agents and features is not a rescue strategy.

## Repository status

This repository is at the **P0 prototype** stage. P0-r adds a deterministic selective resumption brief over the durable room state already proven through P0-q, so returning participants can see accepted work, unresolved work, the next action, and missed durable events without persisting or summarizing conversation transcripts.

The initial design study is preserved in [docs/design/Commonline_Design_Study_v0.1.md](docs/design/Commonline_Design_Study_v0.1.md), together with its checker execution log.

The current architecture and roadmap files are working project documents. They describe proposals, not validated product claims.

## Repository layout

```text
Commonline/
├── apps/
│   ├── server/          # authoritative room + WebSocket synchronization
│   └── web/             # browser participant UI
├── packages/
│   ├── agent-runtime/   # bounded worker adapter seam
│   ├── protocol/        # wire and room types
│   ├── room-core/       # pure room state transitions
│   └── ui/              # shared UI primitives
├── docs/
│   ├── ARCHITECTURE.md
│   ├── MVP.md
│   ├── PROTOCOL.md
│   ├── ROADMAP.md
│   └── design/
└── README.md
```

## Design principles

1. **Capability is not authority.**
2. **Presence, hearing, speaking, history access, and action authority are separate states.**
3. **Human audio should continue when optional agent systems fail.**
4. **Discussion does not authorize execution.**
5. **Selective continuity is preferable to automatic surveillance.**
6. **Agents must earn attention separately from task permission.**
7. **Accepted artifacts and external effects are separate transitions.**
8. **A room should be useful even with every agent turned off.**
9. **Dormant rooms should not burn compute merely to appear alive.**
10. **The system must preserve dissent rather than manufacture consensus.**


## Development

The current executable rung is P0-r: CommonLine derives a compact resumption brief from durable room state and durable event deltas only. The wire remains `p0-q.1`; ephemeral listening transcripts, generated replies, attention leases, media, scratch, and signaling remain outside continuity.

```bash
npm install
npm run dev
```

Open the local Vite URL and exercise the current vertical slice:

```text
Join as stable Participant
→ Attach ephemeral Session
→ Submit Work Item
→ Agent uses private Scratch
→ Agent emits room-visible Proposal
→ Steward sends idempotent Accept Outcome
→ Server binds exact Grant Receipt
→ Durable Acceptance Receipt
→ Reconnect without inventing another participant
```

See [docs/MVP.md](docs/MVP.md), [docs/WIRE_FREEZE_P0D.md](docs/WIRE_FREEZE_P0D.md), [docs/PERSISTENCE_P0E.md](docs/PERSISTENCE_P0E.md), [docs/IDENTITY_AUTHORITY_P0F.md](docs/IDENTITY_AUTHORITY_P0F.md), and [docs/MEDIA_P0G.md](docs/MEDIA_P0G.md), and [docs/MEDIA_SESSION_P0H.md](docs/MEDIA_SESSION_P0H.md), and [docs/MULTIPARTY_P0I.md](docs/MULTIPARTY_P0I.md), and [docs/SFU_P0J.md](docs/SFU_P0J.md), and [docs/MEDIA_SOURCE_POLICY_P0K.md](docs/MEDIA_SOURCE_POLICY_P0K.md), and [docs/MEDIA_ACCEPTANCE_P0L.md](docs/MEDIA_ACCEPTANCE_P0L.md), and [docs/AGENT_VOICE_AUTHORITY_P0M.md](docs/AGENT_VOICE_AUTHORITY_P0M.md), and [docs/LOCAL_AGENT_VOICE_P0N.md](docs/LOCAL_AGENT_VOICE_P0N.md), and [docs/ATTENTION_LEASE_P0O.md](docs/ATTENTION_LEASE_P0O.md), and [docs/GOVERNED_LISTENING_P0P.md](docs/GOVERNED_LISTENING_P0P.md), and [docs/EXPLICIT_EXCHANGE_P0Q.md](docs/EXPLICIT_EXCHANGE_P0Q.md), and [docs/RESUMPTION_P0R.md](docs/RESUMPTION_P0R.md).

## Working name

**Commonline** is a working project name. Trademark and naming clearance have not yet been performed.

## License

No open-source license has been selected yet. Until one is added, normal copyright rules apply.
