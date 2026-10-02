# P0-x — Human pilot evidence kit

Status: **candidate P0 human-value evidence rung**

P0-x turns the design study's proposed exploratory pilot into a reproducible, machine-checkable experiment package.

It does **not** create participant results. It does not claim that CommonLine is better than the baseline. It freezes how those claims will be measured before data collection.

## Source-derived protocol

The v0.1 design study proposes:

- six pairs
- two matched tasks per pair
- twenty-minute episodes
- counterbalanced order
- CommonLine compared with ordinary voice + shared notes
- each task resumed on a later day
- useful concurrent result gate: at least 4 of 6 pairs receive and use a result before the episode ends
- resumption gate: at least 4 pairs resume with less reconstruction than the matched baseline
- preference gate: at least 4 pairs choose CommonLine for another comparable task
- retained-state fidelity: no critical false approval; lesser mistakes can be identified and corrected
- attention: acceptable distraction and operable silence/stop controls
- governance: ungranted speaking, history, delegation, and external effects remain blocked

The design study explicitly calls these small-pilot decision aids, not population-level statistical evidence.

## P0-x operationalizations

The design study leaves several measurement details open. P0-x freezes the following implementation choices **before human data collection**:

| Question left open by the study | P0-x operational rule |
|---|---|
| How is counterbalancing split across six pairs? | 3 pairs use sequence A and 3 use sequence B. |
| How are the two matched tasks assigned? | Sequence A: CommonLine/task A then baseline/task B. Sequence B: baseline/task A then CommonLine/task B. |
| What counts as “less reconstruction”? | Whole seconds from resumption start until the pair says it has enough context to continue. CommonLine is better only when its time is strictly lower. |
| How is artifact quality captured? | Same registered 1–5 rubric under both conditions. Default dimensions: task fit, correctness, actionability. |
| What counts as acceptable attention? | The pair reports distraction as acceptable **and** successfully operates silence/stop controls. P0-x requires this for all completed pairs. |
| How are lesser retained-state mistakes handled? | Record observed and corrected counts. The fidelity gate requires every observed lesser mistake to be corrected. |
| How is governance attached to the human pilot? | Reference the already-passing P0-v governance CI evidence in the registration instead of asking human participants to perform unsafe-effect probes. |

Those are P0-x choices, not quotations from the design study.

## Registration lifecycle

Template:

```text
experiments/p0x/registration.template.json
```

The checked-in template is intentionally **not launch-ready**.

Before running pair 01, the operator must fill:

1. exact task A title, brief, and matched-task rationale
2. exact task B title, brief, and matched-task rationale
3. exact local Ollama model
4. any change to the registered retention/budget settings
5. final pilot ID if the default is not used

Then set:

```json
"status": "launch-ready"
```

and run:

```bash
npm run pilot:p0:validate-registration -- path/to/registration.json --launch-ready
```

Do not collect pilot evidence until this passes.

## Task comparability

The two tasks must be chosen before the pilot begins.

Their registration should explain why they are matched on the dimensions that matter for this pilot, such as:

- expected completion effort
- amount of information the pair must retain
- expected artifact complexity
- need for comparison, synthesis, planning, or another bounded worker contribution

P0-x does not invent the task content because task choice is part of the experimental registration.

## Worker condition

The CommonLine condition must use P0-w:

```text
COMMONLINE_AGENT_MODE=ollama-local
COMMONLINE_OLLAMA_MODEL=<registered model>
COMMONLINE_OLLAMA_URL=http://127.0.0.1:11434
```

Before the episode starts, participants should be able to see the worker disclosure card showing:

- `OLLAMA-LOCAL`
- configured model
- tools off
- input scope `WORK-PROMPT-ONLY`

The worker model recorded in the registration should not be changed mid-pilot. If it must change, record a protocol deviation and treat the change as a reason to reconsider comparability.

## Baseline condition

The baseline is:

```text
ordinary voice + shared notes
```

No CommonLine silent worker is used.

The shared notes must remain available through that task's later-day resumption, because the baseline is meant to test ordinary durable notes rather than forced amnesia.

