import { describe, expect, it } from "vitest";
import {
  agentVoiceProfile,
  agentVoiceProfiles
} from "./agentVoicePolicy";

describe("P0-n agent voice profile catalog", () => {
  it("binds the local voice id to Vessie", () => {
    expect(
      agentVoiceProfile("agent-vessie", "vessie-local-v1")?.label
    ).toBe("Vessie local voice");
  });

  it("binds the voice identity to the local renderer adapter", () => {
    const profile = agentVoiceProfiles()[0];
    expect(profile.rendererState).toBe("local-adapter");
    expect(profile.engineBoundary).toBe("local-tts-adapter");
  });

  it("rejects voice ids not bound to the target agent", () => {
    expect(
      agentVoiceProfile("agent-other", "vessie-local-v1")
    ).toBeUndefined();
  });
});
