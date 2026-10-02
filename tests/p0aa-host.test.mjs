import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPilotHostEnv,
  detectLanIpv4,
  verifyRegisteredWorkerDigest
} from "../scripts/p0aa-host.mjs";
import {
  finalizeRegistration
} from "../scripts/p0y-qualify.mjs";
import {
  taskFingerprint
} from "../scripts/p0x-pilot.mjs";

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

  const digest = "f".repeat(64);
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
      requestHash: "a".repeat(64),
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

test("P0-aa LAN detection prefers a physical private adapter over VirtualBox", () => {
  const detected = detectLanIpv4({
    "VirtualBox Host-Only Network": [
      {
        address: "192.168.56.1",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "192.168.56.1/24"
      }
    ],
    "Wi-Fi": [
      {
        address: "192.168.1.42",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:02",
        internal: false,
        cidr: "192.168.1.42/24"
      }
    ]
  });

  assert.equal(detected, "192.168.1.42");
});

test("P0-aa host env is bound to the finalized pilot registration", () => {
  const registration = launchRegistration();
  const env = buildPilotHostEnv({
    registration,
    pfxPath: "pilot-local/tls/commonline-pilot.pfx",
    pfxPassphrase: "secret",
    lanIp: "192.168.1.42",
    parentEnv: {
      PATH: "test-path"
    }
  });

  assert.equal(
    env.COMMONLINE_AGENT_MODE,
    "ollama-local"
  );
  assert.equal(
    env.COMMONLINE_OLLAMA_MODEL,
    registration.worker.model
  );
  assert.equal(
    env.COMMONLINE_OLLAMA_URL,
    registration.worker.endpoint
  );
  assert.equal(
    env.COMMONLINE_AGENT_NUM_CTX,
    "4096"
  );
  assert.equal(
    env.COMMONLINE_AGENT_TIMEOUT_MS,
    "120000"
  );
  assert.equal(
    env.COMMONLINE_PILOT_LAN_HOST,
    "true"
  );
  assert.equal(
    env.COMMONLINE_SFU_LISTEN_IP,
    "0.0.0.0"
  );
  assert.equal(
    env.COMMONLINE_SFU_ANNOUNCED_ADDRESS,
    "192.168.1.42"
  );
  assert.equal(
    env.VITE_COMMONLINE_WS_URL,
    ""
  );
  assert.equal(env.PATH, "test-path");
});

test("P0-aa refuses a public address as the LAN announcement", () => {
  assert.throws(
    () =>
      buildPilotHostEnv({
        registration: launchRegistration(),
        pfxPath: "pilot.pfx",
        pfxPassphrase: "secret",
        lanIp: "203.0.113.10",
        parentEnv: {}
      }),
    /RFC1918 private IPv4/
  );
});

test("P0-aa requires a PFX passphrase before secure pilot hosting", () => {
  assert.throws(
    () =>
      buildPilotHostEnv({
        registration: launchRegistration(),
        pfxPath: "pilot.pfx",
        pfxPassphrase: "",
        lanIp: "192.168.1.42",
        parentEnv: {}
      }),
    /COMMONLINE_TLS_PFX_PASSPHRASE/
  );
});


test("P0-aa verifies the installed Ollama digest before hosting", async () => {
  const registration = launchRegistration();
  const fetcher = async () =>
    new Response(
      JSON.stringify({
        models: [
          {
            name: registration.worker.model,
            model: registration.worker.model,
            digest: registration.worker.modelDigest
          }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );

  const verified = await verifyRegisteredWorkerDigest(
    registration,
    fetcher
  );

  assert.equal(
    verified.digest,
    registration.worker.modelDigest
  );
});

test("P0-aa fails closed when the installed Ollama digest drifted", async () => {
  const registration = launchRegistration();
  const fetcher = async () =>
    new Response(
      JSON.stringify({
        models: [
          {
            name: registration.worker.model,
            model: registration.worker.model,
            digest: "0".repeat(64)
          }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );

  await assert.rejects(
    () =>
      verifyRegisteredWorkerDigest(
        registration,
        fetcher
      ),
    /model digest drift/
  );
});
