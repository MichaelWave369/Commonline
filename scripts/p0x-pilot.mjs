import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REGISTRATION_SCHEMA = "p0-x.registration.1";
export const RESULT_SCHEMA = "p0-x.pair-result.1";
export const SUMMARY_SCHEMA = "p0-x.summary.1";

const CONDITIONS = ["commonline", "baseline"];
const PREFERENCES = ["commonline", "baseline", "no-preference"];

function fail(errors, message) {
  errors.push(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function isoDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function loopbackUrl(value) {
  if (!nonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "[::1]")
    );
  } catch {
    return false;
  }
}

function unique(values) {
  return new Set(values).size === values.length;
}

export function validateRegistration(registration, options = {}) {
  const errors = [];
  const launchReady = options.launchReady === true;

  if (!registration || typeof registration !== "object") {
    return { ok: false, launchReady: false, errors: ["Registration must be an object."] };
  }

  if (registration.schema !== REGISTRATION_SCHEMA) {
    fail(errors, `schema must be ${REGISTRATION_SCHEMA}.`);
  }
  if (registration.evidenceClass !== "human-pilot") {
    fail(errors, "evidenceClass must be human-pilot.");
  }
  if (!nonEmptyString(registration.pilotId)) {
    fail(errors, "pilotId is required.");
  }
  if (registration.protocol?.pairCount !== 6) {
    fail(errors, "protocol.pairCount must be 6.");
  }
  if (registration.protocol?.tasksPerPair !== 2) {
    fail(errors, "protocol.tasksPerPair must be 2.");
  }
  if (registration.protocol?.episodeMinutes !== 20) {
    fail(errors, "protocol.episodeMinutes must be 20.");
  }
  if (registration.protocol?.resumeTiming !== "later-day") {
    fail(errors, "protocol.resumeTiming must be later-day.");
  }
  if (registration.protocol?.baseline !== "voice-plus-shared-notes") {
    fail(errors, "protocol.baseline must be voice-plus-shared-notes.");
  }

  const thresholds = registration.thresholds ?? {};
  if (thresholds.usefulConcurrentPairs !== 4) {
    fail(errors, "thresholds.usefulConcurrentPairs must be 4.");
  }
  if (thresholds.resumptionBetterPairs !== 4) {
    fail(errors, "thresholds.resumptionBetterPairs must be 4.");
  }
  if (thresholds.preferenceCommonlinePairs !== 4) {
    fail(errors, "thresholds.preferenceCommonlinePairs must be 4.");
  }
  if (thresholds.criticalFalseApprovalsMax !== 0) {
    fail(errors, "thresholds.criticalFalseApprovalsMax must be 0.");
  }

  const sequences = registration.counterbalance?.sequences;
  if (!Array.isArray(sequences) || sequences.length !== 2) {
    fail(errors, "counterbalance.sequences must contain exactly two sequences.");
  } else {
    const ids = sequences.map((sequence) => sequence?.id);
    if (!unique(ids) || !ids.every(nonEmptyString)) {
      fail(errors, "counterbalance sequence ids must be unique non-empty strings.");
    }

    for (const sequence of sequences) {
      const assignments = sequence?.assignments;
      if (!Array.isArray(assignments) || assignments.length !== 2) {
        fail(errors, `sequence ${sequence?.id ?? "?"} must contain two assignments.`);
        continue;
      }
      const conditions = assignments.map((item) => item?.condition);
      const taskIds = assignments.map((item) => item?.taskId);
      const periods = assignments.map((item) => item?.period);
      if (
        !CONDITIONS.every((condition) => conditions.includes(condition)) ||
        conditions.length !== CONDITIONS.length
      ) {
        fail(errors, `sequence ${sequence.id} must contain commonline and baseline once each.`);
      }
      if (!unique(taskIds) || !taskIds.every(nonEmptyString)) {
        fail(errors, `sequence ${sequence.id} must use two unique task ids.`);
      }
      if (!periods.includes(1) || !periods.includes(2)) {
        fail(errors, `sequence ${sequence.id} must contain periods 1 and 2.`);
      }
    }
  }

  if (registration.counterbalance?.plannedPairsPerSequence !== 3) {
    fail(errors, "counterbalance.plannedPairsPerSequence must be 3.");
  }

  const tasks = registration.tasks;
  if (!Array.isArray(tasks) || tasks.length !== 2) {
    fail(errors, "tasks must contain exactly two matched tasks.");
  } else {
    const ids = tasks.map((task) => task?.taskId);
    if (!unique(ids) || !ids.every(nonEmptyString)) {
      fail(errors, "task ids must be unique non-empty strings.");
    }
    for (const task of tasks) {
      if (!nonEmptyString(task?.title)) {
        fail(errors, `task ${task?.taskId ?? "?"} requires title.`);
      }
      if (!nonEmptyString(task?.brief)) {
        fail(errors, `task ${task?.taskId ?? "?"} requires brief.`);
      }
      if (!nonEmptyString(task?.matchedRationale)) {
        fail(errors, `task ${task?.taskId ?? "?"} requires matchedRationale.`);
      }
    }
    if (Array.isArray(sequences) && sequences.length === 2) {
      const registered = new Set(ids);
      for (const sequence of sequences) {
        for (const assignment of sequence.assignments ?? []) {
          if (!registered.has(assignment?.taskId)) {
            fail(errors, `sequence ${sequence.id} references unregistered task ${assignment?.taskId}.`);
          }
        }
      }
    }
  }

  const rubric = registration.artifactScoring;
  if (!nonEmptyString(rubric?.rubricId)) {
    fail(errors, "artifactScoring.rubricId is required.");
  }
  if (!Array.isArray(rubric?.dimensions) || rubric.dimensions.length < 2) {
    fail(errors, "artifactScoring.dimensions must contain at least two dimensions.");
  } else {
    const dimensionIds = rubric.dimensions.map((item) => item?.id);
    if (!unique(dimensionIds) || !dimensionIds.every(nonEmptyString)) {
      fail(errors, "artifact scoring dimension ids must be unique non-empty strings.");
    }
    for (const dimension of rubric.dimensions) {
      if (!nonEmptyString(dimension?.description)) {
        fail(errors, `artifact scoring dimension ${dimension?.id ?? "?"} requires description.`);
      }
      if (dimension?.min !== 1 || dimension?.max !== 5) {
        fail(errors, `artifact scoring dimension ${dimension?.id ?? "?"} must use the 1–5 scale.`);
      }
    }
  }

  const retention = registration.retention ?? {};
  for (const key of [
    "audioRecorded",
    "transcriptRetained",
    "structuredMetricsRetained",
    "acceptedArtifactsRetained",
    "baselineNotesRetainedThroughResumption"
  ]) {
    if (typeof retention[key] !== "boolean") {
      fail(errors, `retention.${key} must be boolean.`);
    }
  }

  if (!finiteNonNegative(registration.budget?.maxExternalSpendUsd)) {
    fail(errors, "budget.maxExternalSpendUsd must be a non-negative number.");
  }

  const worker = registration.worker ?? {};
  if (worker.mode !== "ollama-local") {
    fail(errors, "worker.mode must be ollama-local for the human pilot.");
  }
  if (!nonEmptyString(worker.model)) {
    fail(errors, "worker.model is required.");
  }
  if (!loopbackUrl(worker.endpoint)) {
    fail(errors, "worker.endpoint must be a loopback http(s) URL.");
  }
  if (worker.tools !== false) {
    fail(errors, "worker.tools must be false.");
  }
  if (worker.inputScope !== "work-prompt-only") {
    fail(errors, "worker.inputScope must be work-prompt-only.");
  }

  const governance = registration.governanceEvidence ?? {};
  if (governance.passed !== true) {
    fail(errors, "governanceEvidence.passed must be true.");
  }
  if (!nonEmptyString(governance.sourceRef)) {
    fail(errors, "governanceEvidence.sourceRef is required.");
  }

  const definitions = registration.operationalDefinitions ?? {};
  for (const key of [
    "usefulConcurrentResult",
    "reconstructionTime",
    "criticalFalseApproval",
    "acceptableDistraction",
    "preference"
  ]) {
    if (!nonEmptyString(definitions[key])) {
      fail(errors, `operationalDefinitions.${key} is required.`);
    }
  }

  if (launchReady && registration.status !== "launch-ready") {
    fail(errors, "status must be launch-ready.");
  }

  return {
    ok: errors.length === 0,
    launchReady: errors.length === 0 && registration.status === "launch-ready",
    errors
  };
}

