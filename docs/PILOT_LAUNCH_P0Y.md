# P0-y — Pilot launch qualification

Status: **candidate launch-qualification rung**

P0-y freezes the exact matched task pair and candidate local worker for the CommonLine P0 human pilot, then requires the actual pilot machine to prove that configuration before the registration may become launch-ready.

P0-y does not collect human evidence.

## Frozen matched tasks

Candidate registration:

```text
experiments/p0y/registration.candidate.json
```

### Task A — Workshop check-in choice

A volunteer workshop expects 40 attendees.

The pair must choose between:

- QR self-check-in using attendees' phones
- staffed check-in on one shared tablet

Registered constraints:

- no paid services
- internet may drop for several minutes
- setup <= 45 minutes
- preregistered attendees and walk-ins must be distinguishable
- operator must be able to see who has checked in
- names deleted within 7 days

Required artifact:

- constraint-by-constraint comparison
- one recommendation
- three risks with mitigations
- five-step setup/run plan

### Task B — Equipment checkout choice

A volunteer event lends 30 labeled devices for one day.

The pair must choose between:

- paper sign-out sheets
- a local browser form on one shared laptop

Registered constraints:

- no paid services
- internet may drop for several minutes
- setup <= 45 minutes
- every device has a unique asset ID
- operator must be able to see which devices are currently out
- borrower alias plus checkout/return times deleted within 7 days

Required artifact:

- constraint-by-constraint comparison
- one recommendation
- three risks with mitigations
- five-step setup/run plan

## Why these tasks are matched

Both tasks:

- present two operational workflow choices
- contain six explicit constraints
- require the same artifact shape
- require comparison, synthesis, recommendation, risk handling, and planning
- can be solved from the registered brief without web research
- fit inside a 20-minute collaborative episode
- create enough state to make later-day reconstruction meaningful

They are similar in structure but use different operational content, reducing the chance that the second condition is merely a replay of the first.

## Candidate worker

The frozen candidate tag is:

```text
qwen3.6:latest
```

The tag alone is **not** sufficient for launch.

P0-y requires the local qualification run to capture the exact installed Ollama model digest.

Until that happens:

```json
"status": "qualification-pending"
```

## Qualification contract

The local qualifier checks the actual pilot machine.

It first calls the local Ollama model-list endpoint and requires the exact registered model tag to be present.

It then runs both frozen task briefs through a bounded chat request using:

```json
{
  "stream": false,
  "think": false,
  "format": "json",
  "options": {
    "num_ctx": 4096
  }
}
```

No tools field is supplied.

Each response must contain assistant content that parses into:

```json
{
  "title": "1-120 characters",
  "body": "1-6000 characters"
}
```

Each task must complete within the registered qualification limit:

```text
120000 ms
```

The receipt captures:

- pilot ID
- endpoint origin
- exact model tag
- exact model digest
- qualification timestamp
- no-tools / prompt-only contract
- frozen `num_ctx=4096`
- each task's SHA-256 fingerprint
- request SHA-256
- wall-clock latency
- Ollama-reported duration when available
- prompt/eval token counts when available
- output title/body lengths

It does **not** treat the qualification artifact as human pilot evidence.

## Run local qualification

From the CommonLine repo on the machine that will host the pilot worker:

```bash
npm run pilot:p0:qualify-worker -- \
  experiments/p0y/registration.candidate.json \
  --out pilot-local/p0y-qualification.json
```

A passing run prints:

```text
P0-y qualification PASS
```

If the model is missing, output is invalid, the endpoint fails, or either task exceeds the registered latency limit, qualification fails.

## Finalize the launch registration

After a passing receipt:

```bash
npm run pilot:p0:finalize-registration -- \
  experiments/p0y/registration.candidate.json \
  pilot-local/p0y-qualification.json \
  --out pilot-local/registration.launch.json
```

Finalization:

1. verifies pilot ID
2. verifies model tag
3. verifies endpoint origin
4. verifies both exact task hashes
5. verifies both latency bounds
6. binds the exact model digest into the registration
7. embeds the qualification receipt
8. changes status to `launch-ready`
9. runs the P0-x launch validator

Then independently verify:

```bash
npm run pilot:p0:validate-registration -- \
  pilot-local/registration.launch.json \
  --launch-ready
```

## Stale-receipt protection

A qualification receipt is invalid if either registered task changes after qualification.

The launch validator recomputes each task fingerprint from:

- task ID
- title
- brief
- matched rationale

and compares it to the receipt.

Changing any of those fields requires requalification.

The model digest is likewise bound into the launch registration so a drifting `:latest` tag does not silently change the worker after the pilot begins.

## Pilot runtime configuration

After finalization, the operator should configure the P0-w runtime using the finalized registration:

```text
COMMONLINE_AGENT_MODE=ollama-local
COMMONLINE_OLLAMA_MODEL=qwen3.6:latest
COMMONLINE_OLLAMA_URL=http://127.0.0.1:11434
COMMONLINE_AGENT_TIMEOUT_MS=120000
COMMONLINE_AGENT_NUM_CTX=4096
```

Before pair 01 begins:

- the launch registration must validate
- the server health surface must report the expected model tag
- the participant-visible worker card must show OLLAMA-LOCAL
- tools must show OFF
- input scope must show WORK-PROMPT-ONLY

If the installed digest changes after qualification, the pilot should pause and requalify before collecting additional pair evidence.

## CI proof

P0-y CI does not contact Ollama.

It uses a fake local provider to prove:

- exact registered model lookup
- both tasks are submitted separately
- stream=false
- think=false
- format=json
- no tools field
- exact task prompt binding
- digest capture
- task-hash capture
- launch finalization
- stale task receipt rejection
- missing model rejection
- invalid JSON rejection

This keeps CI deterministic while preserving a real local preflight requirement.

## Runtime boundary

P0-y changes no CommonLine room, media, authority, wire, or storage behavior.

```text
wire    = p0-v.1
storage = p0-q.1
```

P0-y freezes and qualifies the experiment configuration. Human evidence still begins only when pair 01 actually runs.


## Context-size rationale

The 4096-token context is intentionally bounded for this pilot. Both frozen tasks and the required compact artifact fit comfortably inside that window. Freezing the value avoids allowing a large local model to inherit an unexpectedly large context window that changes memory pressure or latency between qualification and the live run.
