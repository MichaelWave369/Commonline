# P0-x pilot workspace

This directory holds the templates for the CommonLine P0 human-value pilot.

## Files

- `registration.template.json` — copy this before the pilot; it is intentionally not launch-ready until the matched tasks and exact local model are registered.
- `pair-result.template.json` — copy once per pair and fill only pseudonymous structured evidence.

The normative runbook is [../../docs/HUMAN_PILOT_P0X.md](../../docs/HUMAN_PILOT_P0X.md).

## Recommended local layout

Keep actual participant result files outside the repository working tree unless there is a deliberate reason and permission to commit them.

Example:

```text
pilot-local/
├── registration.json
├── pair-01.json
├── pair-02.json
├── pair-03.json
├── pair-04.json
├── pair-05.json
└── pair-06.json
```

## Commands

Launch registration:

```bash
npm run pilot:p0:validate-registration -- pilot-local/registration.json --launch-ready
```

Pair result:

```bash
npm run pilot:p0:validate-result -- pilot-local/pair-01.json --registration pilot-local/registration.json
```

Summary:

```bash
npm run pilot:p0:summarize -- pilot-local/registration.json pilot-local/pair-01.json pilot-local/pair-02.json pilot-local/pair-03.json pilot-local/pair-04.json pilot-local/pair-05.json pilot-local/pair-06.json
```

Do not change a measured value merely to satisfy a gate. The entire point of this directory is to make an inconvenient result remain inconvenient.


## Active launch candidate

P0-x defines the evidence format. P0-y freezes and qualifies the concrete first run.

See:

```text
../p0y/registration.candidate.json
../../docs/PILOT_LAUNCH_P0Y.md
```
