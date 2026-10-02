# P0-y launch qualification

This directory contains the frozen candidate configuration for the first CommonLine P0 human pilot.

## Candidate

- pilot: `commonline-p0-pilot-001`
- model tag: `qwen3.6:latest`
- status: `qualification-pending`
- tasks: frozen in `registration.candidate.json`

Do not edit the task text after qualification and continue using the same receipt.

## Local workflow

```bash
npm run pilot:p0:qualify-worker -- \
  experiments/p0y/registration.candidate.json \
  --out pilot-local/p0y-qualification.json

npm run pilot:p0:finalize-registration -- \
  experiments/p0y/registration.candidate.json \
  pilot-local/p0y-qualification.json \
  --out pilot-local/registration.launch.json

npm run pilot:p0:validate-registration -- \
  pilot-local/registration.launch.json \
  --launch-ready
```

The qualifier must run on the machine whose local Ollama instance will serve the pilot.

The qualification receipt and launch registration may remain in a local pilot-evidence directory. Do not treat either file as participant evidence.

See [../../docs/PILOT_LAUNCH_P0Y.md](../../docs/PILOT_LAUNCH_P0Y.md).