## Counterbalanced sequences

### Sequence A — planned for 3 pairs

```text
period 1: CommonLine + task A
period 2: baseline   + task B
```

### Sequence B — planned for 3 pairs

```text
period 1: baseline   + task A
period 2: CommonLine + task B
```

This makes each task appear in each condition across the pilot while also reversing condition order across pairs.

## Episode runbook

For each condition:

1. confirm the assigned task and condition
2. start the 20-minute episode
3. allow the pair to work and talk normally within that condition
4. in CommonLine, record whether the silent-worker result arrives before episode end
5. record whether the pair actually uses that result before episode end
6. score the resulting artifact with the same registered rubric
7. end the episode at the registered duration
8. do not perform the resumption measurement on the same calendar day

For CommonLine also record:

- critical false approvals
- lesser retained-state mistakes observed
- lesser mistakes corrected
- whether distraction was acceptable
- whether silence/stop controls were operable

## Later-day resumption

On a later calendar day:

1. start the stopwatch when the pair begins resuming the task
2. expose only the continuity material belonging to that condition
3. stop the timer when the pair states it has enough context to continue
4. record whole seconds
5. record correction count

For CommonLine, use the selected durable room state and resumption view.

For baseline, use the retained shared notes from that task.

The primary resumption comparison is the registered reconstruction time. Correction count remains descriptive supporting evidence.

## Preference

After the pair has completed and later resumed both conditions, record exactly one:

```text
commonline
baseline
no-preference
```

The pair should answer which condition it would choose for another comparable task.

## Structured pair evidence

Template:

```text
experiments/p0x/pair-result.template.json
```

Use pseudonymous IDs only:

```text
pair-01
pair-02
...
pair-06
```

The structured result format intentionally contains no participant name, email address, raw transcript, audio, or private chat field.

Validate each completed result:

```bash
npm run pilot:p0:validate-result -- pair-01.json --registration registration.json
```

## Evidence classes

P0-x recognizes:

```text
human-pilot
synthetic
```

Synthetic data is useful for testing the tooling.

It is **not** human evidence.

The summarizer refuses synthetic input by default. Its `--allow-synthetic` option exists only so CI can exercise the calculation code; such a summary is always marked:

```json
"decisionEligible": false
```

## Summary and gates

After all six real pair files validate:

```bash
npm run pilot:p0:summarize -- registration.json pair-01.json pair-02.json pair-03.json pair-04.json pair-05.json pair-06.json
```

The summary reports:

- useful concurrent result count
- pairs with lower CommonLine reconstruction time
- CommonLine preference count
- critical false approval count
- lesser mistake observed/corrected counts
- acceptable-attention count
- per-condition mean reconstruction time
- per-condition mean artifact rubric score by dimension
- counterbalance sequence counts
- governance evidence reference

A summary becomes `decisionEligible` only when:

- exactly 6 unique human-pilot pair results are present
- sequence A has exactly 3 pairs
- sequence B has exactly 3 pairs
- the launch registration validates
- no synthetic evidence is included

Candidate gates are then evaluated.

Passing the useful-work, resumption, preference, fidelity, and attention gates does **not** override a failed governance gate.

## Retention boundary

The template defaults to:

- audio recording: off
- transcript retention: off
- structured pilot metrics: retained
- accepted CommonLine artifacts: retained
- baseline notes: retained through resumption

Those settings are part of the registration and must be disclosed to participants as appropriate for the actual pilot context.

P0-x is an engineering/product learning protocol. It does not itself establish institutional research approval, legal compliance, or consent requirements for a particular organization or jurisdiction.

## P0 exit interpretation

P0-x is designed to answer the remaining P0 question rather than make the answer inevitable.

Possible outcomes include:

- evidence supports moving toward P1
- concurrent work is useful but resumption is not better
- resumption is better but distraction is unacceptable
- the baseline performs just as well
- task or model quality is too weak to interpret the product concept
- a governance failure blocks advancement regardless of usability signal

The design study's own rule still applies: a weak or negative result is a reason to learn or narrow the product, not a reason to attach more agents and declare victory.
