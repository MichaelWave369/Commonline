import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildRtcConfig } from "./rtcConfig";

describe("P0-g RTC configuration", () => {
  it("returns STUN-only configuration without inventing a relay", () => {
    const config = buildRtcConfig({
      requestId: "r1",
      roomId: "room",
      participantId: "alice",
      env: {
        COMMONLINE_STUN_URLS: "stun:stun.example.test:3478"
      }
    });

    expect(config.credentialMode).toBe("none");
    expect(config.iceTransportPolicy).toBe("all");
    expect(config.iceServers).toEqual([
      { urls: ["stun:stun.example.test:3478"] }
    ]);
  });

  it("mints coturn REST-style ephemeral credentials", () => {
    const now = new Date("2026-09-30T20:00:00.000Z");
    const config = buildRtcConfig({
      requestId: "r2",
      roomId: "room",
      participantId: "human-alice",
      now,
      env: {
        COMMONLINE_TURN_URLS:
          "turn:turn.example.test:3478?transport=udp,turns:turn.example.test:5349?transport=tcp",
        COMMONLINE_TURN_SHARED_SECRET: "test-shared-secret",
        COMMONLINE_TURN_CREDENTIAL_TTL_SECONDS: "600"
      }
    });

    expect(config.credentialMode).toBe("ephemeral-rest");
    expect(config.expiresAt).toBe("2026-09-30T20:10:00.000Z");
    expect(config.iceServers).toHaveLength(1);

    const server = config.iceServers[0]!;
    expect(server.username).toBe("1790799000:human-alice");
    expect(server.credential).toBe(
      createHmac("sha1", "test-shared-secret")
        .update(server.username!)
        .digest("base64")
    );
  });

  it("supports explicit relay-only diagnostics mode with TURN", () => {
    const config = buildRtcConfig({
      requestId: "r3",
      roomId: "room",
      participantId: "alice",
      env: {
        COMMONLINE_TURN_URLS: "turn:turn.example.test:3478",
        COMMONLINE_TURN_USERNAME: "demo",
        COMMONLINE_TURN_CREDENTIAL: "secret",
        COMMONLINE_ICE_TRANSPORT_POLICY: "relay"
      }
    });

    expect(config.credentialMode).toBe("static-env");
    expect(config.iceTransportPolicy).toBe("relay");
  });

  it("fails closed when TURN is configured without credentials", () => {
    expect(() =>
      buildRtcConfig({
        requestId: "r4",
        roomId: "room",
        participantId: "alice",
        env: {
          COMMONLINE_TURN_URLS: "turn:turn.example.test:3478"
        }
      })
    ).toThrow(/TURN URLs require/);
  });

  it("refuses relay-only policy without TURN", () => {
    expect(() =>
      buildRtcConfig({
        requestId: "r5",
        roomId: "room",
        participantId: "alice",
        env: {
          COMMONLINE_STUN_URLS: "stun:stun.example.test:3478",
          COMMONLINE_ICE_TRANSPORT_POLICY: "relay"
        }
      })
    ).toThrow(/requires at least one TURN/);
  });
});
