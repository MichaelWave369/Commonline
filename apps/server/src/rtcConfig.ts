import { createHmac } from "node:crypto";
import type {
  RtcConfigMessage,
  RtcCredentialMode,
  RtcIceServerConfig
} from "@commonline/protocol";

export interface RtcConfigEnvironment {
  COMMONLINE_STUN_URLS?: string;
  COMMONLINE_TURN_URLS?: string;
  COMMONLINE_TURN_USERNAME?: string;
  COMMONLINE_TURN_CREDENTIAL?: string;
  COMMONLINE_TURN_SHARED_SECRET?: string;
  COMMONLINE_TURN_CREDENTIAL_TTL_SECONDS?: string;
  COMMONLINE_ICE_TRANSPORT_POLICY?: string;
}

function urls(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ttlSeconds(value: string | undefined) {
  const parsed = Number(value ?? 3600);
  if (!Number.isFinite(parsed) || parsed < 60 || parsed > 86_400) {
    throw new Error(
      "COMMONLINE_TURN_CREDENTIAL_TTL_SECONDS must be between 60 and 86400."
    );
  }
  return Math.floor(parsed);
}

function policy(value: string | undefined): "all" | "relay" {
  if (!value || value === "all") return "all";
  if (value === "relay") return "relay";
  throw new Error(
    'COMMONLINE_ICE_TRANSPORT_POLICY must be either "all" or "relay".'
  );
}

export function buildRtcConfig(input: {
  requestId: string;
  roomId: string;
  participantId: string;
  env?: RtcConfigEnvironment;
  now?: Date;
}): RtcConfigMessage {
  const env = input.env ?? process.env;
  const stunUrls = urls(env.COMMONLINE_STUN_URLS);
  const turnUrls = urls(env.COMMONLINE_TURN_URLS);
  const iceTransportPolicy = policy(env.COMMONLINE_ICE_TRANSPORT_POLICY);
  const iceServers: RtcIceServerConfig[] = [];

  if (stunUrls.length) {
    iceServers.push({ urls: stunUrls });
  }

  let credentialMode: RtcCredentialMode = "none";
  let expiresAt: string | undefined;

  if (turnUrls.length) {
    const sharedSecret = env.COMMONLINE_TURN_SHARED_SECRET?.trim();
    const staticUsername = env.COMMONLINE_TURN_USERNAME?.trim();
    const staticCredential = env.COMMONLINE_TURN_CREDENTIAL?.trim();

    if (sharedSecret) {
      const ttl = ttlSeconds(env.COMMONLINE_TURN_CREDENTIAL_TTL_SECONDS);
      const now = input.now ?? new Date();
      const expiryUnix = Math.floor(now.getTime() / 1000) + ttl;
      const username = `${expiryUnix}:${input.participantId}`;
      const credential = createHmac("sha1", sharedSecret)
        .update(username)
        .digest("base64");

      iceServers.push({
        urls: turnUrls,
        username,
        credential
      });
      credentialMode = "ephemeral-rest";
      expiresAt = new Date(expiryUnix * 1000).toISOString();
    } else if (staticUsername && staticCredential) {
      iceServers.push({
        urls: turnUrls,
        username: staticUsername,
        credential: staticCredential
      });
      credentialMode = "static-env";
    } else {
      throw new Error(
        "TURN URLs require COMMONLINE_TURN_SHARED_SECRET or both COMMONLINE_TURN_USERNAME and COMMONLINE_TURN_CREDENTIAL."
      );
    }
  }

  if (
    iceTransportPolicy === "relay" &&
    !iceServers.some((server) =>
      server.urls.some(
        (url) => url.startsWith("turn:") || url.startsWith("turns:")
      )
    )
  ) {
    throw new Error(
      'ICE transport policy "relay" requires at least one TURN server.'
    );
  }

  return {
    type: "rtc_config",
    requestId: input.requestId,
    roomId: input.roomId,
    iceServers,
    iceTransportPolicy,
    credentialMode,
    expiresAt
  };
}
