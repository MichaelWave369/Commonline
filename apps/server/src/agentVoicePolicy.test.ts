import { describe, expect, it } from "vitest";
import {
  agentVoiceProfile,
  agentVoiceProfiles
} from "./agentVoicePolicy";

describe("P0-m agent voice profile catalog", () => {
  it("binds the local voice id to Vessie", () => {
    expect(
      agentVoiceProfile("agent-vessie", "vessie-local-v1")?.label
    ).toBe("Vessie local voice");
  });

  it("does not claim the renderer is wired in the authority rung", () => {
    const profile = agentVoiceProfiles()[0];
    expect(profile.rendererState).toBe("not-wired");
    expect(profile.engineBoundary).toBe("local-tts-adapter");
  });

  it("rejects voice ids not bound to the target agent", () => {
    expect(
      agentVoiceProfile("agent-other", "vessie-local-v1")
    ).toBeUndefined();
  });
});
