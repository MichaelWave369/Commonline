import { describe, expect, it } from "vitest";
import {
  evaluateMediaSourcePolicy,
  mediaSourcePolicies
} from "./mediaSourcePolicy";

describe("P0-m media source policy", () => {
  it("allows a human microphone only with SPEAK authority", () => {
    expect(
      evaluateMediaSourcePolicy({
        kind: "human-microphone",
        publisherKind: "human",
        hasRequiredAuthority: true
      }).ok
    ).toBe(true);

    const denied = evaluateMediaSourcePolicy({
      kind: "human-microphone",
      publisherKind: "human",
      hasRequiredAuthority: false
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe("MEDIA_SOURCE_POLICY_DENIED");
    }
  });

  it("makes sound effects executable but still subscription-gated", () => {
    const decision = evaluateMediaSourcePolicy({
      kind: "sound-effect",
      publisherKind: "human",
      hasRequiredAuthority: true
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.policy.audienceMode).toBe("explicit-subscription");
    expect(decision.policy.recordingDefault).toBe("not-authorized");
  });

  it("does not let a human impersonate an agent voice source", () => {
    const decision = evaluateMediaSourcePolicy({
      kind: "agent-voice",
      publisherKind: "human",
      hasRequiredAuthority: true
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("MEDIA_SOURCE_KIND_UNSUPPORTED");
    }
  });

  it("keeps future source classes visible but reserved", () => {
    const catalog = mediaSourcePolicies();
    expect(
      catalog.find((policy) => policy.kind === "shared-music")
        ?.executionState
    ).toBe("reserved");
    expect(
      catalog.find((policy) => policy.kind === "agent-voice")
        ?.allowedPublisherKinds
    ).toEqual(["agent"]);
    expect(
      catalog.find((policy) => policy.kind === "agent-voice")
        ?.requiredAuthority
    ).toBe("AGENT_VOICE_GRANT");
    expect(
      catalog.find((policy) => policy.kind === "system-tone")
        ?.allowedPublisherKinds
    ).toEqual(["service"]);
  });
});
