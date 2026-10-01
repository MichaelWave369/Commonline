import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parsePcm16Wav,
  type Pcm16Audio
} from "./audioPcm";

export type VoiceRendererEngine = "disabled" | "piper" | "tone";

export interface VoiceRendererStatus {
  engine: VoiceRendererEngine;
  ready: boolean;
  local: true;
  voiceId: string;
  detail: string;
}

export interface LocalVoiceRenderer {
  status(): VoiceRendererStatus;
  render(input: {
    voiceId: string;
    text: string;
  }): Promise<Pcm16Audio>;
}

export interface PiperVoiceRendererConfig {
  command: string;
  model: string;
  voiceId: string;
  speaker?: string;
  cuda: boolean;
  timeoutMs: number;
}

export function voiceRendererConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
) {
  const engine = (
    env.COMMONLINE_TTS_ENGINE?.trim().toLowerCase() || "disabled"
  ) as VoiceRendererEngine;

  if (!["disabled", "piper", "tone"].includes(engine)) {
    throw new Error(
      "COMMONLINE_TTS_ENGINE must be disabled, piper, or tone."
    );
  }

  return {
    engine,
    piper: {
      command: env.COMMONLINE_PIPER_COMMAND?.trim() || "piper",
      model: env.COMMONLINE_PIPER_MODEL?.trim() || "",
      voiceId: "vessie-local-v1",
      speaker: env.COMMONLINE_PIPER_SPEAKER?.trim() || undefined,
      cuda: env.COMMONLINE_PIPER_CUDA === "true",
      timeoutMs: Number(
        env.COMMONLINE_PIPER_TIMEOUT_MS?.trim() || "30000"
      )
    } satisfies PiperVoiceRendererConfig
  };
}

export class DisabledVoiceRenderer implements LocalVoiceRenderer {
  status(): VoiceRendererStatus {
    return {
      engine: "disabled",
      ready: false,
      local: true,
      voiceId: "vessie-local-v1",
      detail: "Set COMMONLINE_TTS_ENGINE=piper with a local Piper model."
    };
  }

  async render(): Promise<Pcm16Audio> {
    throw new Error("VOICE_RENDERER_UNAVAILABLE");
  }
}

export class ToneVoiceRenderer implements LocalVoiceRenderer {
  status(): VoiceRendererStatus {
    return {
      engine: "tone",
      ready: true,
      local: true,
      voiceId: "vessie-local-v1",
      detail: "Deterministic CI/dev renderer; not human speech."
    };
  }

  async render(input: {
    voiceId: string;
    text: string;
  }): Promise<Pcm16Audio> {
    if (input.voiceId !== "vessie-local-v1") {
      throw new Error("VOICE_ID_INVALID");
    }

    const sampleRate = 16000;
    const durationSeconds = Math.min(
      2.4,
      Math.max(1.2, input.text.length / 55)
    );
    const samples = new Int16Array(
      Math.round(sampleRate * durationSeconds)
    );

    for (let i = 0; i < samples.length; i += 1) {
      const t = i / sampleRate;
      const syllable = Math.floor(t * 7) % 4;
      const base = [178, 214, 196, 238][syllable]!;
      const vibrato = Math.sin(2 * Math.PI * 5.2 * t) * 5;
      const envelope =
        Math.sin(
          (Math.PI / 2) *
            Math.min(
              1,
              (i / samples.length) * 8,
              ((samples.length - i) / samples.length) * 8
            )
        ) ** 2;
      const carrier =
        Math.sin(2 * Math.PI * (base + vibrato) * t) * 0.55 +
        Math.sin(2 * Math.PI * (base * 2.03) * t) * 0.16;
      samples[i] = Math.round(
        Math.max(-1, Math.min(1, carrier * envelope)) * 12000
      );
    }

    return { sampleRate, samples };
  }
}

export class PiperCliVoiceRenderer implements LocalVoiceRenderer {
  constructor(private readonly config: PiperVoiceRendererConfig) {}

  status(): VoiceRendererStatus {
    return {
      engine: "piper",
      ready: Boolean(this.config.model),
      local: true,
      voiceId: this.config.voiceId,
      detail: this.config.model
        ? `Piper CLI model: ${this.config.model}`
        : "COMMONLINE_PIPER_MODEL is not configured."
    };
  }

  async render(input: {
    voiceId: string;
    text: string;
  }): Promise<Pcm16Audio> {
    if (input.voiceId !== this.config.voiceId) {
      throw new Error("VOICE_ID_INVALID");
    }
    if (!this.config.model) {
      throw new Error("VOICE_RENDERER_UNAVAILABLE");
    }

    const directory = await mkdtemp(
      join(tmpdir(), "commonline-piper-")
    );
    const outputPath = join(directory, "utterance.wav");

    const args = [
      "--model",
      this.config.model,
      "--output_file",
      outputPath
    ];
    if (this.config.speaker) {
      args.push("--speaker", this.config.speaker);
    }
    if (this.config.cuda) args.push("--cuda");

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.config.command, args, {
          stdio: ["pipe", "ignore", "pipe"],
          windowsHide: true
        });

        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("VOICE_RENDERER_TIMEOUT"));
        }, this.config.timeoutMs);

        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });

        child.on("error", (error) => {
          clearTimeout(timer);
          reject(
            new Error(
              `VOICE_RENDERER_START_FAILED: ${error.message}`
            )
          );
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                `VOICE_RENDERER_FAILED: piper exited ${code}; ${stderr.slice(-400)}`
              )
            );
          }
        });

        child.stdin.end(input.text + "\n");
      });

      return parsePcm16Wav(await readFile(outputPath));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function createLocalVoiceRenderer(
  env: NodeJS.ProcessEnv = process.env
): LocalVoiceRenderer {
  const config = voiceRendererConfigFromEnv(env);
  if (config.engine === "tone") return new ToneVoiceRenderer();
  if (config.engine === "piper") {
    return new PiperCliVoiceRenderer(config.piper);
  }
  return new DisabledVoiceRenderer();
}
