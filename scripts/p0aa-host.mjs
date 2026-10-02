import { readFileSync } from "node:fs";
import { networkInterfaces, hostname as osHostname } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  validateRegistration
} from "./p0x-pilot.mjs";

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function detectLanIpv4(
  interfaces = networkInterfaces()
) {
  const candidates = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (
        address.family === "IPv4" &&
        !address.internal &&
        address.address !== "0.0.0.0"
      ) {
        candidates.push(address.address);
      }
    }
  }

  const privateAddress = candidates.find(isPrivateIpv4);
  return privateAddress ?? candidates[0] ?? null;
}

export function buildPilotHostEnv(input) {
  const {
    registration,
    pfxPath,
    pfxPassphrase,
    lanIp,
    parentEnv = process.env
  } = input;

  const validation = validateRegistration(
    registration,
    { launchReady: true }
  );
  if (!validation.ok) {
    fail(
      "P0-aa requires a launch-ready registration: " +
        validation.errors.join(" ")
    );
  }

  if (!lanIp || typeof lanIp !== "string") {
    fail(
      "P0-aa could not determine a LAN IPv4 address. Pass --lan-ip explicitly."
    );
  }

  if (!isPrivateIpv4(lanIp)) {
    fail(
      "P0-aa LAN host requires an RFC1918 private IPv4 address."
    );
  }

  if (!pfxPath) {
    fail("P0-aa requires a PFX path.");
  }

  if (!pfxPassphrase) {
    fail(
      "COMMONLINE_TLS_PFX_PASSPHRASE must be set before starting the secure pilot host."
    );
  }

  return {
    ...parentEnv,
    COMMONLINE_AGENT_MODE: registration.worker.mode,
    COMMONLINE_OLLAMA_MODEL: registration.worker.model,
    COMMONLINE_OLLAMA_URL: registration.worker.endpoint,
    COMMONLINE_AGENT_TIMEOUT_MS: String(
      registration.worker.maxQualificationLatencyMs
    ),
    COMMONLINE_AGENT_NUM_CTX: String(
      registration.worker.numCtx
    ),
    COMMONLINE_PILOT_LAN_HOST: "true",
    COMMONLINE_TLS_PFX_FILE: resolve(pfxPath),
    COMMONLINE_TLS_PFX_PASSPHRASE: pfxPassphrase,
    COMMONLINE_SFU_LISTEN_IP: "0.0.0.0",
    COMMONLINE_SFU_ANNOUNCED_ADDRESS: lanIp,
    VITE_COMMONLINE_WS_URL: ""
  };
}

function parseArgs(args) {
  const registrationPath = args.find(
    (arg) => !arg.startsWith("--")
  );
  const pfxIndex = args.indexOf("--pfx");
  const lanIpIndex = args.indexOf("--lan-ip");

  return {
    registrationPath,
    pfxPath:
      pfxIndex >= 0 ? args[pfxIndex + 1] : undefined,
    lanIp:
      lanIpIndex >= 0 ? args[lanIpIndex + 1] : undefined
  };
}

export async function runPilotHost(args, options = {}) {
  const parsed = parseArgs(args);
  if (!parsed.registrationPath || !parsed.pfxPath) {
    fail(
      "Usage: <registration.launch.json> --pfx <pilot.pfx> [--lan-ip 192.168.x.x]"
    );
  }

  const registration = readJson(parsed.registrationPath);
  const readFile = options.readFile ?? readFileSync;
  const pfx = readFile(parsed.pfxPath);
  if (!pfx.length) {
    fail("P0-aa PFX file is empty.");
  }

  const lanIp =
    parsed.lanIp ??
    detectLanIpv4(options.interfaces ?? networkInterfaces());

  const env = buildPilotHostEnv({
    registration,
    pfxPath: parsed.pfxPath,
    pfxPassphrase:
      options.pfxPassphrase ??
      process.env.COMMONLINE_TLS_PFX_PASSPHRASE,
    lanIp,
    parentEnv: options.parentEnv ?? process.env
  });

  const hostname =
    options.hostname ?? osHostname();

  process.stdout.write(
    "P0-aa secure pilot host configuration READY\n" +
      `registration=${registration.pilotId}\n` +
      `model=${registration.worker.model}\n` +
      `modelDigest=${registration.worker.modelDigest}\n` +
      `numCtx=${registration.worker.numCtx}\n` +
      `lanIp=${lanIp}\n` +
      `participantA=https://localhost:5173\n` +
      `participantB=https://${hostname}:5173\n` +
      `signaling=wss://${hostname}:8787\n` +
      `sfu=${lanIp}:44444\n`
  );

  if (options.dryRun) {
    return {
      env,
      hostname,
      lanIp
    };
  }

  const command =
    process.platform === "win32" ? "npm.cmd" : "npm";

  const child = spawn(
    command,
    ["run", "dev"],
    {
      cwd: process.cwd(),
      env,
      stdio: "inherit"
    }
  );

  await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(
          new Error(
            `P0-aa pilot host terminated by signal ${signal}.`
          )
        );
        return;
      }

      if (code !== 0) {
        rejectPromise(
          new Error(
            `P0-aa pilot host exited with code ${code}.`
          )
        );
        return;
      }

      resolvePromise();
    });
  });

  return {
    env,
    hostname,
    lanIp
  };
}

async function cli(argv) {
  await runPilotHost(argv);
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
