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

This repository is at the **design-study / pre-prototype** stage.

The initial design study is preserved in [docs/design/Commonline_Design_Study_v0.1.md](docs/design/Commonline_Design_Study_v0.1.md), together with its checker execution log.

The current architecture and roadmap files are working project documents. They describe proposals, not validated product claims.

## Repository layout

```text
Commonline/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PROTOCOL.md
│   ├── ROADMAP.md
│   └── design/
│       ├── Commonline_Design_Study_v0.1.md
│       └── Commonline_Design_Study_v0.1_Checker_Execution_Log.md
└── .gitignore
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

## Working name

**Commonline** is a working project name. Trademark and naming clearance have not yet been performed.

## License

No open-source license has been selected yet. Until one is added, normal copyright rules apply.