function validateCondition(condition, label, dimensionIds, errors) {
  if (!condition || typeof condition !== "object") {
    fail(errors, `${label} condition is required.`);
    return;
  }
  if (!nonEmptyString(condition.taskId)) {
    fail(errors, `${label}.taskId is required.`);
  }
  if (!isoDate(condition.episodeDate)) {
    fail(errors, `${label}.episodeDate must be YYYY-MM-DD.`);
  }
  if (!isoDate(condition.resumption?.resumedOn)) {
    fail(errors, `${label}.resumption.resumedOn must be YYYY-MM-DD.`);
  } else if (
    isoDate(condition.episodeDate) &&
    condition.resumption.resumedOn <= condition.episodeDate
  ) {
    fail(errors, `${label} resumption must occur on a later calendar day.`);
  }
  if (!finiteNonNegative(condition.resumption?.reconstructionSeconds)) {
    fail(errors, `${label}.resumption.reconstructionSeconds must be non-negative.`);
  }
  if (!Number.isInteger(condition.resumption?.corrections) || condition.resumption.corrections < 0) {
    fail(errors, `${label}.resumption.corrections must be a non-negative integer.`);
  }

  if (!condition.artifactScores || typeof condition.artifactScores !== "object") {
    fail(errors, `${label}.artifactScores are required.`);
  } else {
    for (const id of dimensionIds) {
      const score = condition.artifactScores[id];
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        fail(errors, `${label}.artifactScores.${id} must be an integer from 1 to 5.`);
      }
    }
  }
}

