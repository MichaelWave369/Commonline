import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SpeechRecognizerEngine =
  | "disabled"
  | "whispercpp"
  | "deterministic";

export interface SpeechRecognizerStatus {
  engine: SpeechRecognizerEngine;
  ready: boolean;
  local: true;
  detail: string;
}

export interface SpeechRecognitionInput {
  sampleRate: 16000;
  samples: Int16Array;
}

export interface SpeechRecognitionResult {
  text: string;
  engine: string;
}

export interface LocalSpeechRecognizer {
  status(): SpeechRecognizerStatus;
  transcribe(
    input: SpeechRecognitionInput
  ): Promise<SpeechRecognitionResult>;
}

function pcm16MonoWav(input: SpeechRecognitionInput) {
  const dataBytes = input.samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(input.sampleRate, 24);
  buffer.writeUInt32LE(input.sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  input.samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, 44 + index * 2);
  });

  return buffer;
}

export interface WhisperCppConfig {
  command: string;
  model: string;
  language: string;
  timeoutMs: number;
}

export function speechRecognizerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
) {
  const engine = (
    env.COMMONLINE_STT_ENGINE?.trim().toLowerCase() || "disabled"
  ) as SpeechRecognizerEngine;

  if (!["disabled", "whispercpp", "deterministic"].includes(engine)) {
    throw new Error(
      "COMMONLINE_STT_ENGINE must be disabled, whispercpp, or deterministic."
    );
  }

  const timeoutMs = Number(
    env.COMMONLINE_WHISPER_TIMEOUT_MS?.trim() || "30000"
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error(
      "COMMONLINE_WHISPER_TIMEOUT_MS must be a number of at least 1000."
    );
  }

  return {
    engine,
    whisper: {
      command:
        env.COMMONLINE_WHISPER_COMMAND?.trim() || "whisper-cli",
      model: env.COMMONLINE_WHISPER_MODEL?.trim() || "",
      language: env.COMMONLINE_WHISPER_LANGUAGE?.trim() || "auto",
      timeoutMs
    } satisfies WhisperCppConfig
  };
}

export class DisabledSpeechRecognizer
  implements LocalSpeechRecognizer
{
  status(): SpeechRecognizerStatus {
    return {
      engine: "disabled",
      ready: false,
      local: true,
      detail:
        "Set COMMONLINE_STT_ENGINE=whispercpp with a local whisper.cpp model."
    };
  }

  async transcribe(): Promise<SpeechRecognitionResult> {
    throw new Error("STT_UNAVAILABLE");
  }
}

export class DeterministicSpeechRecognizer
  implements LocalSpeechRecognizer
{
  status(): SpeechRecognizerStatus {
    return {
      engine: "deterministic",
      ready: true,
      local: true,
      detail:
        "Deterministic CI/dev recognizer; does not claim speech recognition quality."
    };
  }

  async transcribe(
    input: SpeechRecognitionInput
  ): Promise<SpeechRecognitionResult> {
    return {
      text:
        `CI bounded listening share received ${input.samples.length} PCM16 samples.`,
      engine: "deterministic"
    };
  }
}

export class WhisperCppSpeechRecognizer
  implements LocalSpeechRecognizer
{
  constructor(private readonly config: WhisperCppConfig) {}

  status(): SpeechRecognizerStatus {
    const ready =
      Boolean(this.config.model) && existsSync(this.config.model);

    return {
      engine: "whispercpp",
      ready,
      local: true,
      detail: ready
        ? "Local whisper.cpp model configured."
        : this.config.model
          ? "Configured whisper.cpp model is not available locally."
          : "COMMONLINE_WHISPER_MODEL is not configured."
    };
  }

  async transcribe(
    input: SpeechRecognitionInput
  ): Promise<SpeechRecognitionResult> {
    if (!this.status().ready) {
      throw new Error("STT_UNAVAILABLE");
    }

    const directory = await mkdtemp(
      join(tmpdir(), "commonline-whisper-")
    );
    const inputPath = join(directory, "share.wav");
    const outputPrefix = join(directory, "transcript");
    const outputPath = `${outputPrefix}.txt`;

    try {
      await writeFile(inputPath, pcm16MonoWav(input));

      await new Promise<void>((resolve, reject) => {
        const args = [
          "-m",
          this.config.model,
          "-f",
          inputPath,
          "-otxt",
          "-of",
          outputPrefix,
          "-nt",
          "-l",
          this.config.language
        ];

        const child = spawn(this.config.command, args, {
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true
        });

        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("STT_FAILED"));
        }, this.config.timeoutMs);

        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });

        child.on("error", () => {
          clearTimeout(timer);
          reject(new Error("STT_FAILED"));
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                `STT_FAILED: whisper.cpp exited ${code}; ${stderr.slice(-300)}`
              )
            );
          }
        });
      });

      const text = (await readFile(outputPath, "utf8")).trim();
      if (!text) {
        throw new Error("STT_FAILED");
      }

      return {
        text,
        engine: "whispercpp"
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function createLocalSpeechRecognizer(
  env: NodeJS.ProcessEnv = process.env
): LocalSpeechRecognizer {
  const config = speechRecognizerConfigFromEnv(env);

  if (config.engine === "deterministic") {
    return new DeterministicSpeechRecognizer();
  }
  if (config.engine === "whispercpp") {
    return new WhisperCppSpeechRecognizer(config.whisper);
  }
  return new DisabledSpeechRecognizer();
}
