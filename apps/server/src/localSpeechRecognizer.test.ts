import { describe, expect, it } from "vitest";
import {
  DeterministicSpeechRecognizer,
  DisabledSpeechRecognizer,
  WhisperCppSpeechRecognizer,
  speechRecognizerConfigFromEnv
} from "./localSpeechRecognizer";

describe("P0-p local speech recognizer", () => {
  it("is disabled by default", () => {
    expect(speechRecognizerConfigFromEnv({}).engine).toBe("disabled");
    expect(new DisabledSpeechRecognizer().status().ready).toBe(false);
  });

  it("rejects unknown engines", () => {
    expect(() =>
      speechRecognizerConfigFromEnv({
        COMMONLINE_STT_ENGINE: "mystery-cloud"
      })
    ).toThrow(/disabled, whispercpp, or deterministic/);
  });

  it("does not report whisper.cpp ready without a local model", () => {
    const recognizer = new WhisperCppSpeechRecognizer({
      command: "whisper-cli",
      model: "",
      language: "auto",
      timeoutMs: 1000
    });
    expect(recognizer.status().ready).toBe(false);
  });

  it("provides deterministic CI transcription without quality claims", async () => {
    const recognizer = new DeterministicSpeechRecognizer();
    const result = await recognizer.transcribe({
      sampleRate: 16000,
      samples: new Int16Array(3200)
    });

    expect(result.engine).toBe("deterministic");
    expect(result.text).toContain("3200 PCM16 samples");
    expect(recognizer.status().detail).toMatch(/does not claim/i);
  });
});
