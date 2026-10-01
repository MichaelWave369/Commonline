import { describe, expect, it } from "vitest";
import type { GroupMediaSession } from "./groupMediaRegistry";
import {
  MediasoupSfuAdapter,
  mediasoupConfigFromEnv
} from "./mediasoupSfu";

describe("P0-n mediasoup SFU", () => {
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
    "boots a real mediasoup worker with Opus and PCMU plus direct RTP injection",
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
        const codecList = codecs as unknown[];
        expect(
          codecList.some((codec) => {
            if (!codec || typeof codec !== "object") return false;
            const value = codec as Record<string, unknown>;
            return value.mimeType === "audio/opus";
          })
        ).toBe(true);
        expect(
          codecList.some((codec) => {
            if (!codec || typeof codec !== "object") return false;
            const value = codec as Record<string, unknown>;
            return value.mimeType === "audio/PCMU";
          })
        ).toBe(true);

        session.sources.push({
          sourceId: "voice-source",
          ownerParticipantId: "agent-vessie",
          kind: "agent-voice",
          label: "Vessie voice",
          policyId: "source-policy/agent-voice/p0-n.1",
          publishedAt: new Date().toISOString()
        });

        const producerId = await adapter.ensureDirectAudioProducer({
          session,
          ownerParticipantId: "agent-vessie",
          sourceId: "voice-source"
        });
        expect(producerId).toBeTruthy();

        const injected = await adapter.injectDirectPcm16({
          session,
          ownerParticipantId: "agent-vessie",
          sourceId: "voice-source",
          audio: {
            sampleRate: 8000,
            samples: Int16Array.from(
              { length: 320 },
              (_, index) => (index % 20) * 500 - 5000
            )
          }
        });
        expect(injected.samplesSent).toBe(320);
        expect(injected.durationMs).toBe(40);
      } finally {
        adapter.close();
      }
    },
    30_000
  );
});