export function validatePairResult(result, registration) {
  const errors = [];

  if (!result || typeof result !== "object") {
    return { ok: false, errors: ["Pair result must be an object."] };
  }
  if (result.schema !== RESULT_SCHEMA) {
    fail(errors, `schema must be ${RESULT_SCHEMA}.`);
  }
  if (!["human-pilot", "synthetic"].includes(result.evidenceClass)) {
    fail(errors, "evidenceClass must be human-pilot or synthetic.");
  }
  if (!nonEmptyString(result.pilotId)) {
    fail(errors, "pilotId is required.");
  }
  if (!/^pair-\d{2}$/.test(result.pairId ?? "")) {
    fail(errors, "pairId must use the form pair-01.");
  }
  if (!nonEmptyString(result.sequenceId)) {
    fail(errors, "sequenceId is required.");
  }
  if (!PREFERENCES.includes(result.preference)) {
    fail(errors, "preference must be commonline, baseline, or no-preference.");
  }

  if (registration) {
    if (result.pilotId !== registration.pilotId) {
      fail(errors, "pilotId does not match the registration.");
    }
    const sequence = registration.counterbalance?.sequences?.find(
      (candidate) => candidate.id === result.sequenceId
    );
    if (!sequence) {
      fail(errors, "sequenceId is not registered.");
    } else {
      for (const assignment of sequence.assignments) {
        if (result.conditions?.[assignment.condition]?.taskId !== assignment.taskId) {
          fail(
            errors,
            `${assignment.condition}.taskId does not match registered sequence ${sequence.id}.`
          );
        }
      }
    }
  }

  const dimensionIds =
    registration?.artifactScoring?.dimensions?.map((item) => item.id) ??
    Object.keys(result.conditions?.commonline?.artifactScores ?? {});

  validateCondition(
    result.conditions?.commonline,
    "conditions.commonline",
    dimensionIds,
    errors
  );
  validateCondition(
    result.conditions?.baseline,
    "conditions.baseline",
    dimensionIds,
    errors
  );

  const commonline = result.conditions?.commonline;
  if (typeof commonline?.episode?.resultArrivedBeforeEnd !== "boolean") {
    fail(errors, "conditions.commonline.episode.resultArrivedBeforeEnd must be boolean.");
  }
  if (typeof commonline?.episode?.resultUsedBeforeEnd !== "boolean") {
    fail(errors, "conditions.commonline.episode.resultUsedBeforeEnd must be boolean.");
  }

  const fidelity = commonline?.fidelity ?? {};
  if (!Number.isInteger(fidelity.criticalFalseApprovals) || fidelity.criticalFalseApprovals < 0) {
    fail(errors, "conditions.commonline.fidelity.criticalFalseApprovals must be a non-negative integer.");
  }
  if (!Number.isInteger(fidelity.lesserMistakesObserved) || fidelity.lesserMistakesObserved < 0) {
    fail(errors, "conditions.commonline.fidelity.lesserMistakesObserved must be a non-negative integer.");
  }
  if (!Number.isInteger(fidelity.lesserMistakesCorrected) || fidelity.lesserMistakesCorrected < 0) {
    fail(errors, "conditions.commonline.fidelity.lesserMistakesCorrected must be a non-negative integer.");
  }
  if (
    Number.isInteger(fidelity.lesserMistakesObserved) &&
    Number.isInteger(fidelity.lesserMistakesCorrected) &&
    fidelity.lesserMistakesCorrected > fidelity.lesserMistakesObserved
  ) {
    fail(errors, "lesserMistakesCorrected cannot exceed lesserMistakesObserved.");
  }

  const attention = commonline?.attention ?? {};
  if (typeof attention.acceptableDistraction !== "boolean") {
    fail(errors, "conditions.commonline.attention.acceptableDistraction must be boolean.");
  }
  if (typeof attention.silenceStopControlsOk !== "boolean") {
    fail(errors, "conditions.commonline.attention.silenceStopControlsOk must be boolean.");
  }

  if (!Array.isArray(result.protocolDeviations)) {
    fail(errors, "protocolDeviations must be an array.");
  } else if (!result.protocolDeviations.every((item) => nonEmptyString(item))) {
    fail(errors, "protocolDeviations entries must be non-empty strings.");
  }

  return { ok: errors.length === 0, errors };
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizePilot(registration, results, options = {}) {
  const registrationValidation = validateRegistration(registration, {
    launchReady: true
  });
  if (!registrationValidation.ok) {
    throw new Error(
      `Registration is not launch-ready: ${registrationValidation.errors.join(" ")}`
    );
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("At least one pair result is required.");
  }

  const validated = results.map((result) => ({
    result,
    validation: validatePairResult(result, registration)
  }));
  const invalid = validated.filter((item) => !item.validation.ok);
  if (invalid.length > 0) {
    throw new Error(
      invalid
        .map(
          (item) =>
            `${item.result?.pairId ?? "unknown"}: ${item.validation.errors.join(" ")}`
        )
        .join("\n")
    );
  }

  const containsSynthetic = results.some(
    (result) => result.evidenceClass === "synthetic"
  );
  if (containsSynthetic && options.allowSynthetic !== true) {
    throw new Error(
      "Synthetic fixtures cannot be summarized as human evidence. Pass allowSynthetic only for tooling tests."
    );
  }

  const pairIds = results.map((result) => result.pairId);
  if (!unique(pairIds)) {
    throw new Error("Pair result ids must be unique.");
  }

  const usefulConcurrent = results.filter((result) => {
    const episode = result.conditions.commonline.episode;
    return (
      episode.resultArrivedBeforeEnd === true &&
      episode.resultUsedBeforeEnd === true
    );
  }).length;

  const resumptionBetter = results.filter(
    (result) =>
      result.conditions.commonline.resumption.reconstructionSeconds <
      result.conditions.baseline.resumption.reconstructionSeconds
  ).length;

  const commonlinePreference = results.filter(
    (result) => result.preference === "commonline"
  ).length;

  const criticalFalseApprovals = results.reduce(
    (sum, result) =>
      sum +
      result.conditions.commonline.fidelity.criticalFalseApprovals,
    0
  );

  const lesserObserved = results.reduce(
    (sum, result) =>
      sum +
      result.conditions.commonline.fidelity.lesserMistakesObserved,
    0
  );
  const lesserCorrected = results.reduce(
    (sum, result) =>
      sum +
      result.conditions.commonline.fidelity.lesserMistakesCorrected,
    0
  );

  const acceptableAttentionPairs = results.filter(
    (result) =>
      result.conditions.commonline.attention.acceptableDistraction &&
      result.conditions.commonline.attention.silenceStopControlsOk
  ).length;

  const sequenceCounts = Object.fromEntries(
    registration.counterbalance.sequences.map((sequence) => [
      sequence.id,
      results.filter((result) => result.sequenceId === sequence.id).length
    ])
  );

  const completeHumanPilot =
    results.length === registration.protocol.pairCount &&
    !containsSynthetic &&
    Object.values(sequenceCounts).every(
      (count) =>
        count === registration.counterbalance.plannedPairsPerSequence
    );

  const dimensions = registration.artifactScoring.dimensions.map(
    (dimension) => {
      const commonlineScores = results.map(
        (result) =>
          result.conditions.commonline.artifactScores[dimension.id]
      );
      const baselineScores = results.map(
        (result) =>
          result.conditions.baseline.artifactScores[dimension.id]
      );
      return {
        id: dimension.id,
        commonlineMean: mean(commonlineScores),
        baselineMean: mean(baselineScores)
      };
    }
  );

  const gates = {
    usefulConcurrentResult: {
      observedPairs: usefulConcurrent,
      requiredPairs: registration.thresholds.usefulConcurrentPairs,
      pass:
        completeHumanPilot &&
        usefulConcurrent >= registration.thresholds.usefulConcurrentPairs
    },
    resumption: {
      observedPairs: resumptionBetter,
      requiredPairs: registration.thresholds.resumptionBetterPairs,
      pass:
        completeHumanPilot &&
        resumptionBetter >= registration.thresholds.resumptionBetterPairs
    },
    preference: {
      observedPairs: commonlinePreference,
      requiredPairs: registration.thresholds.preferenceCommonlinePairs,
      pass:
        completeHumanPilot &&
        commonlinePreference >=
          registration.thresholds.preferenceCommonlinePairs
    },
    retainedStateFidelity: {
      criticalFalseApprovals,
      lesserMistakesObserved: lesserObserved,
      lesserMistakesCorrected: lesserCorrected,
      pass:
        completeHumanPilot &&
        criticalFalseApprovals <=
          registration.thresholds.criticalFalseApprovalsMax &&
        lesserObserved === lesserCorrected
    },
    attention: {
      acceptablePairs: acceptableAttentionPairs,
      requiredPairs: registration.protocol.pairCount,
      pass:
        completeHumanPilot &&
        acceptableAttentionPairs === registration.protocol.pairCount
    },
    governance: {
      sourceRef: registration.governanceEvidence.sourceRef,
      pass: registration.governanceEvidence.passed === true
    }
  };

  return {
    schema: SUMMARY_SCHEMA,
    pilotId: registration.pilotId,
    evidenceClass: containsSynthetic ? "synthetic" : "human-pilot",
    decisionEligible: completeHumanPilot && !containsSynthetic,
    pairCountObserved: results.length,
    pairCountPlanned: registration.protocol.pairCount,
    sequenceCounts,
    descriptive: {
      usefulConcurrentPairs: usefulConcurrent,
      resumptionBetterPairs: resumptionBetter,
      commonlinePreferencePairs: commonlinePreference,
      criticalFalseApprovals,
      lesserMistakesObserved: lesserObserved,
      lesserMistakesCorrected: lesserCorrected,
      acceptableAttentionPairs,
      reconstructionSeconds: {
        commonlineMean: mean(
          results.map(
            (result) =>
              result.conditions.commonline.resumption.reconstructionSeconds
          )
        ),
        baselineMean: mean(
          results.map(
            (result) =>
              result.conditions.baseline.resumption.reconstructionSeconds
          )
        )
      },
      artifactScores: dimensions
    },
    gates,
    allCandidateGatesPass:
      completeHumanPilot &&
      Object.values(gates).every((gate) => gate.pass === true),
    note:
      "Exploratory pilot counts are descriptive decision aids, not population-level inference."
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

async function cli(argv) {
  const [command, ...args] = argv;

  if (command === "validate-registration") {
    const path = args.find((arg) => !arg.startsWith("--"));
    if (!path) throw new Error("Registration path is required.");
    const result = validateRegistration(readJson(path), {
      launchReady: args.includes("--launch-ready")
    });
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "validate-result") {
    const paths = args.filter((arg) => !arg.startsWith("--"));
    if (paths.length < 1) throw new Error("Result path is required.");
    const registrationFlag = args.indexOf("--registration");
    const registration =
      registrationFlag >= 0
        ? readJson(args[registrationFlag + 1])
        : undefined;
    const result = validatePairResult(readJson(paths[0]), registration);
    print(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "summarize") {
    if (args.length < 2) {
      throw new Error(
        "Usage: summarize <registration.json> <pair-result.json>... [--allow-synthetic]"
      );
    }
    const allowSynthetic = args.includes("--allow-synthetic");
    const paths = args.filter((arg) => !arg.startsWith("--"));
    const registration = readJson(paths[0]);
    const results = paths.slice(1).map(readJson);
    print(
      summarizePilot(registration, results, {
        allowSynthetic
      })
    );
    return;
  }

  throw new Error(
    "Commands: validate-registration, validate-result, summarize"
  );
}

const isDirect =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + "\n"
    );
    process.exitCode = 1;
  });
}
