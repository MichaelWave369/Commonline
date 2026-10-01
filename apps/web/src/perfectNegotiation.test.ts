import { describe, expect, it } from "vitest";
import {
  mediaSessionKey,
  offerCollision,
  sameMediaSession,
  shouldIgnoreOffer
} from "./perfectNegotiation";

describe("P0-h perfect negotiation helpers", () => {
  it("detects glare while a local offer is being made", () => {
    expect(
      offerCollision({
        descriptionType: "offer",
        makingOffer: true,
        signalingState: "stable",
        isSettingRemoteAnswerPending: false
      })
    ).toBe(true);
  });

  it("makes only the impolite peer ignore a colliding offer", () => {
    const collision = {
      descriptionType: "offer" as const,
      makingOffer: true,
      signalingState: "stable" as const,
      isSettingRemoteAnswerPending: false
    };

    expect(
      shouldIgnoreOffer({ polite: false, ...collision })
    ).toBe(true);
    expect(
      shouldIgnoreOffer({ polite: true, ...collision })
    ).toBe(false);
  });

  it("does not treat an answer being applied as offer glare", () => {
    expect(
      offerCollision({
        descriptionType: "offer",
        makingOffer: false,
        signalingState: "have-local-offer",
        isSettingRemoteAnswerPending: true
      })
    ).toBe(false);
  });

  it("binds equality to call id plus generation", () => {
    const a = { callId: "call-a", generation: 2 };
    expect(mediaSessionKey(a)).toBe("call-a:2");
    expect(sameMediaSession(a, { callId: "call-a", generation: 2 })).toBe(true);
    expect(sameMediaSession(a, { callId: "call-a", generation: 3 })).toBe(false);
    expect(sameMediaSession(a, { callId: "call-b", generation: 2 })).toBe(false);
  });
});
