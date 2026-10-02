import { readFileSync } from "node:fs";
import type { ServerOptions } from "node:https";

export interface PilotTlsConfig {
  enabled: boolean;
  protocol: "http" | "https";
  options?: ServerOptions;
  pfxPath?: string;
}

export function pilotTlsConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  readFile: typeof readFileSync = readFileSync
): PilotTlsConfig {
  const pfxPath = env.COMMONLINE_TLS_PFX_FILE?.trim();
  if (!pfxPath) {
    return {
      enabled: false,
      protocol: "http"
    };
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
    enabled: true,
    protocol: "https",
    pfxPath,
    options: {
      pfx,
      passphrase
    }
  };
}
