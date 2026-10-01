import { describe, expect, it } from "vitest";
import {
  DisabledVoiceRenderer,
  PiperCliVoiceRenderer,
  ToneVoiceRenderer,
  voiceRendererConfigFromEnv
} from "./localVoiceRenderer";

describe("P0-n local voice renderer", () => {
  it("is disabled unless a renderer is explicitly configured", () => {
    const config = voiceRendererConfigFromEnv({});
    expect(config.engine).toBe("disabled");
    expect(new DisabledVoiceRenderer().status().ready).toBe(false);
  });

  it("validates renderer engine names", () => {
    expect(() =>
      voiceRendererConfigFromEnv({
        COMMONLINE_TTS_ENGINE: "cloud-magic"
      })
    ).toThrow(/disabled, piper, or tone/);
  });

  it("exposes Piper as local and requires a configured model", () => {
    const renderer = new PiperCliVoiceRenderer({
      command: "piper",
      model: "",
      voiceId: "vessie-local-v1",
      cuda: false,
      timeoutMs: 1000
    });
    expect(renderer.status().engine).toBe("piper");
    expect(renderer.status().ready).toBe(false);
  });

  it("renders deterministic CI audio without pretending it is speech", async () => {
    const renderer = new ToneVoiceRenderer();
    const audio = await renderer.render({
      voiceId: "vessie-local-v1",
      text: "authority proof"
    });

    expect(renderer.status().detail).toMatch(/not human speech/i);
    expect(audio.sampleRate).toBe(16000);
    expect(audio.samples.length).toBeGreaterThan(1000);
    expect(
      audio.samples.some((sample) => sample !== 0)
    ).toBe(true);
  });
});
