import test from "node:test";
import assert from "node:assert/strict";
import {
  taskFingerprint,
  validateRegistration,
  validatePairResult,
  summarizePilot
} from "../scripts/p0x-pilot.mjs";

function registration(overrides = {}) {
  const value = {
    schema: "p0-x.registration.1",
    evidenceClass: "human-pilot",
    status: "launch-ready",
    pilotId: "pilot-synthetic",
    protocol: {
      pairCount: 6,
      tasksPerPair: 2,
      episodeMinutes: 20,
      resumeTiming: "later-day",
      baseline: "voice-plus-shared-notes"
    },
    counterbalance: {
      plannedPairsPerSequence: 3,
      sequences: [
        {
          id: "A",
          assignments: [
            { period: 1, condition: "commonline", taskId: "task-a" },
            { period: 2, condition: "baseline", taskId: "task-b" }
          ]
        },
        {
          id: "B",
          assignments: [
            { period: 1, condition: "baseline", taskId: "task-a" },
            { period: 2, condition: "commonline", taskId: "task-b" }
          ]
        }
      ]
    },
    tasks: [
      {
        taskId: "task-a",
        title: "Matched task A",
        brief: "Produce a compact comparison for task A.",
        matchedRationale: "Comparable scope and expected artifact complexity."
      },
      {
        taskId: "task-b",
        title: "Matched task B",
        brief: "Produce a compact comparison for task B.",
        matchedRationale: "Comparable scope and expected artifact complexity."
      }
    ],
    artifactScoring: {
      rubricId: "artifact-rubric-v1",
      dimensions: [
        {
          id: "usefulness",
          description: "How usable the artifact is for the assigned task.",
          min: 1,
          max: 5
        },
        {
          id: "accuracy",
          description: "How well the artifact matches the task facts and constraints.",
          min: 1,
          max: 5
        }
      ]
    },
    retention: {
      audioRecorded: false,
      transcriptRetained: false,
      structuredMetricsRetained: true,
      acceptedArtifactsRetained: true,
      baselineNotesRetainedThroughResumption: true
    },
    budget: {
      maxExternalSpendUsd: 0
    },
    worker: {
      mode: "ollama-local",
      model: "pilot-model",
      endpoint: "http://127.0.0.1:11434",
      tools: false,
      inputScope: "work-prompt-only",
      numCtx: 4096,
      maxQualificationLatencyMs: 120000,
      modelDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      qualificationReceipt: {
        schema: "p0-y.qualification.1",
        passed: true,
        pilotId: "pilot-synthetic",
        model: "pilot-model",
        modelDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        numCtx: 4096,
        tasks: [
          {
            taskId: "task-a",
            taskHash: "",
            wallMs: 1000
          },
          {
            taskId: "task-b",
            taskHash: "",
            wallMs: 1000
          }
        ]
      }
    },
    governanceEvidence: {
      passed: true,
      sourceRef: "synthetic-ci:governance"
    },
    thresholds: {
      usefulConcurrentPairs: 4,
      resumptionBetterPairs: 4,
      preferenceCommonlinePairs: 4,
      criticalFalseApprovalsMax: 0
    },
    operationalDefinitions: {
      usefulConcurrentResult:
        "Commonline result arrives and is used before the 20-minute episode ends.",
      reconstructionTime:
        "Seconds from resumption start until the pair confirms enough context to continue the task.",
      criticalFalseApproval:
        "A retained state item indicates approval that neither participant actually granted.",
      acceptableDistraction:
        "The pair reports distraction as acceptable and can operate silence/stop controls.",
      preference:
        "Pair chooses which condition they would use for another comparable task."
    },
    ...overrides
  };

  value.worker.qualificationReceipt.tasks[0].taskHash =
    taskFingerprint(value.tasks[0]);
  value.worker.qualificationReceipt.tasks[1].taskHash =
    taskFingerprint(value.tasks[1]);

  return value;
}

function pairResult(index, options = {}) {
  const sequenceId = index <= 3 ? "A" : "B";
  const commonlineTask = sequenceId === "A" ? "task-a" : "task-b";
  const baselineTask = sequenceId === "A" ? "task-b" : "task-a";

  return {
    schema: "p0-x.pair-result.1",
    evidenceClass: "synthetic",
    pilotId: "pilot-synthetic",
    pairId: `pair-${String(index).padStart(2, "0")}`,
    sequenceId,
    conditions: {
      commonline: {
        taskId: commonlineTask,
        episodeDate: "2026-10-05",
        episode: {
          resultArrivedBeforeEnd: true,
          resultUsedBeforeEnd: true
        },
        resumption: {
          resumedOn: "2026-10-06",
          reconstructionSeconds: 30,
          corrections: 0
        },
        fidelity: {
          criticalFalseApprovals: 0,
          lesserMistakesObserved: 0,
          lesserMistakesCorrected: 0
        },
        attention: {
          acceptableDistraction: true,
          silenceStopControlsOk: true
        },
        artifactScores: {
          usefulness: 4,
          accuracy: 4
        }
      },
      baseline: {
        taskId: baselineTask,
        episodeDate: "2026-10-05",
        resumption: {
          resumedOn: "2026-10-06",
          reconstructionSeconds: 60,
          corrections: 1
        },
        artifactScores: {
          usefulness: 3,
          accuracy: 4
        }
      }
    },
    preference: "commonline",
    protocolDeviations: [],
    ...options
  };
}

test("P0-x registration freezes the design-study pilot shape", () => {
  const result = validateRegistration(registration(), { launchReady: true });
  assert.equal(result.ok, true);
  assert.equal(result.launchReady, true);
});

test("P0-x registration rejects a non-loopback pilot worker", () => {
  const candidate = registration();
  candidate.worker.endpoint = "https://example.com";

  const result = validateRegistration(candidate, { launchReady: true });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /loopback/);
});

test("P0-x pair result requires later-day resumption and registered assignment", () => {
  const candidate = pairResult(1);
  candidate.conditions.commonline.resumption.resumedOn = "2026-10-05";

  const result = validatePairResult(candidate, registration());
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /later calendar day/);
});

test("P0-x refuses to summarize synthetic fixtures as human evidence by default", () => {
  assert.throws(
    () =>
      summarizePilot(
        registration(),
        Array.from({ length: 6 }, (_, index) => pairResult(index + 1))
      ),
    /Synthetic fixtures cannot be summarized as human evidence/
  );
});

test("P0-x synthetic summary can exercise all registered gates without becoming decision evidence", () => {
  const summary = summarizePilot(
    registration(),
    Array.from({ length: 6 }, (_, index) => pairResult(index + 1)),
    { allowSynthetic: true }
  );

  assert.equal(summary.evidenceClass, "synthetic");
  assert.equal(summary.decisionEligible, false);
  assert.equal(summary.pairCountObserved, 6);
  assert.equal(summary.descriptive.usefulConcurrentPairs, 6);
  assert.equal(summary.descriptive.resumptionBetterPairs, 6);
  assert.equal(summary.descriptive.commonlinePreferencePairs, 6);
  assert.equal(summary.gates.governance.pass, true);
  assert.equal(summary.allCandidateGatesPass, false);
});

test("P0-x incomplete human results remain ineligible for a gate decision", () => {
  const partial = pairResult(1);
  partial.evidenceClass = "human-pilot";

  const summary = summarizePilot(registration(), [partial]);
  assert.equal(summary.evidenceClass, "human-pilot");
  assert.equal(summary.decisionEligible, false);
  assert.equal(summary.gates.usefulConcurrentResult.pass, false);
  assert.equal(summary.allCandidateGatesPass, false);
});
