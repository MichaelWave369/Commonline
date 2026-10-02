# P0-z — Pilot execution pack

Status: **candidate execution-preparation rung**

P0-z takes one already-qualified, launch-ready P0 registration and produces the six fixed pair packets used to run the human pilot.

It does not create human evidence and does not modify CommonLine runtime behavior.

## Input

P0-z requires the launch-ready registration produced by P0-y:

    pilot-local/registration.launch.json

## Fixed pair allocation

Before pair 01 begins, P0-z freezes:

    pair-01 -> sequence A
    pair-02 -> sequence B
    pair-03 -> sequence A
    pair-04 -> sequence B
    pair-05 -> sequence A
    pair-06 -> sequence B

This preserves the registered 3/3 counterbalance while spreading condition order across recruitment and calendar order.

For the first pilot:

    Sequence A
    period 1: CommonLine + task A
    period 2: baseline   + task B

    Sequence B
    period 1: baseline   + task A
    period 2: CommonLine + task B

## Prepare the execution pack

On the pilot machine:

    npm run pilot:p0:prepare-execution -- pilot-local/registration.launch.json --out pilot-local/execution

A successful run reports P0-z execution pack READY and the fixed A/B allocation.

## Files produced

The output directory contains one manifest plus an assignment and result draft for every pair:

    manifest.json
    pair-01.assignment.json
    pair-01.result.draft.json
    ...
    pair-06.assignment.json
    pair-06.result.draft.json

There are 13 files total.

## Registration hash

P0-z computes a SHA-256 hash over the exact finalized launch registration.

That hash is copied into the manifest, every assignment, and every result draft.

The evidence chain becomes:

    qualified model digest
            ↓
    launch registration
            ↓
    registration SHA-256
            ↓
    pair assignment
            ↓
    pair result

When a result contains registrationHash, P0-x validates it against the supplied launch registration. A result from a different launch registration is rejected.

## Pair assignment contents

Each assignment contains:

- pilot ID and registration hash
- pair ID and sequence ID
- episode duration and resumption rule
- baseline definition
- exact model tag and digest
- endpoint and frozen context size
- tools status and input scope
- artifact scoring rubric
- period order
- exact task title and brief for each period

It contains no participant name, email, audio, or transcript field.

## Result drafts start incomplete

Observed fields begin as null. This includes dates, useful-result observations, reconstruction time, fidelity observations, attention observations, rubric scores, and preference.

This is intentional. Generated result drafts cannot validate as human evidence until real observations are entered.

P0-z does not pre-fill a successful outcome.

## Running a pair

For each pair:

1. Use that pair's assignment file.
2. Follow period 1 exactly.
3. Follow period 2 exactly.
4. Resume each task on a later calendar day.
5. Enter only observed values into the result draft.
6. Save the completed file as pair-XX.result.json.
7. Validate it against the launch registration.

Example:

    npm run pilot:p0:validate-result -- pilot-local/execution/pair-01.result.json --registration pilot-local/registration.launch.json

Do not change an observed value merely to make validation or a candidate gate pass.

## Privacy boundary

Use pseudonymous pair IDs only.

Do not add names, emails, phone numbers, raw audio, raw transcripts, or private-message content to the structured result files.

Operational identity/contact mapping, if needed, stays separate from the pilot evidence directory.

## Completing the pilot

Only after all six real pair files validate should the P0-x summary be produced.

The summarizer remains the authority for the registered candidate gate calculations.

## CI proof

P0-z CI proves:

- launch-ready registration required
- six pair packets generated
- alternating A/B allocation
- exactly three pairs per sequence
- registered period/condition/task mapping preserved
- worker digest and context preserved
- every packet bound to the exact launch registration hash
- result drafts fail evidence validation before observation
- mismatched registration hash rejected
- one manifest plus twelve pair files written

CI uses a synthetic launch registration and creates no human evidence.

## Boundary

P0-z adds no new agent capability, authority grant, wire message, SQLite state, human result, or product-value claim.

It converts the frozen launch registration into deterministic operator materials so the experiment can be run without improvising its assignment structure.
