# Commonline Agent Exchange v1: an opt-in cross-project handoff

Status: **sidecar contract and local adapter pilot, not a deployed federation or a new P0 room-wire command**.

This adds a small, explicit JSON envelope for agent-to-agent coordination. It does **not** change Commonline P0 room protocol, PHircQ peer identity, Agentora execution, or GitHub permissions.

## Wire contract

Schema marker: **commonline.agent-exchange.v1**. An envelope contains messageId, threadId, sender, recipient, kind, issuedAt, expiresAt, summary, authority plus optional contextRef and sourceSha. All timestamps are canonical UTC ISO strings with milliseconds. IDs are bounded printable identifiers. A message has a maximum 24-hour lifetime and maximum 8 KiB encoded size.

Kinds: offer_work, accept_work, decline_work, request_context, propose_outcome, report_blocker, receipt.

The constant authority value is **advisory-only**. Message bodies **never** carry executable tool invocations or raw secrets. The opaque contextRef does not grant its holder access to the referenced context.

Use **parseAgentExchange** from @commonline/protocol to reject malformed or expired envelopes at an ingestion boundary.

## Required receiver checks (not implemented by this pure parser)

1. Authenticate transport identity independently and bind it to **sender**. A string field is not identity.
2. Check the authenticated sender may contact the exact **recipient** and that the recipient is actually registered.
3. Authorize each requested context read separately. Room membership is not history access.
4. Store messageId for idempotent retry/replay protection using a bounded durable receipt ledger.
5. Verify sourceSha against the actual resource before work starts; a SHA-shaped string is not source proof.
6. Reject stale offers and control data masquerading as ordinary summaries (prompt injection remains untrusted content).
7. Never turn accept_work, propose_outcome, or receipt into EXECUTE_EXTERNAL_EFFECT, merge, dispatch, or other permission.
8. Keep private project context out of public PhiMadaPrime and GitHub Pages outputs.
9. Apply delivery budgets, quotas, busy/defer and revocation before adding real networking.

## Initial roles

- **Commonline**: owns coordination semantics, proposal review and explicit authority grants.
- **PHircQ**: owns authenticated peer messaging and local transport. Its initial exchange adapter is test-only in-memory; production networking requires the signed peer session and an explicit bridge approval gate.
- **Agentora**: eventually consumes validated offers as review-only inbox items; execution continues through existing governed AgentCeption paths.
- **RepoNerve**: read-only project evidence; no dispatch by observation.
- **PhiMadaPrime**: privacy-filtered, read-only display.

## Pilot

Agent BTM offers a bounded hand-tracking investigation to agent OverStrings. OverStrings can accept, decline, request less context, or propose an outcome. A human or scoped authorized reviewer separately decides whether the outcome may be accepted and whether any executor may change a repository.

Acceptance tests: valid and invalid envelope parsing, expiry and forged-authority rejection, local PHircQ two-agent exchange, duplicate/replay rejection, wrong-recipient rejection, and clean transport disconnect.

Future rung: authenticating production peer transport adapter, durable inbox, receipts, identity binding, explicit grant checks, operator-facing review, and only then cross-host federation.
