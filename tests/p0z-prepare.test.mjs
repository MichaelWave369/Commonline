import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildExecutionPack,
  registrationFingerprint,
  writeExecutionPack
} from "../scripts/p0z-prepare.mjs";
import {
  taskFingerprint,
  validatePairResult
} from "../scripts/p0x-pilot.mjs";
import {
  finalizeRegistration
} from "../scripts/p0y-qualify.mjs";

function launchRegistration() {
  const candidate = JSON.parse(
    readFileSync(
      new URL(
        "../experiments/p0y/registration.candidate.json",
        import.meta.url
      ),
      "utf8"
    )
  );

  const digest = "d".repeat(64);
  const receipt = {
    schema: "p0-y.qualification.1",
    passed: true,
    pilotId: candidate.pilotId,
    qualifiedAt: "2026-10-02T05:00:00.000Z",
    endpoint: "http://127.0.0.1:11434",
    model: candidate.worker.model,
    modelDigest: digest,
    numCtx: candidate.worker.numCtx,
    contract: {
      stream: false,
      think: false,
      format: "json",
      numCtx: candidate.worker.numCtx,
      tools: false,
      inputScope: "work-prompt-only"
    },
    maxQualificationLatencyMs:
      candidate.worker.maxQualificationLatencyMs,
    tasks: candidate.tasks.map((task) => ({
      taskId: task.taskId,
      taskHash: taskFingerprint(task),
      requestHash: "e".repeat(64),
      wallMs: 1000,
      ollamaTotalDurationMs: 900,
      promptEvalCount: 100,
      evalCount: 50,
      artifact: {
        titleLength: 20,
        bodyLength: 300
      }
    }))
  };

  return finalizeRegistration(candidate, receipt);
}

test("P0-z alternates A/B allocation across all six pairs", () => {
  const registration = launchRegistration();
  const pack = buildExecutionPack(registration);

  assert.equal(pack.pairCount, 6);
  assert.deepEqual(
    pack.pairs.map((pair) => [
      pair.pairId,
      pair.sequenceId
    ]),
    [
      ["pair-01", "A"],
      ["pair-02", "B"],
      ["pair-03", "A"],
      ["pair-04", "B"],
      ["pair-05", "A"],
      ["pair-06", "B"]
    ]
  );
  assert.deepEqual(pack.sequenceCounts, {
    A: 3,
    B: 3
  });
});

test("P0-z pair packets preserve registered period, condition, and task assignment", () => {
  const registration = launchRegistration();
  const pack = buildExecutionPack(registration);

  const pair01 = pack.pairs[0].assignment;
  assert.deepEqual(
    pair01.periods.map((period) => [
      period.period,
      period.condition,
      period.task.taskId
    ]),
    [
      [1, "commonline", "task-a"],
      [2, "baseline", "task-b"]
    ]
  );

  const pair02 = pack.pairs[1].assignment;
  assert.deepEqual(
    pair02.periods.map((period) => [
      period.period,
      period.condition,
      period.task.taskId
    ]),
    [
      [1, "baseline", "task-a"],
      [2, "commonline", "task-b"]
    ]
  );

  assert.equal(
    pair01.worker.modelDigest,
    registration.worker.modelDigest
  );
  assert.equal(pair01.worker.numCtx, 4096);
});

test("P0-z binds every packet to the exact launch registration hash", () => {
  const registration = launchRegistration();
  const pack = buildExecutionPack(registration);
  const expected =
    registrationFingerprint(registration);

  assert.equal(pack.registrationHash, expected);
  for (const pair of pack.pairs) {
    assert.equal(
      pair.assignment.registrationHash,
      expected
    );
    assert.equal(
      pair.resultDraft.registrationHash,
      expected
    );
  }
});

test("P0-z result drafts cannot validate as observed evidence before humans fill them", () => {
  const registration = launchRegistration();
  const pack = buildExecutionPack(registration);

  for (const pair of pack.pairs) {
    const validation = validatePairResult(
      pair.resultDraft,
      registration
    );
    assert.equal(validation.ok, false);
    assert.match(
      validation.errors.join(" "),
      /episodeDate|boolean|reconstructionSeconds|preference/
    );
  }
});

test("P0-z refuses a qualification-pending registration", () => {
  const candidate = JSON.parse(
    readFileSync(
      new URL(
        "../experiments/p0y/registration.candidate.json",
        import.meta.url
      ),
      "utf8"
    )
  );

  assert.throws(
    () => buildExecutionPack(candidate),
    /launch-ready registration/
  );
});

test("P0-z writes one manifest plus assignment and result-draft files for all six pairs", () => {
  const registration = launchRegistration();
  const pack = buildExecutionPack(registration);
  const dir = mkdtempSync(
    join(tmpdir(), "commonline-p0z-")
  );

  try {
    writeExecutionPack(pack, dir);
    const files = readdirSync(dir).sort();

    assert.equal(files.length, 13);
    assert.ok(files.includes("manifest.json"));
    assert.ok(
      files.includes("pair-01.assignment.json")
    );
    assert.ok(
      files.includes("pair-06.result.draft.json")
    );

    const manifest = JSON.parse(
      readFileSync(
        join(dir, "manifest.json"),
        "utf8"
      )
    );
    assert.equal(
      manifest.registrationHash,
      pack.registrationHash
    );
    assert.equal(manifest.pairs.length, 6);
  } finally {
    rmSync(dir, {
      recursive: true,
      force: true
    });
  }
});
