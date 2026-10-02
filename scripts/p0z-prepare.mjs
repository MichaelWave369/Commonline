import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  registrationFingerprint,
  validateRegistration
} from "./p0x-pilot.mjs";

export const EXECUTION_PACK_SCHEMA = "p0-z.execution-pack.1";
export const ASSIGNMENT_SCHEMA = "p0-z.pair-assignment.1";

const PAIR_SEQUENCE_PLAN = [
  ["pair-01", "A"],
  ["pair-02", "B"],
  ["pair-03", "A"],
  ["pair-04", "B"],
  ["pair-05", "A"],
  ["pair-06", "B"]
];

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function scoreDraft(registration) {
  return Object.fromEntries(
    registration.artifactScoring.dimensions.map(
      (dimension) => [dimension.id, null]
    )
  );
}

function taskById(registration, taskId) {
  const task = registration.tasks.find(
    (candidate) => candidate.taskId === taskId
  );
  if (!task) {
    fail(`Registered task not found: ${taskId}`);
  }
  return task;
}

function sequenceById(registration, sequenceId) {
  const sequence = registration.counterbalance.sequences.find(
    (candidate) => candidate.id === sequenceId
  );
  if (!sequence) {
    fail(`Registered sequence not found: ${sequenceId}`);
  }
  return sequence;
}

export function buildPairAssignment(
  registration,
  pairId,
  sequenceId,
  registrationHash
) {
  const sequence = sequenceById(registration, sequenceId);
  const periods = [...sequence.assignments]
    .sort((a, b) => a.period - b.period)
    .map((assignment) => {
      const task = taskById(
        registration,
        assignment.taskId
      );
      return {
        period: assignment.period,
        condition: assignment.condition,
        task: {
          taskId: task.taskId,
          title: task.title,
          brief: task.brief
        }
      };
    });

  return {
    schema: ASSIGNMENT_SCHEMA,
    pilotId: registration.pilotId,
    registrationHash,
    pairId,
    sequenceId,
    episodeMinutes: registration.protocol.episodeMinutes,
    resumeTiming: registration.protocol.resumeTiming,
    baseline: registration.protocol.baseline,
    worker: {
      mode: registration.worker.mode,
      model: registration.worker.model,
      modelDigest: registration.worker.modelDigest,
      endpoint: registration.worker.endpoint,
      numCtx: registration.worker.numCtx,
      tools: registration.worker.tools,
      inputScope: registration.worker.inputScope
    },
    artifactScoring: registration.artifactScoring,
    periods
  };
}

export function buildResultDraft(
  registration,
  pairId,
  sequenceId,
  registrationHash
) {
  const sequence = sequenceById(registration, sequenceId);
  const commonlineAssignment = sequence.assignments.find(
    (assignment) => assignment.condition === "commonline"
  );
  const baselineAssignment = sequence.assignments.find(
    (assignment) => assignment.condition === "baseline"
  );

  if (!commonlineAssignment || !baselineAssignment) {
    fail(
      `Sequence ${sequenceId} must contain commonline and baseline assignments.`
    );
  }

  return {
    schema: "p0-x.pair-result.1",
    evidenceClass: "human-pilot",
    draftStatus: "pending-observation",
    pilotId: registration.pilotId,
    registrationHash,
    pairId,
    sequenceId,
    conditions: {
      commonline: {
        taskId: commonlineAssignment.taskId,
        episodeDate: null,
        episode: {
          resultArrivedBeforeEnd: null,
          resultUsedBeforeEnd: null
        },
        resumption: {
          resumedOn: null,
          reconstructionSeconds: null,
          corrections: null
        },
        fidelity: {
          criticalFalseApprovals: null,
          lesserMistakesObserved: null,
          lesserMistakesCorrected: null
        },
        attention: {
          acceptableDistraction: null,
          silenceStopControlsOk: null
        },
        artifactScores: scoreDraft(registration)
      },
      baseline: {
        taskId: baselineAssignment.taskId,
        episodeDate: null,
        resumption: {
          resumedOn: null,
          reconstructionSeconds: null,
          corrections: null
        },
        artifactScores: scoreDraft(registration)
      }
    },
    preference: null,
    protocolDeviations: []
  };
}

export function buildExecutionPack(registration) {
  const validation = validateRegistration(
    registration,
    { launchReady: true }
  );
  if (!validation.ok) {
    fail(
      "P0-z requires a launch-ready registration: " +
        validation.errors.join(" ")
    );
  }

  const registrationHash =
    registrationFingerprint(registration);

  const pairs = PAIR_SEQUENCE_PLAN.map(
    ([pairId, sequenceId]) => {
      const assignment = buildPairAssignment(
        registration,
        pairId,
        sequenceId,
        registrationHash
      );
      const resultDraft = buildResultDraft(
        registration,
        pairId,
        sequenceId,
        registrationHash
      );
      return {
        pairId,
        sequenceId,
        assignment,
        resultDraft
      };
    }
  );

  return {
    schema: EXECUTION_PACK_SCHEMA,
    pilotId: registration.pilotId,
    registrationHash,
    generatedAt: new Date().toISOString(),
    pairCount: pairs.length,
    sequenceCounts: {
      A: pairs.filter(
        (pair) => pair.sequenceId === "A"
      ).length,
      B: pairs.filter(
        (pair) => pair.sequenceId === "B"
      ).length
    },
    allocation: "alternating-fixed-before-pair-01",
    pairs
  };
}

export function writeExecutionPack(pack, outDir) {
  mkdirSync(outDir, { recursive: true });

  writeJson(
    join(outDir, "manifest.json"),
    {
      schema: pack.schema,
      pilotId: pack.pilotId,
      registrationHash: pack.registrationHash,
      generatedAt: pack.generatedAt,
      pairCount: pack.pairCount,
      sequenceCounts: pack.sequenceCounts,
      allocation: pack.allocation,
      pairs: pack.pairs.map((pair) => ({
        pairId: pair.pairId,
        sequenceId: pair.sequenceId,
        assignmentFile:
          `${pair.pairId}.assignment.json`,
        resultDraftFile:
          `${pair.pairId}.result.draft.json`
      }))
    }
  );

  for (const pair of pack.pairs) {
    writeJson(
      join(
        outDir,
        `${pair.pairId}.assignment.json`
      ),
      pair.assignment
    );
    writeJson(
      join(
        outDir,
        `${pair.pairId}.result.draft.json`
      ),
      pair.resultDraft
    );
  }
}

async function cli(argv) {
  const [command, ...args] = argv;

  if (command !== "prepare") {
    fail(
      "Usage: prepare <registration.launch.json> --out <execution-dir>"
    );
  }

  const registrationPath = args.find(
    (arg) => !arg.startsWith("--")
  );
  const outIndex = args.indexOf("--out");
  const outDir =
    outIndex >= 0 ? args[outIndex + 1] : undefined;

  if (!registrationPath || !outDir) {
    fail(
      "Usage: prepare <registration.launch.json> --out <execution-dir>"
    );
  }

  const registration = readJson(registrationPath);
  const pack = buildExecutionPack(registration);
  writeExecutionPack(pack, outDir);

  process.stdout.write(
    `P0-z execution pack READY -> ${outDir}\n` +
      `registrationHash=${pack.registrationHash}\n` +
      "allocation=pair-01:A,pair-02:B,pair-03:A,pair-04:B,pair-05:A,pair-06:B\n"
  );
}

const isDirect =
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(process.argv[1]).href;

if (isDirect) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      (error instanceof Error
        ? error.message
        : String(error)) + "\n"
    );
    process.exitCode = 1;
  });
}
