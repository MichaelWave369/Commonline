import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  finalizeRegistration,
  qualifyRegistration
} from "../scripts/p0y-qualify.mjs";
import {
  taskFingerprint,
  validateRegistration
} from "../scripts/p0x-pilot.mjs";

function candidateRegistration() {
  return JSON.parse(
    readFileSync(
      new URL("../experiments/p0y/registration.candidate.json", import.meta.url),
      "utf8"
    )
  );
}

function fakeOllama(options = {}) {
  const digest =
    options.digest ??
    "b".repeat(64);
  let chatIndex = 0;
  const requests = [];

  const fetcher = async (input, init = {}) => {
    const url = String(input);
    requests.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined
    });

    if (url.endsWith("/api/tags")) {
      return new Response(
        JSON.stringify({
          models: options.models ?? [
            {
              name: "qwen3.6:latest",
              model: "qwen3.6:latest",
              digest,
              size: 23_000_000_000,
              details: {
                format: "gguf",
                family: "qwen3",
                parameter_size: "36B",
                quantization_level: "Q4_K_M"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    if (url.endsWith("/api/chat")) {
      chatIndex += 1;
      const invalid =
        options.invalidTaskIndex === chatIndex;

      return new Response(
        JSON.stringify({
          model: "qwen3.6:latest",
          message: {
            role: "assistant",
            content: invalid
              ? "not-json"
              : JSON.stringify({
                  title: `Qualified artifact ${chatIndex}`,
                  body:
                    chatIndex === 1
                      ? "A bounded comparison for workshop check-in."
                      : "A bounded comparison for equipment checkout."
                })
          },
          done: true,
          total_duration: 2_500_000_000,
          prompt_eval_count: 120,
          eval_count: 80
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    throw new Error(`Unexpected fake Ollama URL: ${url}`);
  };

  return { fetcher, requests, digest };
}

test("P0-y qualifies the exact registered local model against both frozen tasks", async () => {
  const registration = candidateRegistration();
  const fake = fakeOllama();

  const receipt = await qualifyRegistration(registration, {
    fetcher: fake.fetcher
  });

  assert.equal(receipt.schema, "p0-y.qualification.1");
  assert.equal(receipt.passed, true);
  assert.equal(receipt.model, "qwen3.6:latest");
  assert.equal(receipt.modelDigest, fake.digest);
  assert.equal(receipt.tasks.length, 2);
  assert.equal(
    receipt.tasks[0].taskHash,
    taskFingerprint(registration.tasks[0])
  );
  assert.equal(
    receipt.tasks[1].taskHash,
    taskFingerprint(registration.tasks[1])
  );

  const chats = fake.requests.filter(
    (request) => request.url.endsWith("/api/chat")
  );
  assert.equal(chats.length, 2);

  for (const chat of chats) {
    assert.equal(chat.body.model, "qwen3.6:latest");
    assert.equal(chat.body.stream, false);
    assert.equal(chat.body.think, false);
    assert.equal(chat.body.format, "json");
    assert.equal("tools" in chat.body, false);
    assert.deepEqual(
      chat.body.messages.map((message) => message.role),
      ["system", "user"]
    );
  }

  assert.equal(
    chats[0].body.messages[1].content,
    registration.tasks[0].brief
  );
  assert.equal(
    chats[1].body.messages[1].content,
    registration.tasks[1].brief
  );
});

test("P0-y finalization binds model digest and qualification receipt into launch registration", async () => {
  const registration = candidateRegistration();
  const fake = fakeOllama();
  const receipt = await qualifyRegistration(registration, {
    fetcher: fake.fetcher
  });

  const finalized = finalizeRegistration(
    registration,
    receipt
  );

  assert.equal(finalized.status, "launch-ready");
  assert.equal(
    finalized.worker.modelDigest,
    fake.digest
  );
  assert.equal(
    finalized.worker.qualificationReceipt.schema,
    "p0-y.qualification.1"
  );

  const validation = validateRegistration(finalized, {
    launchReady: true
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.launchReady, true);
});

test("P0-y refuses a stale receipt after a registered task changes", async () => {
  const registration = candidateRegistration();
  const fake = fakeOllama();
  const receipt = await qualifyRegistration(registration, {
    fetcher: fake.fetcher
  });

  registration.tasks[0].brief +=
    " This edit happened after qualification.";

  assert.throws(
    () => finalizeRegistration(registration, receipt),
    /task hash does not match task-a/
  );
});

test("P0-y refuses qualification when the exact registered model is not installed", async () => {
  const registration = candidateRegistration();
  const fake = fakeOllama({
    models: [
      {
        name: "another-model:latest",
        model: "another-model:latest",
        digest: "c".repeat(64)
      }
    ]
  });

  await assert.rejects(
    () =>
      qualifyRegistration(registration, {
        fetcher: fake.fetcher
      }),
    /qwen3.6:latest is not installed/
  );
});

test("P0-y refuses provider output that violates the bounded JSON artifact contract", async () => {
  const registration = candidateRegistration();
  const fake = fakeOllama({
    invalidTaskIndex: 2
  });

  await assert.rejects(
    () =>
      qualifyRegistration(registration, {
        fetcher: fake.fetcher
      }),
    /task-b was not valid JSON/
  );
});
