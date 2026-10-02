# P0-w — Pilot silent-worker boundary

Status: **candidate pilot-readiness rung**

P0-w replaces the hard-coded deterministic worker with an explicit provider boundary while preserving the existing Commonline authority model.

The purpose is narrow:

> P0 can only test useful concurrent work if the silent worker can produce task-specific artifacts.

CI still uses the deterministic mock. A human pilot may explicitly opt into a local Ollama model.

## Governing law

```text
MODEL CAPABILITY
      !=
ROOM AUTHORITY
```

A more capable model does not receive more Commonline authority.

The P0-w worker receives exactly one input:

```text
WorkItem.prompt
```

It does not receive:

- live microphone audio
- STT transcript
- conversation-exchange transcript
- room history
- resume delta
- room grants
- participant recovery secrets
- media signaling
- external-effect credentials
- delegation authority
- tools

The worker returns one proposed artifact.

Proposal status does not imply acceptance, delegation, speaking, or execution.

## Provider modes

### mock

Default.

```text
COMMONLINE_AGENT_MODE=mock
```

The deterministic mock remains the CI and development default.

This keeps automated acceptance reproducible and prevents GitHub Actions from depending on a local model.

### ollama-local

Explicit pilot mode.

```text
COMMONLINE_AGENT_MODE=ollama-local
COMMONLINE_OLLAMA_MODEL=<local-model-name>
```

Optional:

```text
COMMONLINE_OLLAMA_URL=http://127.0.0.1:11434
COMMONLINE_AGENT_TIMEOUT_MS=45000
```

P0-w accepts only loopback Ollama endpoints:

- `localhost`
- `127.0.0.1`
- `::1`

Redirects are refused.

The timeout must be between 1000 and 120000 milliseconds.

A missing model, unsupported mode, non-loopback endpoint, invalid timeout, failed HTTP request, or invalid artifact response fails closed.

## Ollama request contract

P0-w calls the local chat endpoint with:

- `stream: false`
- `think: false`
- `format: "json"`
- no tools
- one fixed system instruction
- one user message containing only the bounded work prompt

The worker is instructed to return exactly one JSON object with:

```json
{
  "title": "string",
  "body": "string"
}
```

Runtime limits:

- title: 1–120 characters
- body: 1–6000 characters

Non-JSON or out-of-bounds output is rejected rather than silently coerced.

## System instruction boundary

The local worker is explicitly told that it is a silent worker inside a governed room and must not claim that it:

- executed external actions
- contacted anyone
- used tools
- heard live conversation
- accessed room history

This instruction is not treated as an authority mechanism. The real authority boundary remains in Commonline's deterministic server code.

## Runtime failure behavior

If local inference fails:

```text
working
   ↓
failed
```

No artifact is proposed.

No acceptance is invented.

Human media remains independent of the worker path.

## Health surface

The server health response exposes the active worker profile:

```json
{
  "silentWorker": {
    "mode": "ollama-local",
    "provider": "ollama",
    "model": "<configured model>",
    "endpoint": "http://127.0.0.1:11434",
    "tools": false,
    "inputScope": "work-prompt-only"
  }
}
```

This lets a pilot operator verify the processing boundary before participants begin.

## Pilot launch example

POSIX shell:

```bash
export COMMONLINE_AGENT_MODE=ollama-local
export COMMONLINE_OLLAMA_MODEL=<local-model-name>
export COMMONLINE_OLLAMA_URL=http://127.0.0.1:11434
export COMMONLINE_AGENT_TIMEOUT_MS=45000
npm run dev
```

PowerShell:

```powershell
$env:COMMONLINE_AGENT_MODE = "ollama-local"
$env:COMMONLINE_OLLAMA_MODEL = "<local-model-name>"
$env:COMMONLINE_OLLAMA_URL = "http://127.0.0.1:11434"
$env:COMMONLINE_AGENT_TIMEOUT_MS = "45000"
npm run dev
```

The operator should verify `/health` before beginning a human session.

## CI proof

P0-w adds unit coverage for:

- mock remains the default
- loopback-only endpoint enforcement
- no tool field is sent
- only the work prompt occupies the user message
- strict JSON artifact parsing
- invalid provider output fails closed
- missing local model fails fast
- invalid timeout fails fast

Existing browser acceptance continues to run against the deterministic mock.

## Wire and storage

No wire change.

```text
wire    = p0-v.1
storage = p0-q.1
```

P0-w is a server-side capability implementation behind the existing governed work contract.

## What P0-w does not prove

P0-w does not establish that any particular model is useful enough for Commonline.

It does not complete the P0 pilot.

The next evidence step is still the design-study experiment:

- six pairs
- two matched tasks per pair
- twenty-minute episodes
- counterbalanced Commonline vs voice + shared notes
- later-day resumption

P0-w only ensures that the Commonline condition can use a real task-specific silent worker without weakening the authority boundary.
