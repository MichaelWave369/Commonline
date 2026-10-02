import { readFileSync } from "node:fs";
import type { ServerOptions } from "node:https";

export interface PilotViteServerConfig {
  port: number;
  host?: string;
  https?: ServerOptions;
}

type ReadBinaryFile = (path: string) => Buffer;

const readBinaryFile: ReadBinaryFile = (path) =>
  readFileSync(path);

export function pilotViteServerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  readFile: ReadBinaryFile = readBinaryFile
): PilotViteServerConfig {
  const lanHost =
    env.COMMONLINE_PILOT_LAN_HOST?.trim().toLowerCase() === "true";

  if (!lanHost) {
    return {
      port: 5173
    };
  }

  const pfxPath = env.COMMONLINE_TLS_PFX_FILE?.trim();
  if (!pfxPath) {
    throw new Error(
      "COMMONLINE_TLS_PFX_FILE is required when COMMONLINE_PILOT_LAN_HOST=true."
    );
  }

  const pfx = readFile(pfxPath);
  if (!pfx.length) {
    throw new Error(
      "COMMONLINE_TLS_PFX_FILE points to an empty PFX file."
    );
  }

  const passphrase =
    env.COMMONLINE_TLS_PFX_PASSPHRASE?.trim() || undefined;

  return {
    port: 5173,
    host: "0.0.0.0",
    https: {
      pfx,
      passphrase
    }
  };
}
