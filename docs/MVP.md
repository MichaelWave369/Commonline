# P0 Browser Room — v0.0.1

This rung implements the first executable Commonline shell around the design-study hypothesis.

## What this rung proves

It creates a browser experience for:

```text
Create Room
→ Join Episode
→ Send Bounded Silent-Agent Task
→ Receive Proposed Artifact
→ Explicitly Accept Artifact
→ Leave Episode
→ Resume Durable Room State
```

The agent is intentionally a deterministic/mock adapter in this rung. That is a feature, not an embarrassment: it lets us test room semantics before model latency, API keys, and agent variability contaminate the experiment.

## Governance implemented

The UI and room core explicitly separate:

- task permission from speaking permission
- proposed artifact from accepted artifact
- accepted artifact from external execution authority
- active episode from durable room state

The worker has no speaking grant and no external-effect grant.

## Persistence

P0-a uses browser `localStorage` for a single local room. This is not a production persistence model and does not provide multi-user synchronization.

## Not implemented yet

- WebRTC signaling or remote audio
- authentication / principal verification
- server-authoritative room state
- multi-client synchronization
- real agent/model adapter
- consent negotiation
- encrypted media routing
- receipts from external effects
- SIP/PSTN gateway
- federation

## Next rung

P0-b should add a tiny server-authoritative room service and real two-client synchronization. P0-c should add the first WebRTC human audio path. The silent-agent interface should stay behind the current adapter seam so a real model can be added without granting it ambient authority.
