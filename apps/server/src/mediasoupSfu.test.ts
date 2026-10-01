import { describe, expect, it } from "vitest";
import type { GroupMediaSession } from "./groupMediaRegistry";
import {
  MediasoupSfuAdapter,
  mediasoupConfigFromEnv
} from "./mediasoupSfu";

describe("P0-j mediasoup SFU", () => {
  it("requires an announced address for wildcard deployment binds", () => {
    expect(() =>
      mediasoupConfigFromEnv({
        COMMONLINE_SFU_LISTEN_IP: "0.0.0.0",
        COMMONLINE_SFU_PORT: "44444"
      })
    ).toThrow(/ANNOUNCED_ADDRESS/);
  });

  it("validates the dedicated SFU port", () => {
    expect(() =>
      mediasoupConfigFromEnv({
        COMMONLINE_SFU_PORT: "70000"
      })
    ).toThrow(/SFU_PORT/);
  });

  it(
    "boots a real mediasoup worker and creates an Opus router",
    async () => {
      const adapter = await MediasoupSfuAdapter.create({
        listenIp: "127.0.0.1"
      });

      const session: GroupMediaSession = {
        roomId: "sfu-smoke",
        mediaSessionId: "group-media-smoke",
        generation: 1,
        createdAt: new Date().toISOString(),
        participants: [
          {
            participantId: "alice",
            joinedAt: new Date().toISOString()
          }
        ],
        sources: [],
        subscriptions: []
      };

      try {
        const capabilities =
          await adapter.routerCapabilities(session);
        expect(adapter.status().workerPid).toBeGreaterThan(0);

        const codecs = capabilities.codecs;
        expect(Array.isArray(codecs)).toBe(true);
        expect(
          (codecs as unknown[]).some((codec) => {
            if (!codec || typeof codec !== "object") return false;
            const value = codec as Record<string, unknown>;
            return value.mimeType === "audio/opus";
          })
        ).toBe(true);
      } finally {
        adapter.close();
      }
    },
    30_000
  );
});
