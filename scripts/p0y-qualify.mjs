import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  taskFingerprint,
  validateRegistration
} from "./p0x-pilot.mjs";

export const QUALIFICATION_SCHEMA = "p0-y.qualification.1";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function fail(message) {
  throw new Error(message);
}

function exactModel(models, modelName) {
  return models.find(
    (candidate) =>
      candidate?.name === modelName || candidate?.model === modelName
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArtifact(content, taskId) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    fail(`Qualification output for ${taskId} was not valid JSON.`);
  }

  if (!parsed || typeof parsed !== "object") {
    fail(`Qualification output for ${taskId} was not a JSON object.`);
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";

  if (!title || title.length > 120) {
    fail(`Qualification title for ${taskId} is empty or exceeds 120 characters.`);
  }
  if (!body || body.length > 6000) {
    fail(`Qualification body for ${taskId} is empty or exceeds 6000 characters.`);
  }

  return { title, body };
}

function systemPrompt() {
  return (
    "You are Vessie, a silent worker inside a governed collaboration room. " +
    "You receive only one explicitly submitted bounded task. " +
    "Return exactly one useful draft artifact as JSON with string fields title and body. " +
    "Do not claim you executed external actions, contacted anyone, used tools, heard live conversation, " +
    "or accessed room history. Keep the artifact concise, inspectable, and directly responsive to the task."
  );
}

export function buildQualificationRequest(model, prompt) {
  return {
    model,
    stream: false,
    think: false,
    format: "json",
    messages: [
      {
        role: "system",
        content: systemPrompt()
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };
}

async function fetchJson(fetcher, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: controller.signal
    });

    if (!response.ok) {
      fail(`Qualification HTTP ${response.status} from ${url}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function endpointUrls(endpoint) {
  const base = new URL(endpoint);
  return {
    tags: new URL("/api/tags", base),
    chat: new URL("/api/chat", base)
  };
}

export async function qualifyRegistration(
  registration,
  options = {}
) {
  const registrationCheck = validateRegistration(registration);
  if (!registrationCheck.ok) {
    fail(
      "Candidate registration is invalid: " +
        registrationCheck.errors.join(" ")
    );
  }

  if (registration.status !== "qualification-pending") {
    fail("Candidate registration status must be qualification-pending.");
  }

  const fetcher = options.fetcher ?? fetch;
  const worker = registration.worker;
  const urls = endpointUrls(worker.endpoint);

  const tags = await fetchJson(
    fetcher,
    urls.tags,
    { method: "GET" },
    Math.min(worker.maxQualificationLatencyMs, 30_000)
  );

  const model = exactModel(tags.models ?? [], worker.model);
  if (!model) {
    fail(`Registered model ${worker.model} is not installed at the qualified Ollama endpoint.`);
  }

  const digest = model.digest;
  if (
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/i.test(digest)
  ) {
    fail("Installed model did not expose a 64-character digest.");
  }

  const taskReceipts = [];

  for (const task of registration.tasks) {
    const requestBody = buildQualificationRequest(
      worker.model,
      task.brief
    );

    const started = performance.now();
    const response = await fetchJson(
      fetcher,
      urls.chat,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody)
      },
      worker.maxQualificationLatencyMs
    );
    const wallMs = Math.round(performance.now() - started);

    if (wallMs > worker.maxQualificationLatencyMs) {
      fail(
        `Qualification for ${task.taskId} exceeded the registered latency limit.`
      );
    }

    const content = response?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      fail(`Qualification for ${task.taskId} returned no assistant content.`);
    }

    const artifact = parseArtifact(content, task.taskId);
    taskReceipts.push({
      taskId: task.taskId,
      taskHash: taskFingerprint(task),
      requestHash: sha256(JSON.stringify(requestBody)),
      wallMs,
      ollamaTotalDurationMs:
        Number.isFinite(response.total_duration)
          ? Math.round(response.total_duration / 1_000_000)
          : null,
      promptEvalCount:
        Number.isFinite(response.prompt_eval_count)
          ? response.prompt_eval_count
          : null,
      evalCount:
        Number.isFinite(response.eval_count)
          ? response.eval_count
          : null,
      artifact: {
        titleLength: artifact.title.length,
        bodyLength: artifact.body.length
      }
    });
  }

  return {
    schema: QUALIFICATION_SCHEMA,
    passed: true,
    pilotId: registration.pilotId,
    qualifiedAt: new Date().toISOString(),
    endpoint: new URL(worker.endpoint).origin,
    model: worker.model,
    modelDigest: digest,
    contract: {
      stream: false,
      think: false,
      format: "json",
      tools: false,
      inputScope: "work-prompt-only"
    },
    maxQualificationLatencyMs: worker.maxQualificationLatencyMs,
    tasks: taskReceipts
  };
}

export function finalizeRegistration(
  registration,
  receipt
) {
  if (receipt?.schema !== QUALIFICATION_SCHEMA || receipt.passed !== true) {
    fail("A passing P0-y qualification receipt is required.");
  }

  if (receipt.pilotId !== registration.pilotId) {
    fail("Qualification receipt pilotId does not match registration.");
  }

  if (receipt.model !== registration.worker?.model) {
    fail("Qualification receipt model does not match registration.");
  }

  if (
    new URL(receipt.endpoint).origin !==
    new URL(registration.worker.endpoint).origin
  ) {
    fail("Qualification receipt endpoint does not match registration.");
  }

  for (const task of registration.tasks) {
    const qualified = receipt.tasks?.find(
      (candidate) => candidate.taskId === task.taskId
    );
    if (!qualified) {
      fail(`Qualification receipt is missing ${task.taskId}.`);
    }
    if (qualified.taskHash !== taskFingerprint(task)) {
      fail(`Qualification receipt task hash does not match ${task.taskId}.`);
    }
    if (
      !Number.isFinite(qualified.wallMs) ||
      qualified.wallMs > registration.worker.maxQualificationLatencyMs
    ) {
      fail(`Qualification latency for ${task.taskId} is outside the registered limit.`);
    }
  }

  const finalized = structuredClone(registration);
  finalized.status = "launch-ready";
  finalized.worker.modelDigest = receipt.modelDigest;
  finalized.worker.qualificationReceipt = receipt;

  const validation = validateRegistration(finalized, {
    launchReady: true
  });
  if (!validation.ok) {
    fail(
      "Finalized registration failed launch validation: " +
        validation.errors.join(" ")
    );
  }

  return finalized;
}

async function cli(argv) {
  const [command, ...args] = argv;

  if (command === "qualify") {
    const registrationPath = args.find(
      (arg) => !arg.startsWith("--")
    );
    const outIndex = args.indexOf("--out");
    const outPath =
      outIndex >= 0 ? args[outIndex + 1] : undefined;

    if (!registrationPath || !outPath) {
      fail(
        "Usage: qualify <registration.candidate.json> --out <qualification.json>"
      );
    }

    const receipt = await qualifyRegistration(
      readJson(registrationPath)
    );
    writeJson(outPath, receipt);
    process.stdout.write(
      `P0-y qualification PASS -> ${outPath}\n`
    );
    return;
  }

  if (command === "finalize") {
    const positional = args.filter(
      (arg) => !arg.startsWith("--")
    );
    const outIndex = args.indexOf("--out");
    const outPath =
      outIndex >= 0 ? args[outIndex + 1] : undefined;

    if (positional.length < 2 || !outPath) {
      fail(
        "Usage: finalize <registration.candidate.json> <qualification.json> --out <registration.launch.json>"
      );
    }

    const finalized = finalizeRegistration(
      readJson(positional[0]),
      readJson(positional[1])
    );
    writeJson(outPath, finalized);
    process.stdout.write(
      `P0-y launch registration PASS -> ${outPath}\n`
    );
    return;
  }

  fail("Commands: qualify, finalize");
}

const isDirect =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  cli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) +
        "\n"
    );
    process.exitCode = 1;
  });
}
